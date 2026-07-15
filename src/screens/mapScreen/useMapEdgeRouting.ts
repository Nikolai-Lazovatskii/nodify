/**
 * Súbor: src/screens/mapScreen/useMapEdgeRouting.ts
 * Abstrakt: Zapuzdruje výber a cache trás stromových a vzťahových hrán mapy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager } from "react-native";

import type { EdgePoint } from "@/src/components/EdgeView";
import type { MindMap, MindMapNode, RelationshipEdge } from "@/src/types/map";

import {
  EDGE_PALETTE,
  LOCAL_ROUTE_OBSTACLE_LIMIT,
  MAX_RENDERED_EDGES_PER_FRAME,
} from "./constants";
import { buildRelationshipDisplayColors, type RouteColorRef } from "./routeColors";
import {
  makeNodeRouteRect,
  nearestRouteObstacles,
  routeEdgePoints,
  routeIntersectsRect,
  routeIntersectsRoute,
  routeSegmentRects,
  routeSimpleEdgePoints,
  type RouteRect,
  type RoutedEdge,
} from "./routing";

type CommittedRoute = {
  id: string;
  points: EdgePoint[];
};

type RelationshipRouteCache = {
  routes: Map<string, RoutedEdge>;
  signatures: Map<string, string>;
  dirty: Set<string>;
};

type TreeEdgeRef = {
  id: string;
  parentNode: MindMapNode;
  childNode: MindMapNode;
};

type UseMapEdgeRoutingParams = {
  map: MindMap;
  renderedNodes: MindMapNode[];
  renderedNodeIds: Set<string>;
  isLargeMap: boolean;
  preferSelectiveRouting: boolean;
  smartRelationshipRoutes: boolean;
  routesReady: boolean;
};

function snapshotRoutes(routes: Map<string, RoutedEdge>) {
  const snapshot: Record<string, RoutedEdge> = {};

  for (const [id, route] of routes) {
    snapshot[id] = route;
  }

  return snapshot;
}

function getStructuredTreeEdgePoints(parentNode: MindMapNode, childNode: MindMapNode): EdgePoint[] {
  const side = childNode.x < parentNode.x ? -1 : 1;
  const horizontalGap = Math.max(60, Math.min(96, Math.abs(childNode.x - parentNode.x) * 0.42));
  const parentExitX = parentNode.x + side * horizontalGap;
  const childEntryX = childNode.x - side * horizontalGap;

  return [
    { x: parentNode.x, y: parentNode.y },
    { x: parentExitX, y: parentNode.y },
    { x: childEntryX, y: childNode.y },
    { x: childNode.x, y: childNode.y },
  ];
}

export function useMapEdgeRouting({
  map,
  renderedNodes,
  renderedNodeIds,
  isLargeMap,
  preferSelectiveRouting,
  smartRelationshipRoutes,
  routesReady,
}: UseMapEdgeRoutingParams) {
  const [smartRelationshipRoutesById, setSmartRelationshipRoutesById] = useState<Record<string, RoutedEdge>>({});
  const routeCache = useRef<Map<string, RoutedEdge>>(new Map());
  const relationshipRouteCache = useRef<RelationshipRouteCache>({
    routes: new Map(),
    signatures: new Map(),
    dirty: new Set(),
  });
  const routeObstacles = useMemo(
    () => smartRelationshipRoutes
      ? renderedNodes.map((node) => makeNodeRouteRect(node, node.id === map.rootId, 26))
      : [],
    [map.rootId, renderedNodes, smartRelationshipRoutes]
  );
  const simpleRelationshipObstacles = useMemo(
    () => smartRelationshipRoutes
      ? []
      : renderedNodes.map((node) => makeNodeRouteRect(node, node.id === map.rootId, 20)),
    [map.rootId, renderedNodes, smartRelationshipRoutes]
  );
  const routeObstacleSignature = useMemo(() => {
    if (!smartRelationshipRoutes) {
      return "direct";
    }

    let hash = 2166136261;

    for (const node of renderedNodes) {
      for (let index = 0; index < node.id.length; index += 1) {
        hash = Math.imul(hash ^ node.id.charCodeAt(index), 16777619);
      }

      hash = Math.imul(hash ^ Math.round(node.x), 16777619);
      hash = Math.imul(hash ^ Math.round(node.y), 16777619);
      hash = Math.imul(hash ^ Math.round(node.size ?? 0), 16777619);
      hash = Math.imul(hash ^ node.children.length, 16777619);
      hash = Math.imul(hash ^ (node.collapsed ? 1 : 0), 16777619);
    }

    return `${renderedNodes.length}:${hash >>> 0}`;
  }, [renderedNodes, smartRelationshipRoutes]);

  useEffect(() => {
    routeCache.current.clear();
  }, [map.nodes, map.edges]);

  const chooseEdgeRoute = useCallback((
    id: string,
    fromNode: MindMapNode,
    toNode: MindMapNode,
    excludedIds: Set<string>,
    committedRoutes: CommittedRoute[],
    baseSeed: number,
    styleKey: string,
    availableRouteObstacles: RouteRect[]
  ): { drawPoints?: EdgePoint[]; committedPoints: EdgePoint[] } => {
    const directPoints = [fromNode, toNode];
    const nodeObstacles = availableRouteObstacles.filter((rect) => !excludedIds.has(rect.id));
    const directHitsNode = nodeObstacles.some((rect) => routeIntersectsRect(directPoints, rect));
    const directHitsEdge = committedRoutes.some((route) =>
      routeIntersectsRoute(directPoints, route.points)
    );
    const shouldRouteEdge = !preferSelectiveRouting || directHitsNode || directHitsEdge;

    if (!shouldRouteEdge) {
      return { drawPoints: directPoints, committedPoints: directPoints };
    }

    const localNodeObstacles = preferSelectiveRouting
      ? nearestRouteObstacles(fromNode, toNode, availableRouteObstacles, excludedIds, LOCAL_ROUTE_OBSTACLE_LIMIT)
      : availableRouteObstacles.filter((rect) => !excludedIds.has(rect.id));
    const committedSegmentRects = committedRoutes.flatMap((route) =>
      routeSegmentRects(route.points, route.id)
    );
    const routeObstaclesForEdge = [...localNodeObstacles, ...committedSegmentRects];
    const scoreRoute = (points: EdgePoint[]) => {
      const nodeHits = nodeObstacles.reduce(
        (count, rect) => count + (routeIntersectsRect(points, rect) ? 1 : 0),
        0
      );
      const edgeHits = committedRoutes.reduce(
        (count, route) => count + (routeIntersectsRoute(points, route.points) ? 1 : 0),
        0
      );
      const bendPenalty = Math.max(0, points.length - 2) * 0.1;
      const lengthPenalty = points.slice(0, -1).reduce((sum, point, index) => {
        const next = points[index + 1];
        return sum + Math.hypot(next.x - point.x, next.y - point.y);
      }, 0) * 0.001;

      return {
        nodeHits,
        edgeHits,
        score: nodeHits * 100000 + edgeHits * 10000 + bendPenalty + lengthPenalty,
      };
    };
    const cacheKey = [
      id,
      fromNode.x,
      fromNode.y,
      toNode.x,
      toNode.y,
      styleKey,
      routeObstaclesForEdge.map((rect) => rect.id).join(","),
    ].join(":");
    const cached = routeCache.current.get(cacheKey);
    if (cached?.points) {
      const cachedScore = scoreRoute(cached.points);
      if (cachedScore.nodeHits === 0 && cachedScore.edgeHits === 0) {
        return { drawPoints: cached.points, committedPoints: cached.points };
      }
    }

    const seeds = preferSelectiveRouting
      ? [baseSeed, baseSeed + 3, baseSeed + 6, baseSeed + 11]
      : [baseSeed];
    let bestPoints: EdgePoint[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestNodeHits = Number.POSITIVE_INFINITY;
    let bestEdgeHits = Number.POSITIVE_INFINITY;

    for (const seed of seeds) {
      const points = routeEdgePoints(fromNode, toNode, routeObstaclesForEdge, seed);
      const { nodeHits, edgeHits, score } = scoreRoute(points);

      if (score < bestScore) {
        bestScore = score;
        bestPoints = points;
        bestNodeHits = nodeHits;
        bestEdgeHits = edgeHits;
      }

      if (nodeHits === 0 && edgeHits === 0) {
        break;
      }
    }

    if (bestNodeHits > 0 || bestEdgeHits > 0) {
      const fallbackSeeds = Array.from(new Set([
        ...seeds,
        baseSeed + 17,
        baseSeed + 23,
        baseSeed + 31,
        baseSeed + 47,
      ]));

      for (const seed of fallbackSeeds) {
        const points = routeEdgePoints(fromNode, toNode, nodeObstacles, seed);
        const { nodeHits, edgeHits, score } = scoreRoute(points);

        if (score < bestScore) {
          bestScore = score;
          bestPoints = points;
          bestNodeHits = nodeHits;
          bestEdgeHits = edgeHits;
        }

        if (nodeHits === 0 && edgeHits === 0) {
          break;
        }
      }

      if (bestNodeHits > 0 || bestEdgeHits > 0) {
        const fullRouteObstacles = [...nodeObstacles, ...committedSegmentRects];

        for (const seed of fallbackSeeds) {
          const points = routeEdgePoints(fromNode, toNode, fullRouteObstacles, seed);
          const { nodeHits, edgeHits, score } = scoreRoute(points);

          if (score < bestScore) {
            bestScore = score;
            bestPoints = points;
            bestNodeHits = nodeHits;
            bestEdgeHits = edgeHits;
          }

          if (nodeHits === 0 && edgeHits === 0) {
            break;
          }
        }
      }
    }

    const points = bestPoints ?? directPoints;
    routeCache.current.set(cacheKey, { id, points });
    if (routeCache.current.size > 1200) {
      routeCache.current.clear();
    }

    return { drawPoints: points, committedPoints: points };
  }, [preferSelectiveRouting]);

  const routedTreeEdges = useMemo(() => {
    if (!routesReady) {
      return {};
    }

    const routes: Record<string, RoutedEdge> = {};
    let routeIndex = 0;

    for (const parentNode of renderedNodes) {
      if (routeIndex >= MAX_RENDERED_EDGES_PER_FRAME) {
        break;
      }

      if (!renderedNodeIds.has(parentNode.id)) {
        continue;
      }

      for (let childIndex = 0; childIndex < parentNode.children.length; childIndex += 1) {
        if (routeIndex >= MAX_RENDERED_EDGES_PER_FRAME) {
          break;
        }

        const childId = parentNode.children[childIndex];
        const childNode = map.nodes[childId];
        if (!childNode || !renderedNodeIds.has(childId)) {
          continue;
        }

        const id = `tree-${parentNode.id}-${childId}`;
        routes[id] = {
          id,
          points: getStructuredTreeEdgePoints(parentNode, childNode),
        };
        routeIndex += 1;
      }
    }

    return routes;
  }, [map.nodes, renderedNodeIds, renderedNodes, routesReady]);
  const treeEdges = useMemo(() => {
    const refs: TreeEdgeRef[] = [];

    for (const parentNode of renderedNodes) {
      for (const childId of parentNode.children) {
        if (refs.length >= MAX_RENDERED_EDGES_PER_FRAME) {
          return refs;
        }

        const childNode = map.nodes[childId];
        if (!childNode || !renderedNodeIds.has(childId)) {
          continue;
        }

        refs.push({
          id: `tree-${parentNode.id}-${childId}`,
          parentNode,
          childNode,
        });
      }
    }

    return refs;
  }, [map.nodes, renderedNodeIds, renderedNodes]);
  const relationshipEdges = useMemo(() => {
    const relationshipLimit = isLargeMap
      ? MAX_RENDERED_EDGES_PER_FRAME
      : Math.max(0, MAX_RENDERED_EDGES_PER_FRAME - treeEdges.length);
    if (relationshipLimit === 0) {
      return [];
    }

    const refs: RelationshipEdge[] = [];
    for (const edge of map.edges) {
      if (refs.length >= relationshipLimit) {
        break;
      }

      if (renderedNodeIds.has(edge.fromId) && renderedNodeIds.has(edge.toId)) {
        refs.push(edge);
      }
    }

    return refs;
  }, [map.edges, treeEdges.length, renderedNodeIds, isLargeMap]);
  const simpleRelationshipRoutes = useMemo(() => {
    if (smartRelationshipRoutes) {
      return {};
    }

    const routes: Record<string, RoutedEdge> = {};
    relationshipEdges.forEach((edge, edgeIndex) => {
      const fromNode = map.nodes[edge.fromId];
      const toNode = map.nodes[edge.toId];
      if (!fromNode || !toNode) {
        return;
      }

      const obstacles = simpleRelationshipObstacles.filter(
        (rect) => rect.id !== edge.fromId && rect.id !== edge.toId
      );
      routes[edge.id] = {
        id: edge.id,
        points: routeSimpleEdgePoints(fromNode, toNode, obstacles, edgeIndex + 17),
      };
    });

    return routes;
  }, [simpleRelationshipObstacles, map.nodes, smartRelationshipRoutes, relationshipEdges]);
  const relationshipRouteSignatures = useMemo(() => {
    if (!smartRelationshipRoutes) {
      return [];
    }

    return relationshipEdges.map((edge, edgeIndex) => {
      const fromNode = map.nodes[edge.fromId];
      const toNode = map.nodes[edge.toId];

      return {
        id: edge.id,
        signature: [
          edgeIndex,
          edge.id,
          edge.fromId,
          edge.toId,
          fromNode?.x ?? "",
          fromNode?.y ?? "",
          toNode?.x ?? "",
          toNode?.y ?? "",
          edge.style ?? "",
          edge.width ?? "",
          edge.color ?? "",
          preferSelectiveRouting ? 1 : 0,
          routeObstacleSignature,
        ].join("|"),
      };
    });
  }, [map.nodes, preferSelectiveRouting, smartRelationshipRoutes, routeObstacleSignature, relationshipEdges]);

  useEffect(() => {
    const cache = relationshipRouteCache.current;
    const liveIds = new Set(relationshipRouteSignatures.map((item) => item.id));
    let changed = false;

    for (const id of Array.from(cache.routes.keys())) {
      if (!liveIds.has(id)) {
        cache.routes.delete(id);
        cache.signatures.delete(id);
        cache.dirty.delete(id);
        changed = true;
      }
    }

    for (const item of relationshipRouteSignatures) {
      if (cache.signatures.get(item.id) !== item.signature) {
        cache.signatures.set(item.id, item.signature);
        cache.dirty.add(item.id);
      }
    }

    if (!smartRelationshipRoutes) {
      cache.routes.clear();
      cache.signatures.clear();
      cache.dirty.clear();
      setSmartRelationshipRoutesById((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    if (!routesReady || cache.dirty.size === 0) {
      if (changed) {
        setSmartRelationshipRoutesById(snapshotRoutes(cache.routes));
      }
      return;
    }

    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (cancelled) {
        return;
      }

      const currentCache = relationshipRouteCache.current;
      const dirtyIds = new Set(currentCache.dirty);
      if (dirtyIds.size === 0) {
        return;
      }

      const nextRoutes = new Map(currentCache.routes);
      const committedRoutes: CommittedRoute[] = treeEdges.map(({ id, parentNode, childNode }) => ({
        id,
        points: routedTreeEdges[id]?.points ?? getStructuredTreeEdgePoints(parentNode, childNode),
      }));

      relationshipEdges.forEach((edge, edgeIndex) => {
        const fromNode = map.nodes[edge.fromId];
        const toNode = map.nodes[edge.toId];
        const existingRoute = nextRoutes.get(edge.id);

        if (!fromNode || !toNode || !renderedNodeIds.has(edge.fromId) || !renderedNodeIds.has(edge.toId)) {
          nextRoutes.delete(edge.id);
          currentCache.dirty.delete(edge.id);
          return;
        }

        if (!dirtyIds.has(edge.id)) {
          if (existingRoute?.points) {
            committedRoutes.push({ id: edge.id, points: existingRoute.points });
          }
          return;
        }

        const route = chooseEdgeRoute(
          edge.id,
          fromNode,
          toNode,
          new Set([edge.fromId, edge.toId]),
          committedRoutes,
          edgeIndex + 97,
          `${edge.style ?? "dashed"}:${edge.width ?? 2}`,
          routeObstacles
        );
        const points = route.drawPoints ?? route.committedPoints;
        nextRoutes.set(edge.id, {
          id: edge.id,
          points,
        });
        committedRoutes.push({ id: edge.id, points: route.committedPoints });
        currentCache.dirty.delete(edge.id);
      });

      currentCache.routes = nextRoutes;
      setSmartRelationshipRoutesById(snapshotRoutes(currentCache.routes));
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, [
    chooseEdgeRoute,
    renderedNodeIds,
    map.nodes,
    relationshipRouteSignatures,
    routeObstacles,
    routedTreeEdges,
    smartRelationshipRoutes,
    routesReady,
    treeEdges,
    relationshipEdges,
  ]);

  const relationshipDisplayColors = useMemo(() => {
    if (!smartRelationshipRoutes) {
      return {};
    }

    const treeRoutes: RouteColorRef[] = treeEdges
      .map(({ id, parentNode, childNode }) => ({
        id,
        points: routedTreeEdges[id]?.points ?? [parentNode, childNode],
        color: childNode.edgeToParent?.color ?? "#9ca3af",
      }))
      .filter((route) => route.points.length >= 2);
    const routes: RouteColorRef[] = relationshipEdges
      .map((edge) => {
        const points = smartRelationshipRoutesById[edge.id]?.points;
        if (!points || points.length < 2) {
          return null;
        }

        return {
          id: edge.id,
          points,
          color: edge.color ?? "#94a3b8",
        };
      })
      .filter((route): route is RouteColorRef => !!route);
    return buildRelationshipDisplayColors(treeRoutes, routes, EDGE_PALETTE);
  }, [relationshipEdges, treeEdges, smartRelationshipRoutesById, routedTreeEdges, smartRelationshipRoutes]);

  return {
    routedTreeEdges,
    treeEdges,
    relationshipEdges,
    simpleRelationshipRoutes,
    smartRelationshipRoutesById,
    relationshipDisplayColors,
  };
}
