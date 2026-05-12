import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, InteractionManager, Keyboard, PixelRatio, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, G, Pattern, Rect, Text as SvgText } from "react-native-svg";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/i18n/LanguagePreference";

import EdgeView, { EdgePoint } from "../../components/EdgeView";
import EditableNodeView from "../../components/EditableNodeView";
import NodeInspector from "../../components/NodeInspector";
import ZoomableCanvas, { CanvasTransform, ZoomableCanvasHandle } from "../../components/ZoomableCanvas";
import { EdgeStyle, MindMap, MindMapNode, NodeAttachment, NodeShape, RelationshipEdge } from "../../types/map";
import {
  LOCAL_ROUTE_OBSTACLE_LIMIT,
  DEFAULT_RELATIONSHIP_EDGE,
  DOT_GRID_LARGE,
  DOT_GRID_SMALL,
  EDGE_PALETTE,
  MAX_RENDERED_EDGES_PER_FRAME,
  PROGRESSIVE_RENDER_NODE_LIMIT,
  VIEWPORT_CULL_NODE_LIMIT,
} from "./constants";
import {
  collectVisibleNodeIds,
  enforceRootConnectivity,
  layoutStructuredMap,
  hasRelationshipEdge,
  normalizeMap,
  normalizeSearchValue,
  removeRelationshipEdge,
} from "./mapModel";
import {
  estimateNodeHalfBounds,
  getDisplayNodeTitle,
  getNodeImageAttachment,
  makeNodeRouteRect,
  NODE_IMAGE_THUMB_SIZE,
  nearestRouteObstacles,
  routeEdgePoints,
  routeIntersectsRect,
  routeIntersectsRoute,
  RoutedEdge,
  routeSegmentRects,
} from "./routing";
import { ui } from "./uiStyles";
import { styles } from "../MapScreen.styles";

type Props = {
  initialMap?: MindMap;
  onMapChange?: (map: MindMap) => void;
};

type WorldViewport = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type CommittedRoute = {
  id: string;
  points: EdgePoint[];
};

type InsertionSlot = {
  parentId: string;
  index: number;
  side: -1 | 1;
  distance: number;
};

function viewportContainsNode(viewport: WorldViewport, node: MindMapNode, isRoot: boolean) {
  const { halfW, halfH } = estimateNodeHalfBounds(node, isRoot);
  return (
    node.x + halfW >= viewport.left &&
    node.x - halfW <= viewport.right &&
    node.y + halfH >= viewport.top &&
    node.y - halfH <= viewport.bottom
  );
}

function makeWorldViewport(
  transform: CanvasTransform,
  paddingMultiplier = 1.25,
  worldWidth = transform.width,
  worldHeight = transform.height,
  surfaceWidth = transform.width,
  surfaceHeight = transform.height
): WorldViewport {
  const safeScale = transform.scale || 1;
  const scaleX = worldWidth / Math.max(1, surfaceWidth);
  const scaleY = worldHeight / Math.max(1, surfaceHeight);
  const left = ((0 - transform.width / 2 - transform.tx) / safeScale) * scaleX;
  const right = ((transform.width - transform.width / 2 - transform.tx) / safeScale) * scaleX;
  const top = ((0 - transform.height / 2 - transform.ty) / safeScale) * scaleY;
  const bottom = ((transform.height - transform.height / 2 - transform.ty) / safeScale) * scaleY;
  const padX = ((right - left) || transform.width) * paddingMultiplier;
  const padY = ((bottom - top) || transform.height) * paddingMultiplier;

  return {
    left: left - padX,
    right: right + padX,
    top: top - padY,
    bottom: bottom + padY,
  };
}

function getNodeRenderBounds(node: MindMapNode, isRoot: boolean) {
  const { halfW, halfH } = estimateNodeHalfBounds(node, isRoot);
  return {
    width: halfW * 2,
    height: halfH * 2,
    x: node.x - halfW,
    y: node.y - halfH,
  };
}

function getMapBounds(nodes: MindMapNode[], rootId: string) {
  if (nodes.length === 0) {
    return { left: 0, right: 0, top: 0, bottom: 0, width: 1, height: 1, centerX: 0, centerY: 0 };
  }

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;

  for (const node of nodes) {
    const { halfW, halfH } = estimateNodeHalfBounds(node, node.id === rootId);
    left = Math.min(left, node.x - halfW);
    right = Math.max(right, node.x + halfW);
    top = Math.min(top, node.y - halfH);
    bottom = Math.max(bottom, node.y + halfH);
  }

  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);

  return {
    left,
    right,
    top,
    bottom,
    width,
    height,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
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

function collectDescendantIds(nodes: Record<string, MindMapNode>, nodeId: string) {
  const descendants = new Set<string>();
  const visit = (id: string) => {
    const node = nodes[id];
    if (!node) {
      return;
    }

    for (const childId of node.children) {
      if (descendants.has(childId)) {
        continue;
      }
      descendants.add(childId);
      visit(childId);
    }
  };

  visit(nodeId);
  return descendants;
}

function getBranchSide(map: MindMap, parent: MindMapNode, child?: MindMapNode): -1 | 1 {
  const root = map.nodes[map.rootId];
  if (parent.id === map.rootId) {
    if (child) {
      return child.x < parent.x ? -1 : 1;
    }
    return 1;
  }

  return parent.x < (root?.x ?? 0) ? -1 : 1;
}

function estimateSlotY(children: MindMapNode[], index: number, parentY: number) {
  const gap = 112;
  if (children.length === 0) {
    return parentY;
  }
  if (index <= 0) {
    return children[0].y - gap;
  }
  if (index >= children.length) {
    return children[children.length - 1].y + gap;
  }
  return (children[index - 1].y + children[index].y) / 2;
}

function findNearestInsertionSlot(map: MindMap, nodeId: string, x: number, y: number): InsertionSlot | null {
  const movingNode = map.nodes[nodeId];
  const root = map.nodes[map.rootId];
  if (!movingNode || !root || nodeId === map.rootId) {
    return null;
  }

  const visibleIds = collectVisibleNodeIds(map);
  const descendants = collectDescendantIds(map.nodes, nodeId);
  let best: InsertionSlot | null = null;

  const consider = (parent: MindMapNode, side: -1 | 1, children: MindMapNode[]) => {
    for (let index = 0; index <= children.length; index += 1) {
      const slotX = parent.x + side * 230;
      const slotY = estimateSlotY(children, index, parent.y);
      const dx = Math.abs(x - slotX);
      const dy = Math.abs(y - slotY);
      const distance = dx * 0.85 + dy;

      if (!best || distance < best.distance) {
        best = {
          parentId: parent.id,
          index,
          side,
          distance,
        };
      }
    }
  };

  for (const parent of Object.values(map.nodes)) {
    if (parent.id === nodeId || descendants.has(parent.id) || !visibleIds.has(parent.id)) {
      continue;
    }

    const childNodes = parent.children
      .map((childId) => map.nodes[childId])
      .filter((child): child is MindMapNode =>
        !!child && child.id !== nodeId && !descendants.has(child.id) && visibleIds.has(child.id)
      )
      .sort((a, b) => a.y - b.y);

    if (parent.id === map.rootId) {
      const leftChildren = childNodes.filter((child) => child.x < parent.x);
      const rightChildren = childNodes.filter((child) => child.x >= parent.x);
      consider(parent, -1, leftChildren);
      consider(parent, 1, rightChildren);
      continue;
    }

    consider(parent, getBranchSide(map, parent), childNodes);
  }

  return best && best.distance <= 360 ? best : null;
}

export default function MapScreen({ initialMap, onMapChange }: Props) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;
  const [canvasKey, setCanvasKey] = useState(0);
  const lastOrientation = useRef(isLandscape);
  const didMount = useRef(false);
  const linkFromIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  const [changeParentNodeId, setChangeParentNodeId] = useState<string | null>(null);
  const [repositionNodeId, setRepositionNodeId] = useState<string | null>(null);
  const [inspectorH, setInspectorH] = useState(0);
  const [canvasScale, setCanvasScale] = useState(1);
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [moveToast, setMoveToast] = useState<string | null>(null);
  const [moveInProgress, setMoveInProgress] = useState(false);
  const [largeMapContentMounted, setLargeMapContentMounted] = useState(false);
  const [largeMapVisible, setLargeMapVisible] = useState(false);
  const [smartRoutingReady, setSmartRoutingReady] = useState(false);
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>({
    tx: 0,
    ty: 0,
    scale: 1,
    width: screenW,
    height: screenH,
  });
  const [map, setMap] = useState<MindMap>(() => layoutStructuredMap(normalizeMap(initialMap, t)));
  const didNotifyMapChange = useRef(false);
  const mapRef = useRef(map);
  const canvasRef = useRef<ZoomableCanvasHandle | null>(null);
  const didAutoFitMapIdRef = useRef<string | null>(null);
  const zoomHudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeCacheRef = useRef<Map<string, RoutedEdge>>(new Map());

  const linkMode = linkFromId !== null;
  const changeParentMode = changeParentNodeId !== null;
  const totalNodeCount = Object.keys(map.nodes).length;
  const useCappedSurface = totalNodeCount >= PROGRESSIVE_RENDER_NODE_LIMIT;
  const worldReach = useMemo(() => {
    const entries = Object.values(map.nodes);
    if (entries.length === 0) {
      return { maxX: 0, maxY: 0 };
    }

    let maxReachX = 0;
    let maxReachY = 0;

    for (const node of entries) {
      const { halfW, halfH } = estimateNodeHalfBounds(node, node.id === map.rootId);
      maxReachX = Math.max(maxReachX, Math.abs(node.x) + halfW);
      maxReachY = Math.max(maxReachY, Math.abs(node.y) + halfH);
    }

    return {
      maxX: maxReachX,
      maxY: maxReachY,
    };
  }, [map.nodes, map.rootId]);

  const androidSurfaceCap = Math.max(2400, Math.round(8200 / PixelRatio.get()));
  const largeSurfaceCap = Platform.OS === "android" ? androidSurfaceCap : 9000;
  const worldPaddingX = Math.max(isLandscape ? 520 : 460, screenW * (useCappedSurface ? 1.15 : 0.62));
  const worldPaddingY = Math.max(isLandscape ? 460 : 520, screenH * (useCappedSurface ? 1.1 : 0.52));
  const minWorldW = Math.max(1200, screenW * 1.6);
  const minWorldH = Math.max(1200, screenH * 1.6);
  const desiredWorldW = Math.round(Math.max(minWorldW, (worldReach.maxX + worldPaddingX) * 2));
  const desiredWorldH = Math.round(Math.max(minWorldH, (worldReach.maxY + worldPaddingY) * 2));
  const WORLD_W = useCappedSurface
    ? desiredWorldW
    : Platform.OS === "android"
      ? Math.min(androidSurfaceCap, desiredWorldW)
      : desiredWorldW;
  const WORLD_H = useCappedSurface
    ? desiredWorldH
    : Platform.OS === "android"
      ? Math.min(androidSurfaceCap, desiredWorldH)
      : desiredWorldH;
  const SURFACE_W = useCappedSurface ? Math.min(largeSurfaceCap, desiredWorldW) : WORLD_W;
  const SURFACE_H = useCappedSurface ? Math.min(largeSurfaceCap, desiredWorldH) : WORLD_H;
  const worldToSurfaceX = useCallback(
    (x: number) => x * (SURFACE_W / Math.max(1, WORLD_W)),
    [SURFACE_W, WORLD_W]
  );
  const worldToSurfaceY = useCallback(
    (y: number) => y * (SURFACE_H / Math.max(1, WORLD_H)),
    [SURFACE_H, WORLD_H]
  );
  const surfaceToWorldX = useCallback(
    (x: number) => x * (WORLD_W / Math.max(1, SURFACE_W)),
    [SURFACE_W, WORLD_W]
  );
  const surfaceToWorldY = useCallback(
    (y: number) => y * (WORLD_H / Math.max(1, SURFACE_H)),
    [SURFACE_H, WORLD_H]
  );
  const VIEWBOX = `${-WORLD_W / 2} ${-WORLD_H / 2} ${WORLD_W} ${WORLD_H}`;
  const backgroundBase = isDark ? "#020617" : "#f8fafc";
  const showDotGrid = true;
  const dotMinor = isDark ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.28)";
  const dotMajor = isDark ? "rgba(148,163,184,0.28)" : "rgba(100,116,139,0.34)";

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      setCanvasKey((value) => value + 1);
      lastOrientation.current = isLandscape;
      return;
    }

    if (lastOrientation.current !== isLandscape) {
      lastOrientation.current = isLandscape;
      setCanvasKey((value) => value + 1);
    }
  }, [isLandscape]);

  useEffect(() => {
    linkFromIdRef.current = linkFromId;
  }, [linkFromId]);

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  useEffect(() => {
    routeCacheRef.current.clear();
  }, [map.nodes, map.edges]);

  useEffect(() => {
    if (!didNotifyMapChange.current) {
      didNotifyMapChange.current = true;
      return;
    }

    onMapChange?.(map);
  }, [map, onMapChange]);

  const applyMap = (updater: (prev: MindMap) => MindMap) => {
    setMap((prev) => {
      const next = updater(prev);
      return layoutStructuredMap({
        ...next,
        nodes: enforceRootConnectivity(next.nodes, next.rootId),
      });
    });
  };

  useEffect(() => {
    return () => {
      if (zoomHudTimeoutRef.current) {
        clearTimeout(zoomHudTimeoutRef.current);
      }
      if (moveToastTimeoutRef.current) {
        clearTimeout(moveToastTimeoutRef.current);
      }
    };
  }, []);

  const nodes = useMemo(() => Object.values(map.nodes), [map.nodes]);
  const mapBounds = useMemo(() => getMapBounds(nodes, map.rootId), [map.rootId, nodes]);
  const visibleNodeIds = useMemo(() => collectVisibleNodeIds(map), [map]);
  const visibleNodes = useMemo(
    () => nodes.filter((node) => visibleNodeIds.has(node.id)),
    [nodes, visibleNodeIds]
  );
  const largeMapMode = totalNodeCount >= PROGRESSIVE_RENDER_NODE_LIMIT;
  const viewportCullingEnabled = totalNodeCount > VIEWPORT_CULL_NODE_LIMIT;
  const importedLayoutMode =
    map.importedFormat?.sourceFormat === "mm" || map.importedFormat?.sourceFormat === "xmind";
  const selectiveSmartRouting = largeMapMode || importedLayoutMode;
  const shouldRenderMapContent = !largeMapMode || largeMapContentMounted;
  const isLargeMapLoading = largeMapMode && !largeMapVisible;
  const worldViewport = useMemo(
    () => makeWorldViewport(
      canvasTransform,
      largeMapMode ? 4.5 : 0.35,
      WORLD_W,
      WORLD_H,
      SURFACE_W,
      SURFACE_H
    ),
    [WORLD_H, WORLD_W, SURFACE_H, SURFACE_W, canvasTransform, largeMapMode]
  );
  const renderedVisibleNodes = useMemo(() => {
    if (!largeMapMode) {
      return visibleNodes;
    }
    if (!largeMapContentMounted) {
      return [];
    }
    if (!viewportCullingEnabled) {
      return visibleNodes;
    }

    const nextNodes = visibleNodes.filter((node) =>
      viewportContainsNode(worldViewport, node, node.id === map.rootId)
    );
    const included = new Set(nextNodes.map((node) => node.id));

    const includeNode = (nodeId: string | null) => {
      if (!nodeId || included.has(nodeId)) {
        return;
      }

      const node = map.nodes[nodeId];
      if (node && visibleNodeIds.has(nodeId)) {
        nextNodes.push(node);
        included.add(nodeId);
      }
    };

    includeNode(map.rootId);
    includeNode(selectedId);
    if (changeParentNodeId) {
      includeNode(changeParentNodeId);
    }
    if (linkFromId) {
      includeNode(linkFromId);
    }
    if (repositionNodeId) {
      includeNode(repositionNodeId);
    }

    return nextNodes;
  }, [changeParentNodeId, largeMapMode, largeMapContentMounted, linkFromId, map.nodes, map.rootId, repositionNodeId, selectedId, viewportCullingEnabled, visibleNodeIds, visibleNodes, worldViewport]);
  const renderedVisibleNodeIds = useMemo(
    () => new Set(renderedVisibleNodes.map((node) => node.id)),
    [renderedVisibleNodes]
  );
  useEffect(() => {
    setSmartRoutingReady(true);
  }, [largeMapMode, map.id, worldViewport.left, worldViewport.right, worldViewport.top, worldViewport.bottom]);
  useEffect(() => {
    if (!largeMapMode) {
      setLargeMapContentMounted(true);
      setLargeMapVisible(true);
      return;
    }

    setLargeMapContentMounted(false);
    setLargeMapVisible(false);
    const timer = setTimeout(() => {
      setLargeMapContentMounted(true);
    }, 120);

    return () => clearTimeout(timer);
  }, [largeMapMode, map.id]);
  useEffect(() => {
    if (!largeMapMode || !largeMapContentMounted) {
      return;
    }

    setLargeMapVisible(false);
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      revealTimer = setTimeout(() => {
        setLargeMapVisible(true);
      }, 900);
    });

    return () => {
      interaction.cancel?.();
      if (revealTimer) {
        clearTimeout(revealTimer);
      }
    };
  }, [largeMapContentMounted, largeMapMode, map.id]);
  const routeObstacles = useMemo(
    () => renderedVisibleNodes.map((node) => makeNodeRouteRect(node, node.id === map.rootId)),
    [map.rootId, renderedVisibleNodes]
  );
  const chooseEdgeRoute = useCallback((
    id: string,
    fromNode: MindMapNode,
    toNode: MindMapNode,
    excludedIds: Set<string>,
    committedRoutes: CommittedRoute[],
    baseSeed: number,
    styleKey: string
  ): { drawPoints?: EdgePoint[]; committedPoints: EdgePoint[] } => {
    const directPoints = [fromNode, toNode];
    const directHitsNode = routeObstacles.some((rect) =>
      !excludedIds.has(rect.id) && routeIntersectsRect(directPoints, rect)
    );
    const directHitsEdge = committedRoutes.some((route) =>
      routeIntersectsRoute(directPoints, route.points)
    );
    const shouldRouteEdge = !selectiveSmartRouting || directHitsNode || directHitsEdge;

    if (!shouldRouteEdge) {
      return { committedPoints: directPoints };
    }

    const localNodeObstacles = selectiveSmartRouting
      ? nearestRouteObstacles(fromNode, toNode, routeObstacles, excludedIds, LOCAL_ROUTE_OBSTACLE_LIMIT)
      : routeObstacles.filter((rect) => !excludedIds.has(rect.id));
    const committedSegmentRects = committedRoutes.flatMap((route) =>
      routeSegmentRects(route.points, route.id)
    );
    const localEdgeObstacles =
      selectiveSmartRouting && committedSegmentRects.length > LOCAL_ROUTE_OBSTACLE_LIMIT
        ? nearestRouteObstacles(fromNode, toNode, committedSegmentRects, new Set<string>(), LOCAL_ROUTE_OBSTACLE_LIMIT)
        : committedSegmentRects;
    const routeObstaclesForEdge = [...localNodeObstacles, ...localEdgeObstacles];
    const cacheKey = [
      id,
      fromNode.x,
      fromNode.y,
      toNode.x,
      toNode.y,
      styleKey,
      routeObstaclesForEdge.map((rect) => rect.id).join(","),
    ].join(":");
    const cached = routeCacheRef.current.get(cacheKey);
    if (cached?.points) {
      return { drawPoints: cached.points, committedPoints: cached.points };
    }

    const seeds = selectiveSmartRouting
      ? [baseSeed, baseSeed + 3, baseSeed + 6, baseSeed + 11]
      : [baseSeed];
    let bestPoints: EdgePoint[] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const seed of seeds) {
      const points = routeEdgePoints(fromNode, toNode, routeObstaclesForEdge, seed);
      const nodeHits = localNodeObstacles.reduce(
        (count, rect) => count + (routeIntersectsRect(points, rect) ? 1 : 0),
        0
      );
      const edgeHits = committedRoutes.reduce(
        (count, route) => count + (routeIntersectsRoute(points, route.points) ? 1 : 0),
        0
      );
      const bendPenalty = Math.max(0, points.length - 2) * 0.1;
      const score = nodeHits * 10 + edgeHits * 4 + bendPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestPoints = points;
      }

      if (score === 0) {
        break;
      }
    }

    const points = bestPoints ?? directPoints;
    routeCacheRef.current.set(cacheKey, { id, points });
    if (routeCacheRef.current.size > 1200) {
      routeCacheRef.current.clear();
    }

    return { drawPoints: points, committedPoints: points };
  }, [routeObstacles, selectiveSmartRouting]);

  const routedTreeEdges = useMemo(() => {
    if (!smartRoutingReady) {
      return {};
    }

    const routes: Record<string, RoutedEdge> = {};
    let routeIndex = 0;

    for (const parentNode of renderedVisibleNodes) {
      if (routeIndex >= MAX_RENDERED_EDGES_PER_FRAME) {
        break;
      }

      if (!renderedVisibleNodeIds.has(parentNode.id)) {
        continue;
      }

      for (let childIndex = 0; childIndex < parentNode.children.length; childIndex += 1) {
        if (routeIndex >= MAX_RENDERED_EDGES_PER_FRAME) {
          break;
        }

        const childId = parentNode.children[childIndex];
        const childNode = map.nodes[childId];
        if (!childNode || !renderedVisibleNodeIds.has(childId)) {
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
  }, [map.nodes, renderedVisibleNodeIds, renderedVisibleNodes, smartRoutingReady]);
  const routedRelationshipEdges = useMemo(() => {
    if (!smartRoutingReady) {
      return {};
    }

    const routes: Record<string, RoutedEdge> = {};
    const committedRoutes: CommittedRoute[] = [];
    for (const parentNode of renderedVisibleNodes) {
      if (committedRoutes.length >= MAX_RENDERED_EDGES_PER_FRAME) {
        break;
      }

      for (const childId of parentNode.children) {
        if (committedRoutes.length >= MAX_RENDERED_EDGES_PER_FRAME) {
          break;
        }

        const childNode = map.nodes[childId];
        if (!childNode || !renderedVisibleNodeIds.has(childId)) {
          continue;
        }

        const id = `tree-${parentNode.id}-${childId}`;
        committedRoutes.push({
          id,
          points: routedTreeEdges[id]?.points ?? [parentNode, childNode],
        });
      }
    }

    const remainingSlots = Math.max(0, MAX_RENDERED_EDGES_PER_FRAME - committedRoutes.length);
    if (remainingSlots === 0) {
      return routes;
    }

    let relationshipRouteCount = 0;
    map.edges.forEach((edge, edgeIndex) => {
      if (relationshipRouteCount >= remainingSlots) {
        return;
      }

      const fromNode = map.nodes[edge.fromId];
      const toNode = map.nodes[edge.toId];
      if (
        !fromNode ||
        !toNode ||
        !renderedVisibleNodeIds.has(edge.fromId) ||
        !renderedVisibleNodeIds.has(edge.toId)
      ) {
        return;
      }

      const excludedIds = new Set([edge.fromId, edge.toId]);
      const route = chooseEdgeRoute(
        edge.id,
        fromNode,
        toNode,
        excludedIds,
        committedRoutes,
        edgeIndex + 97,
        `${edge.style ?? "dashed"}:${edge.width ?? 2}`
      );
      routes[edge.id] = {
        id: edge.id,
        points: route.drawPoints,
      };
      committedRoutes.push({ id: edge.id, points: route.committedPoints });
      relationshipRouteCount += 1;
    });

    return routes;
  }, [chooseEdgeRoute, map.edges, map.nodes, renderedVisibleNodeIds, renderedVisibleNodes, routedTreeEdges, smartRoutingReady]);
  const renderedTreeEdgeRefs = useMemo(() => {
    const refs: { id: string; parentNode: MindMapNode; childNode: MindMapNode }[] = [];

    for (const parentNode of renderedVisibleNodes) {
      for (const childId of parentNode.children) {
        if (refs.length >= MAX_RENDERED_EDGES_PER_FRAME) {
          return refs;
        }

        const childNode = map.nodes[childId];
        if (!childNode || !renderedVisibleNodeIds.has(childId)) {
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
  }, [map.nodes, renderedVisibleNodeIds, renderedVisibleNodes]);
  const renderedRelationshipEdges = useMemo(() => {
    const remainingSlots = Math.max(0, MAX_RENDERED_EDGES_PER_FRAME - renderedTreeEdgeRefs.length);
    if (remainingSlots === 0) {
      return [];
    }

    const refs: RelationshipEdge[] = [];
    for (const edge of map.edges) {
      if (refs.length >= remainingSlots) {
        break;
      }

      if (renderedVisibleNodeIds.has(edge.fromId) && renderedVisibleNodeIds.has(edge.toId)) {
        refs.push(edge);
      }
    }

    return refs;
  }, [map.edges, renderedTreeEdgeRefs.length, renderedVisibleNodeIds]);
  const mapRenderProgress = largeMapMode
    ? largeMapVisible ? 100 : largeMapContentMounted ? 90 : 55
    : 100;
  const showMapRenderProgress = isLargeMapLoading;
  const trimmedSearchQuery = searchQuery.trim();
  const searchResults = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);
    if (!query) {
      return [];
    }

    return nodes
      .map((node) => {
        const fields = [
          node.title,
          node.note,
          node.dueAt,
          ...(node.tags ?? []),
          ...(node.attachments ?? []).map((attachment) => attachment.name),
        ];
        const haystack = normalizeSearchValue(fields.join(" "));
        if (!haystack.includes(query)) {
          return null;
        }

        const tagMatch = (node.tags ?? []).some((tag) => normalizeSearchValue(tag).includes(query));
        const noteMatch = normalizeSearchValue(node.note).includes(query);
        const hidden = !visibleNodeIds.has(node.id);

        return {
          node,
          subtitle: tagMatch
            ? `${t("map.tagMatch")}${hidden ? ` ${t("map.hiddenCollapsed")}` : ""}`
            : noteMatch
              ? `${t("map.noteMatch")}${hidden ? ` ${t("map.hiddenCollapsed")}` : ""}`
              : node.collapsed
                ? `${t("map.titleMatch")} ${t("map.collapsed")}`
                : hidden
                  ? `${t("map.titleMatch")} ${t("map.hiddenCollapsed")}`
                  : t("map.titleMatch"),
        };
      })
      .filter(Boolean)
      .slice(0, 8) as { node: MindMapNode; subtitle: string }[];
  }, [nodes, searchQuery, t, visibleNodeIds]);
  const selectedNode = selectedId ? map.nodes[selectedId] ?? null : null;
  const selectedEdge = selectedEdgeId ? map.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null;
  const selectedEdgeFromNode = selectedEdge ? map.nodes[selectedEdge.fromId] ?? null : null;
  const selectedEdgeToNode = selectedEdge ? map.nodes[selectedEdge.toId] ?? null : null;
  const shouldShowInspector = !!selectedNode && !linkMode && !changeParentMode && !selectedEdge && !repositionNodeId;
  const bottomInset = !isLandscape && shouldShowInspector ? Math.max(inspectorH, 220) : 0;
  const containerPaddingTop = isLandscape ? 0 : Math.max(insets.top, 8);
  const containerPaddingBottom = isLandscape ? Math.max(insets.bottom, 8) : Math.max(insets.bottom, 12);
  const containerPaddingLeft = isLandscape ? Math.max(insets.left, 12) : 16;
  const containerPaddingRight = isLandscape ? Math.max(insets.right, 12) : 16;
  const canvasTopGap = isLandscape ? 0 : 8;

  useEffect(() => {
    if (largeMapMode || !selectedNode || linkMode || changeParentMode || selectedEdge || repositionNodeId) {
      return;
    }

    const focusScale = canvasScale || 1;
    canvasRef.current?.centerOn(
      worldToSurfaceX(selectedNode.x),
      worldToSurfaceY(selectedNode.y),
      focusScale
    );
  }, [canvasScale, changeParentMode, largeMapMode, linkMode, repositionNodeId, selectedEdge, selectedNode, worldToSurfaceX, worldToSurfaceY]);

  useEffect(() => {
    if (!largeMapMode || !largeMapVisible || didAutoFitMapIdRef.current === map.id) {
      return;
    }

    didAutoFitMapIdRef.current = map.id;
    const availableW = Math.max(1, canvasTransform.width - 48);
    const availableH = Math.max(1, canvasTransform.height - 48);
    const contentW = Math.max(1, mapBounds.width * (SURFACE_W / Math.max(1, WORLD_W)));
    const contentH = Math.max(1, mapBounds.height * (SURFACE_H / Math.max(1, WORLD_H)));
    const fitScale = Math.max(
      0.25,
      Math.min(1, availableW / contentW, availableH / contentH)
    );

    const rootNode = map.nodes[map.rootId];
    canvasRef.current?.centerOn(
      worldToSurfaceX(rootNode?.x ?? mapBounds.centerX),
      worldToSurfaceY(rootNode?.y ?? mapBounds.centerY),
      fitScale
    );
  }, [
    SURFACE_H,
    SURFACE_W,
    WORLD_H,
    WORLD_W,
    canvasTransform.height,
    canvasTransform.width,
    largeMapMode,
    largeMapVisible,
    map.id,
    map.nodes,
    map.rootId,
    mapBounds.centerX,
    mapBounds.centerY,
    mapBounds.height,
    mapBounds.width,
    worldToSurfaceX,
    worldToSurfaceY,
  ]);

  const updateTitle = (nodeId: string, newTitle: string) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], title: newTitle },
      },
    }));
  };

  const updateNote = (nodeId: string, note: string | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], note },
      },
    }));
  };

  const updateTags = (nodeId: string, tags: string[]) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], tags: tags.length > 0 ? tags : undefined },
      },
    }));
  };

  const updateDueAt = (nodeId: string, dueAt: string | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], dueAt },
      },
    }));
  };

  const addAttachment = (nodeId: string, attachment: NodeAttachment) => {
    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) {
        return prev;
      }

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            attachments: [...(node.attachments ?? []), attachment],
          },
        },
      };
    });
  };

  const removeAttachment = (nodeId: string, attachmentId: string) => {
    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) {
        return prev;
      }

      const attachments = (node.attachments ?? []).filter((attachment) => attachment.id !== attachmentId);

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            attachments: attachments.length ? attachments : undefined,
          },
        },
      };
    });
  };

  const updateCollapsed = (nodeId: string, collapsed: boolean) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], collapsed },
      },
    }));
  };

  const updateColor = (nodeId: string, newColor: string | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], color: newColor },
      },
    }));
  };

  const updateSize = (nodeId: string, size: number) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], size },
      },
    }));
  };

  const updateShape = (nodeId: string, shape: NodeShape | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], shape },
      },
    }));
  };

  const updateEdge = (nodeId: string, patch: { style?: EdgeStyle; width?: number; color?: string }) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: {
          ...prev.nodes[nodeId],
          edgeToParent: {
            ...(prev.nodes[nodeId].edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" }),
            ...patch,
          },
        },
      },
    }));
  };

  const showMoveToast = useCallback((message: string) => {
    setMoveToast(message);
    if (moveToastTimeoutRef.current) {
      clearTimeout(moveToastTimeoutRef.current);
    }
    moveToastTimeoutRef.current = setTimeout(() => {
      setMoveToast(null);
      moveToastTimeoutRef.current = null;
    }, 2200);
  }, []);

  const attemptRepositionNode = useCallback((nodeId: string, x: number, y: number) => {
    const runMove = () => {
      try {
        const mapSnapshot = mapRef.current;
        const currentNode = mapSnapshot.nodes[nodeId];
        if (!currentNode || nodeId === mapSnapshot.rootId) {
          setRepositionNodeId(null);
          return;
        }

        const slot = findNearestInsertionSlot(mapSnapshot, nodeId, x, y);

        if (!slot) {
          showMoveToast(t("map.cannotMoveNodeThere"));
          return;
        }

        applyMap((prev) => ({
          ...prev,
          nodes: (() => {
            const node = prev.nodes[nodeId];
            const target = prev.nodes[slot.parentId];
            if (!node || !target) {
              return prev.nodes;
            }

            const nextNodes = { ...prev.nodes };
            if (node.parentId && nextNodes[node.parentId]) {
              nextNodes[node.parentId] = {
                ...nextNodes[node.parentId],
                children: nextNodes[node.parentId].children.filter((childId) => childId !== nodeId),
              };
            }

            const targetAfterRemoval = nextNodes[target.id] ?? target;
            const targetChildren = [...targetAfterRemoval.children.filter((childId) => childId !== nodeId)];
            let nextTargetChildren = targetChildren;

            if (target.id === prev.rootId) {
              const leftChildren = targetChildren.filter((childId) => (nextNodes[childId]?.x ?? 0) < target.x);
              const rightChildren = targetChildren.filter((childId) => (nextNodes[childId]?.x ?? 0) >= target.x);
              const sideChildren = slot.side < 0 ? leftChildren : rightChildren;
              const sideInsertIndex = Math.max(0, Math.min(sideChildren.length, slot.index));
              sideChildren.splice(sideInsertIndex, 0, nodeId);
              nextTargetChildren = slot.side < 0
                ? [...sideChildren, ...rightChildren]
                : [...leftChildren, ...sideChildren];
            } else {
              const insertIndex = Math.max(0, Math.min(targetChildren.length, slot.index));
              targetChildren.splice(insertIndex, 0, nodeId);
              nextTargetChildren = targetChildren;
            }

            nextNodes[target.id] = {
              ...targetAfterRemoval,
              collapsed: false,
              children: nextTargetChildren,
            };
            nextNodes[nodeId] = {
              ...node,
              parentId: target.id,
              x: target.x + slot.side * 230,
              y,
              edgeToParent: node.edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" },
            };

            return nextNodes;
          })(),
        }));
        setRepositionNodeId(null);
        setSelectedId(nodeId);
      } finally {
        setMoveInProgress(false);
      }
    };

    if (largeMapMode) {
      setMoveInProgress(true);
      setTimeout(runMove, 80);
      return;
    }

    runMove();
  }, [largeMapMode, showMoveToast, t]);

  const addChildToSelected = () => {
    if (!selectedId) {
      return;
    }

    const newId = `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    applyMap((prev) => {
      const parent = prev.nodes[selectedId];
      if (!parent) {
        return prev;
      }

      const root = prev.nodes[prev.rootId];
      const parentSide =
        parent.id === prev.rootId
          ? parent.children.filter((childId) => (prev.nodes[childId]?.x ?? 0) >= parent.x).length <=
              parent.children.filter((childId) => (prev.nodes[childId]?.x ?? 0) < parent.x).length
            ? 1
            : -1
          : parent.x < (root?.x ?? 0)
            ? -1
            : 1;

      const child: MindMapNode = {
        id: newId,
        parentId: parent.id,
        title: t("map.newNode"),
        x: parent.x + parentSide * 230,
        y: parent.y,
        children: [],
        size: 30,
        shape: "circle",
        edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
      };

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [newId]: child,
          [parent.id]: {
            ...parent,
            children: [...parent.children, newId],
          },
        },
      };
    });

    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setChangeParentNodeId(null);
    setSelectedId(newId);
  };

  const cancelLinkMode = () => {
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setSelectedEdgeId(null);
  };

  const startLinkMode = () => {
    if (!selectedId) {
      return;
    }

    if (linkFromId === selectedId) {
      cancelLinkMode();
      return;
    }

    setSelectedEdgeId(null);
    setChangeParentNodeId(null);
    linkFromIdRef.current = selectedId;
    setLinkFromId(selectedId);
  };

  const cancelChangeParentMode = () => {
    setChangeParentNodeId(null);
  };

  const startChangeParentMode = () => {
    if (!selectedId || selectedId === map.rootId) {
      return;
    }

    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setChangeParentNodeId(selectedId);
  };

  const handleSelectLinkTarget = useCallback((targetId: string) => {
    const fromId = linkFromIdRef.current;

    if (!fromId) {
      return;
    }

    if (targetId === fromId) {
      return;
    }

    applyMap((prev) => {
      if (!prev.nodes[fromId] || !prev.nodes[targetId]) {
        return prev;
      }

      if (hasRelationshipEdge(prev.edges, fromId, targetId)) {
        return prev;
      }

      return {
        ...prev,
        edges: [
          ...prev.edges,
          {
            id: `e_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            fromId,
            toId: targetId,
            ...DEFAULT_RELATIONSHIP_EDGE,
          },
        ],
      };
    });

    linkFromIdRef.current = null;
    setSelectedEdgeId(null);
    setLinkFromId(null);
    setChangeParentNodeId(null);
    setSelectedId(targetId);
  }, []);

  const handleSelectChangeParentTarget = useCallback((targetId: string) => {
    const nodeId = changeParentNodeId;
    if (!nodeId) {
      return;
    }

    const snapshot = mapRef.current;
    const currentNode = snapshot.nodes[nodeId];
    const targetNode = snapshot.nodes[targetId];
    const invalid =
      !currentNode ||
      !targetNode ||
      nodeId === snapshot.rootId ||
      targetId === nodeId ||
      currentNode.parentId === targetId;

    let cursor: string | null = targetId;
    while (!invalid && cursor) {
      if (cursor === nodeId) {
        showMoveToast(t("map.cannotSetParent"));
        return;
      }
      cursor = snapshot.nodes[cursor]?.parentId ?? null;
    }

    if (invalid) {
      showMoveToast(t("map.cannotSetParent"));
      return;
    }

    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      const target = prev.nodes[targetId];
      if (!node || !target || nodeId === prev.rootId || targetId === nodeId || node.parentId === targetId) {
        return prev;
      }

      let cursor: string | null = targetId;
      while (cursor) {
        if (cursor === nodeId) {
          return prev;
        }
        cursor = prev.nodes[cursor]?.parentId ?? null;
      }

      const nextNodes = { ...prev.nodes };
      if (node.parentId && nextNodes[node.parentId]) {
        nextNodes[node.parentId] = {
          ...nextNodes[node.parentId],
          children: nextNodes[node.parentId].children.filter((childId) => childId !== nodeId),
        };
      }

      nextNodes[targetId] = {
        ...target,
        collapsed: false,
        children: target.children.includes(nodeId) ? target.children : [...target.children, nodeId],
      };
      nextNodes[nodeId] = {
        ...node,
        parentId: targetId,
        edgeToParent: node.edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" },
      };

      return {
        ...prev,
        nodes: nextNodes,
      };
    });

    setChangeParentNodeId(null);
    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setSelectedId(nodeId);
  }, [changeParentNodeId, showMoveToast, t]);

  const handleSelectNode = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setChangeParentNodeId(null);
    setSelectedId(nodeId);
  }, []);

  const handleStartReposition = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setChangeParentNodeId(null);
    setSelectedId(null);
    setRepositionNodeId(nodeId);
  }, []);

  const revealNode = (nodeId: string) => {
    applyMap((prev) => {
      if (!prev.nodes[nodeId]) {
        return prev;
      }

      const nextNodes = { ...prev.nodes };
      let cursor = prev.nodes[nodeId];

      while (cursor?.parentId) {
        const parent = nextNodes[cursor.parentId];
        if (!parent) {
          break;
        }

        if (parent.collapsed) {
          nextNodes[parent.id] = { ...parent, collapsed: false };
        }

        cursor = parent;
      }

      return { ...prev, nodes: nextNodes };
    });
  };

  const handleSelectSearchResult = (nodeId: string) => {
    const targetNode = map.nodes[nodeId];
    revealNode(nodeId);
    Keyboard.dismiss();
    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setChangeParentNodeId(null);
    setSelectedId(nodeId);
    setSearchQuery("");

    if (targetNode) {
      canvasRef.current?.centerOn(
        worldToSurfaceX(targetNode.x),
        worldToSurfaceY(targetNode.y),
        1
      );
    }
  };

  const resetViewToRoot = () => {
    const rootNode = map.nodes[map.rootId];
    if (!rootNode) {
      canvasRef.current?.reset();
      return;
    }

    canvasRef.current?.centerOn(
      worldToSurfaceX(rootNode.x),
      worldToSurfaceY(rootNode.y),
      1
    );
  };

  const handleZoomGestureStart = () => {
    if (zoomHudTimeoutRef.current) {
      clearTimeout(zoomHudTimeoutRef.current);
      zoomHudTimeoutRef.current = null;
    }
    setZoomHudVisible(true);
  };

  const handleZoomGestureEnd = () => {
    if (zoomHudTimeoutRef.current) {
      clearTimeout(zoomHudTimeoutRef.current);
    }

    zoomHudTimeoutRef.current = setTimeout(() => {
      setZoomHudVisible(false);
      zoomHudTimeoutRef.current = null;
    }, 700);
  };

  const handleSelectRelationshipEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setChangeParentNodeId(null);
    setSelectedId(null);
  }, []);

  const handleLongPressRelationshipEdge = useCallback((edgeId: string) => {
    setSelectedId(null);
    setSelectedEdgeId(edgeId);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setChangeParentNodeId(null);
  }, []);

  const handleCanvasPress = useCallback(() => {
    if (repositionNodeId) {
      return;
    }

    Keyboard.dismiss();
    if (selectedEdgeId) {
      setSelectedEdgeId(null);
      return;
    }

    if (!linkMode && !changeParentMode) {
      setSelectedId(null);
    }
  }, [changeParentMode, linkMode, repositionNodeId, selectedEdgeId]);

  const handlePlacementTap = useCallback((locationX: number, locationY: number) => {
    if (!repositionNodeId) {
      return;
    }

    const target = canvasRef.current?.localToWorld(locationX, locationY);
    if (!target) {
      return;
    }

    attemptRepositionNode(
      repositionNodeId,
      surfaceToWorldX(target.x),
      surfaceToWorldY(target.y)
    );
  }, [attemptRepositionNode, repositionNodeId, surfaceToWorldX, surfaceToWorldY]);

  const deleteSelectedRelationshipEdge = () => {
    if (!selectedEdgeId) {
      return;
    }

    applyMap((prev) => ({
      ...prev,
      edges: prev.edges.filter((edge) => edge.id !== selectedEdgeId),
    }));

    setSelectedEdgeId(null);
  };

  const updateSelectedRelationshipEdge = (patch: {
    style?: EdgeStyle;
    width?: number;
    color?: string;
  }) => {
    if (!selectedEdgeId) {
      return;
    }

    applyMap((prev) => ({
      ...prev,
      edges: prev.edges.map((edge) =>
        edge.id === selectedEdgeId
          ? {
              ...edge,
              ...patch,
            }
          : edge
      ),
    }));
  };

  const deleteConnection = (nodeId: string, connectedNodeId: string) => {
    applyMap((prev) => ({
      ...prev,
      edges: removeRelationshipEdge(prev.edges, nodeId, connectedNodeId),
    }));

    if (
      selectedEdge &&
      ((selectedEdge.fromId === nodeId && selectedEdge.toId === connectedNodeId) ||
        (selectedEdge.fromId === connectedNodeId && selectedEdge.toId === nodeId))
    ) {
      setSelectedEdgeId(null);
    }
  };

  const deleteNode = (nodeId: string) => {
    applyMap((prev) => {
      const node = prev.nodes[nodeId];
      if (!node || nodeId === prev.rootId) {
        return prev;
      }

      const nextNodes = { ...prev.nodes };
      const parentId = node.parentId;

      for (const childId of node.children) {
        const child = nextNodes[childId];
        if (child) {
          nextNodes[childId] = {
            ...child,
            parentId,
          };
        }
      }

      if (parentId && nextNodes[parentId]) {
        nextNodes[parentId] = {
          ...nextNodes[parentId],
          children: nextNodes[parentId].children.flatMap((childId) =>
            childId === nodeId ? [...node.children] : [childId]
          ),
        };
      }

      delete nextNodes[nodeId];

      return {
        ...prev,
        nodes: nextNodes,
        edges: prev.edges.filter((edge) => edge.fromId !== nodeId && edge.toId !== nodeId),
      };
    });

    if (selectedId === nodeId) {
      setSelectedId(null);
    }
    if (linkFromIdRef.current === nodeId) {
      linkFromIdRef.current = null;
      setLinkFromId(null);
    }
    if (selectedEdge && (selectedEdge.fromId === nodeId || selectedEdge.toId === nodeId)) {
      setSelectedEdgeId(null);
    }
  };

  const renderSvgNode = (node: MindMapNode) => {
    const isRootNode = node.id === map.rootId;
    const selected = node.id === selectedId;
    const placementMode = repositionNodeId === node.id;
    const bounds = getNodeRenderBounds(node, isRootNode);
    const isCapsule = node.shape === "capsule";
    const isCircle = node.shape === "circle";
    const fillDefault = isRootNode ? "#0ea5e9" : "#ffffff";
    const fill = node.color ?? fillDefault;
    const textColor = isRootNode && !node.color ? "#ffffff" : "#0f172a";
    const stroke = placementMode ? "#f59e0b" : selected ? "#0284c7" : isDark ? "rgba(148,163,184,0.5)" : "rgba(255,255,255,0.9)";
    const hasMeta = !!node.note || !!node.dueAt || (node.attachments ?? []).length > 0 || (node.tags ?? []).length > 0;
    const imageAttachment = getNodeImageAttachment(node);
    const hasCollapsedChildren = !!node.collapsed && node.children.length > 0;
    const baseR = Math.max(isRootNode ? 42 : 30, node.size ?? (isRootNode ? 42 : 30));
    const fontSize = Math.max(12, Math.round(baseR * (isRootNode ? 0.45 : 0.38)));
    const rx = isCapsule ? bounds.height / 2 : isCircle ? Math.min(bounds.width, bounds.height) / 2 : 18;

    const handleNodePress = (event?: { stopPropagation?: () => void }) => {
      event?.stopPropagation?.();
      if (placementMode) {
        return;
      }

      if (changeParentMode) {
        handleSelectChangeParentTarget(node.id);
        return;
      }

      if (linkMode) {
        handleSelectLinkTarget(node.id);
        return;
      }

      handleSelectNode(node.id);
    };

    const handleNodeLongPress = (event?: { stopPropagation?: () => void }) => {
      event?.stopPropagation?.();
      if (linkMode || changeParentMode || placementMode) {
        return;
      }

      handleStartReposition(node.id);
    };

    return (
      <G key={node.id} onPress={handleNodePress} onLongPress={handleNodeLongPress}>
        <Rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          rx={rx}
          fill={fill}
          stroke={stroke}
          strokeWidth={selected || placementMode ? 3 : 1.5}
        />
        <SvgText
          x={node.x + (imageAttachment ? (NODE_IMAGE_THUMB_SIZE + 6) / 2 : 0)}
          y={node.y + (hasMeta ? -3 : 5)}
          fill={textColor}
          fontSize={fontSize}
          fontWeight="800"
          textAnchor="middle"
        >
          {getDisplayNodeTitle(node.title)}
        </SvgText>
        {imageAttachment ? (
          <>
            <Rect
              x={node.x - (getDisplayNodeTitle(node.title).length * fontSize * 0.3) - NODE_IMAGE_THUMB_SIZE - 4}
              y={node.y + (hasMeta ? -3 : 5) - NODE_IMAGE_THUMB_SIZE + 3}
              width={NODE_IMAGE_THUMB_SIZE}
              height={NODE_IMAGE_THUMB_SIZE}
              rx={4}
              fill={isRootNode ? "rgba(224,242,254,0.22)" : "rgba(224,242,254,0.92)"}
            />
            <Circle
              cx={node.x - (getDisplayNodeTitle(node.title).length * fontSize * 0.3) - NODE_IMAGE_THUMB_SIZE / 2 - 4}
              cy={node.y + (hasMeta ? -3 : 5) - 9}
              r={2.3}
              fill={isRootNode ? "#e0f2fe" : "#0369a1"}
            />
            <Rect
              x={node.x - (getDisplayNodeTitle(node.title).length * fontSize * 0.3) - NODE_IMAGE_THUMB_SIZE}
              y={node.y + (hasMeta ? -3 : 5) - 5}
              width={NODE_IMAGE_THUMB_SIZE - 8}
              height={4}
              rx={1.5}
              fill={isRootNode ? "#e0f2fe" : "#0369a1"}
            />
          </>
        ) : null}
        {hasMeta ? (
          <G>
            <Circle cx={node.x - 12} cy={bounds.y + bounds.height - 14} r={3.5} fill={isRootNode ? "#e0f2fe" : "#0369a1"} />
            <Circle cx={node.x} cy={bounds.y + bounds.height - 14} r={3.5} fill={isRootNode ? "#e0f2fe" : "#0369a1"} />
            <Circle cx={node.x + 12} cy={bounds.y + bounds.height - 14} r={3.5} fill={isRootNode ? "#e0f2fe" : "#0369a1"} />
          </G>
        ) : null}
        {hasCollapsedChildren ? (
          <G>
            <Circle cx={bounds.x + bounds.width - 8} cy={bounds.y + 8} r={11} fill="#0f172a" />
            <SvgText
              x={bounds.x + bounds.width - 8}
              y={bounds.y + 13}
              fill="#ffffff"
              fontSize={14}
              fontWeight="900"
              textAnchor="middle"
            >
              +
            </SvgText>
          </G>
        ) : null}
      </G>
    );
  };

  return (
    <View
      style={[
        styles.container,
        isDark && styles.containerDark,
        {
          paddingTop: containerPaddingTop,
          paddingBottom: containerPaddingBottom,
          paddingLeft: containerPaddingLeft,
          paddingRight: containerPaddingRight,
        },
      ]}
    >
      <View style={{ flex: 1, marginTop: canvasTopGap, overflow: "hidden", flexDirection: isLandscape ? "row" : "column" }}>
        <View style={{ flex: 1, marginBottom: isLandscape ? 0 : bottomInset, alignItems: "stretch", justifyContent: "center" }}>
          <ZoomableCanvas
            ref={canvasRef}
            key={`canvas:${map.id}:${canvasKey}`}
            enabled={!repositionNodeId}
            minScale={largeMapMode ? 0.12 : 0.25}
            maxScale={1}
            onScaleChange={setCanvasScale}
            onDoubleTap={resetViewToRoot}
            tapEnabled={!!repositionNodeId}
            onTapPoint={handlePlacementTap}
            onZoomGestureStart={handleZoomGestureStart}
            onZoomGestureEnd={handleZoomGestureEnd}
            onTransformChange={setCanvasTransform}
            notifyTransformDuringGesture
            transformNotifyIntervalMs={largeMapMode ? 180 : 80}
            notifyScaleDuringGesture={!largeMapMode}
            contentWidth={SURFACE_W}
            contentHeight={SURFACE_H}
          >
            <View style={{ width: SURFACE_W, height: SURFACE_H }}>
              <Svg
                width={SURFACE_W}
                height={SURFACE_H}
                viewBox={VIEWBOX}
                style={{ position: "absolute", top: 0, left: 0 }}
              >
                <Defs>
                  <Pattern
                    id="dotGridMinor"
                    patternUnits="userSpaceOnUse"
                    width={DOT_GRID_SMALL}
                    height={DOT_GRID_SMALL}
                  >
                    <Circle cx={DOT_GRID_SMALL / 2} cy={DOT_GRID_SMALL / 2} r={1.3} fill={dotMinor} />
                  </Pattern>
                  <Pattern
                    id="dotGridMajor"
                    patternUnits="userSpaceOnUse"
                    width={DOT_GRID_LARGE}
                    height={DOT_GRID_LARGE}
                  >
                    <Circle cx={DOT_GRID_LARGE / 2} cy={DOT_GRID_LARGE / 2} r={2} fill={dotMajor} />
                  </Pattern>
                </Defs>

                <Rect
                  x={-WORLD_W / 2}
                  y={-WORLD_H / 2}
                  width={WORLD_W}
                  height={WORLD_H}
                  fill={backgroundBase}
                />
                {showDotGrid ? (
                  <>
                    <Rect
                      x={-WORLD_W / 2}
                      y={-WORLD_H / 2}
                      width={WORLD_W}
                      height={WORLD_H}
                      fill="url(#dotGridMinor)"
                    />
                    <Rect
                      x={-WORLD_W / 2}
                      y={-WORLD_H / 2}
                      width={WORLD_W}
                      height={WORLD_H}
                      fill="url(#dotGridMajor)"
                    />
                  </>
                ) : null}
                <Rect
                  x={-WORLD_W / 2}
                  y={-WORLD_H / 2}
                  width={WORLD_W}
                  height={WORLD_H}
                  fill="transparent"
                  onPress={Platform.OS === "android" ? undefined : handleCanvasPress}
                />

                {shouldRenderMapContent ? renderedTreeEdgeRefs.map(({ id, parentNode, childNode }) => (
                  <EdgeView
                    key={id}
                    from={{ x: parentNode.x, y: parentNode.y }}
                    to={{ x: childNode.x, y: childNode.y }}
                    points={routedTreeEdges[id]?.points}
                    edgeStyle={childNode.edgeToParent?.style ?? "solid"}
                    width={childNode.edgeToParent?.width ?? 2}
                    color={childNode.edgeToParent?.color ?? "#9ca3af"}
                    endArrow
                    endArrowTargetBounds={estimateNodeHalfBounds(childNode, childNode.id === map.rootId)}
                  />
                )) : null}

                {shouldRenderMapContent ? renderedRelationshipEdges.map((edge) => {
                  const fromNode = map.nodes[edge.fromId];
                  const toNode = map.nodes[edge.toId];
                  if (!fromNode || !toNode) {
                    return null;
                  }

                  return (
                    <EdgeView
                      key={edge.id}
                      from={{ x: fromNode.x, y: fromNode.y }}
                      to={{ x: toNode.x, y: toNode.y }}
                      points={routedRelationshipEdges[edge.id]?.points}
                      edgeStyle={edge.style ?? "dashed"}
                      width={edge.width ?? 2}
                      color={edge.color ?? "#94a3b8"}
                      selected={selectedEdgeId === edge.id}
                      onPress={largeMapMode ? undefined : () => handleSelectRelationshipEdge(edge.id)}
                      onLongPress={largeMapMode ? undefined : () => handleLongPressRelationshipEdge(edge.id)}
                      hitSlopWidth={largeMapMode ? 0 : 20}
                    />
                  );
                }) : null}

                {shouldRenderMapContent && largeMapMode ? renderedVisibleNodes.map(renderSvgNode) : null}
              </Svg>

              {shouldRenderMapContent && !largeMapMode ? (
                <View style={{ position: "absolute", top: 0, left: 0, width: SURFACE_W, height: SURFACE_H }} pointerEvents="box-none">
                  {renderedVisibleNodes.map((node) => (
                    <EditableNodeView
                      key={node.id}
                      node={node}
                      worldWidth={SURFACE_W}
                      worldHeight={SURFACE_H}
                      isRoot={node.id === map.rootId}
                      selected={node.id === selectedId}
                      shape={node.shape}
                      placementMode={repositionNodeId === node.id}
                      linkMode={linkMode}
                      changeParentMode={changeParentMode}
                      onSelect={handleSelectNode}
                      onSelectLinkTarget={handleSelectLinkTarget}
                      onSelectChangeParentTarget={handleSelectChangeParentTarget}
                      onStartReposition={handleStartReposition}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </ZoomableCanvas>

          {!linkMode && !changeParentMode && !selectedEdge && !repositionNodeId ? (
            <View style={ui.topOverlay}>
              <View style={[ui.topRow, isLandscape && ui.topRowLandscape]}>
                <View style={[ui.searchPanel, isLandscape && ui.searchPanelLandscape]}>
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t("map.searchPlaceholder")}
                    placeholderTextColor="#94a3b8"
                    style={[ui.searchInput, isDark && ui.searchInputDark]}
                    returnKeyType="search"
                  />
                </View>
                <View style={[ui.topActions, isLandscape && ui.topActionsLandscape]}>
                  {selectedNode ? (
                    <Pressable onPress={addChildToSelected} style={({ pressed }) => [ui.actionButton, ui.primaryButton, pressed && ui.pressed]}>
                      <Text style={ui.primaryButtonText}>＋</Text>
                    </Pressable>
                  ) : null}
                  {selectedNode ? (
                    <Pressable onPress={startLinkMode} style={({ pressed }) => [ui.actionButton, ui.secondaryButton, isDark && ui.secondaryButtonDark, pressed && ui.pressed]}>
                      <Text style={[ui.secondaryButtonText, isDark && ui.secondaryButtonTextDark]}>{t("map.link")}</Text>
                    </Pressable>
                  ) : null}
                  {selectedNode && selectedNode.id !== map.rootId ? (
                    <Pressable onPress={startChangeParentMode} style={({ pressed }) => [ui.actionButton, ui.secondaryButton, isDark && ui.secondaryButtonDark, pressed && ui.pressed]}>
                      <Text style={[ui.secondaryButtonText, isDark && ui.secondaryButtonTextDark]}>{t("map.changeParent")}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {trimmedSearchQuery ? (
                <View style={[ui.searchResults, isDark && ui.searchResultsDark, isLandscape && ui.searchResultsLandscape]}>
                  {searchResults.length === 0 ? (
                    <Text style={[ui.searchEmpty, isDark && ui.searchEmptyDark]}>{t("map.noMatchingNodes")}</Text>
                  ) : (
                    searchResults.map(({ node, subtitle }) => (
                      <Pressable
                        key={node.id}
                        onPress={() => handleSelectSearchResult(node.id)}
                        style={({ pressed }) => [
                          ui.searchResultItem,
                          isDark && ui.searchResultItemDark,
                          pressed && ui.pressed,
                        ]}
                      >
                        <Text style={[ui.searchResultTitle, isDark && ui.searchResultTitleDark]}>{node.title}</Text>
                        <Text style={[ui.searchResultMeta, isDark && ui.searchResultMetaDark]}>{subtitle}</Text>
                      </Pressable>
                    ))
                  )}
                </View>
              ) : null}
            </View>
          ) : null}

          {linkMode ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.selectSecondNode")}</Text>
              <Pressable onPress={cancelLinkMode} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {changeParentMode ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.selectNewParentNode")}</Text>
              <Pressable onPress={cancelChangeParentMode} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {repositionNodeId ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.tapWhereMoveNode")}</Text>
              <Pressable onPress={() => setRepositionNodeId(null)} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {selectedEdge ? (
            <View style={[ui.edgePanel, isDark && ui.edgePanelDark, isLandscape && ui.edgePanelLandscape]}>
              <View style={ui.edgePanelHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[ui.edgePanelTitle, isDark && ui.edgePanelTitleDark]}>{t("map.relationship")}</Text>
                  <Text style={[ui.edgePanelMeta, isDark && ui.edgePanelMetaDark]}>
                    {(selectedEdgeFromNode?.title ?? t("common.unknown"))} → {(selectedEdgeToNode?.title ?? t("common.unknown"))}
                  </Text>
                </View>
                <Pressable onPress={deleteSelectedRelationshipEdge} style={({ pressed }) => [ui.deleteButton, pressed && ui.pressed]}>
                  <Text style={ui.deleteButtonText}>{t("map.deleteLink")}</Text>
                </Pressable>
              </View>

              <View style={ui.edgePanelSection}>
                <Text style={[ui.edgePanelLabel, isDark && ui.edgePanelLabelDark]}>{t("map.style")}</Text>
                <View style={ui.edgePills}>
                  {([
                    { key: "solid", label: t("map.solid") },
                    { key: "dashed", label: t("map.dashed") },
                  ] as const).map((item) => {
                    const active = (selectedEdge.style ?? "dashed") === item.key;
                    return (
                      <Pressable
                        key={item.key}
                        onPress={() => updateSelectedRelationshipEdge({ style: item.key })}
                        style={({ pressed }) => [
                          ui.edgePill,
                          isDark && ui.edgePillDark,
                          active && ui.edgePillActive,
                          pressed && ui.pressed,
                        ]}
                      >
                        <Text style={[ui.edgePillText, isDark && ui.edgePillTextDark, active && ui.edgePillTextActive]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={ui.edgePanelSection}>
                <Text style={[ui.edgePanelLabel, isDark && ui.edgePanelLabelDark]}>{t("map.width")}</Text>
                <View style={ui.edgeStepper}>
                  <Pressable
                    onPress={() =>
                      updateSelectedRelationshipEdge({
                        width: Math.max(1, (selectedEdge.width ?? 2) - 1),
                      })
                    }
                    style={({ pressed }) => [ui.edgeStepButton, isDark && ui.edgeStepButtonDark, pressed && ui.pressed]}
                  >
                    <Text style={[ui.edgeStepButtonText, isDark && ui.edgeStepButtonTextDark]}>−</Text>
                  </Pressable>
                  <Text style={[ui.edgeStepValue, isDark && ui.edgeStepValueDark]}>{selectedEdge.width ?? 2}</Text>
                  <Pressable
                    onPress={() =>
                      updateSelectedRelationshipEdge({
                        width: Math.min(10, (selectedEdge.width ?? 2) + 1),
                      })
                    }
                    style={({ pressed }) => [ui.edgeStepButton, isDark && ui.edgeStepButtonDark, pressed && ui.pressed]}
                  >
                    <Text style={[ui.edgeStepButtonText, isDark && ui.edgeStepButtonTextDark]}>＋</Text>
                  </Pressable>
                </View>
              </View>

              <View style={ui.edgePanelSection}>
                <Text style={[ui.edgePanelLabel, isDark && ui.edgePanelLabelDark]}>{t("map.color")}</Text>
                <View style={ui.edgePalette}>
                  {EDGE_PALETTE.map((color) => {
                    const active = (selectedEdge.color ?? DEFAULT_RELATIONSHIP_EDGE.color) === color;
                    return (
                      <Pressable
                        key={color}
                        onPress={() => updateSelectedRelationshipEdge({ color })}
                        style={({ pressed }) => [
                          ui.edgeSwatch,
                          { backgroundColor: color },
                          active && ui.edgeSwatchActive,
                          pressed && ui.pressed,
                        ]}
                      />
                    );
                  })}
                </View>
              </View>
            </View>
          ) : null}

          {zoomHudVisible ? (
            <View style={[ui.zoomHud, isLandscape && ui.zoomHudLandscape]}>
              <Text style={ui.zoomHudText}>{Math.round(canvasScale * 100)}%</Text>
            </View>
          ) : null}

          {moveToast ? (
            <View style={[ui.moveToast, isLandscape && ui.moveToastLandscape]}>
              <Text style={ui.moveToastText}>{moveToast}</Text>
            </View>
          ) : null}

          {moveInProgress ? (
            <View style={[ui.mapLoadOverlay, isDark && ui.mapLoadOverlayDark]}>
              <View style={[ui.mapLoadCard, isDark && ui.mapLoadCardDark, isLandscape && ui.mapLoadCardLandscape]}>
                <View style={ui.mapLoadProgressHeader}>
                  <Text style={[ui.mapLoadProgressTitle, isDark && ui.mapLoadProgressTitleDark]}>
                    {t("map.movingNode")}
                  </Text>
                  <ActivityIndicator color="#0ea5e9" />
                </View>
              </View>
            </View>
          ) : showMapRenderProgress ? (
            <View style={[ui.mapLoadOverlay, isDark && ui.mapLoadOverlayDark]}>
              <View style={[ui.mapLoadCard, isDark && ui.mapLoadCardDark, isLandscape && ui.mapLoadCardLandscape]}>
                <View style={ui.mapLoadProgressHeader}>
                  <Text style={[ui.mapLoadProgressTitle, isDark && ui.mapLoadProgressTitleDark]}>
                    {t("map.loadingMap")}
                  </Text>
                  <Text style={[ui.mapLoadProgressPercent, isDark && ui.mapLoadProgressPercentDark]}>
                    {mapRenderProgress}%
                  </Text>
                </View>
                <View style={[ui.mapLoadProgressTrack, isDark && ui.mapLoadProgressTrackDark]}>
                  <View style={[ui.mapLoadProgressFill, { width: `${mapRenderProgress}%` }]} />
                </View>
              </View>
            </View>
          ) : null}
        </View>

        {shouldShowInspector ? (
          <NodeInspector
            mode={isLandscape ? "side" : "sheet"}
            sideWidth={340}
            node={selectedNode}
            nodes={map.nodes}
            edges={map.edges}
            onClose={() => setSelectedId(null)}
            onUpdateTitle={updateTitle}
            onUpdateNote={updateNote}
            onUpdateTags={updateTags}
            onUpdateDueAt={updateDueAt}
            onAddAttachment={addAttachment}
            onRemoveAttachment={removeAttachment}
            onUpdateCollapsed={updateCollapsed}
            onUpdateColor={updateColor}
            onUpdateSize={updateSize}
            onUpdateShape={updateShape}
            onUpdateEdge={updateEdge}
            onHeight={isLandscape ? () => {} : setInspectorH}
            onSelectNode={handleSelectNode}
            onDeleteConnection={deleteConnection}
            onDeleteNode={deleteNode}
          />
        ) : null}
      </View>
    </View>
  );
}
