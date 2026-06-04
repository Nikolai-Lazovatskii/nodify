/**
 * Súbor: src/screens/mapScreen/MapScreenImpl.tsx
 * Abstrakt: Implementuje hlavnú logiku editora mapy, uzlov, gest, hľadania a nástrojov.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Keyboard,
  PixelRatio,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, G, Pattern, Rect, Text as SvgText } from "react-native-svg";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/lang/LanguagePreference";

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
  findNearestInsertionSlot,
  getDisplayNodeTitle,
  getNodeImageAttachment,
  INSERTION_SLOT_X_GAP,
  makeNodeRouteRect,
  NODE_IMAGE_THUMB_SIZE,
  nearestRouteObstacles,
  routeEdgePoints,
  routeIntersectsRect,
  routeIntersectsRoute,
  type RouteRect,
  RoutedEdge,
  routeSegmentRects,
} from "./routing";
import { buildRelationshipDisplayColors, type RouteColorRef } from "./routeColors";
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

type RelationshipRouteCache = {
  routes: Map<string, RoutedEdge>;
  signatures: Map<string, string>;
  dirty: Set<string>;
};

function snapshotRoutes(routes: Map<string, RoutedEdge>) {
  const snapshot: Record<string, RoutedEdge> = {};

  for (const [id, route] of routes) {
    snapshot[id] = route;
  }

  return snapshot;
}

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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getNextDefaultNodeTitle(nodes: Record<string, MindMapNode>, localizedBaseTitle: string) {
  const knownBaseTitles = Array.from(new Set([localizedBaseTitle, "New node", "Nový uzol"]));
  let highestIndex = 0;

  for (const node of Object.values(nodes)) {
    const title = node.title.trim();

    for (const baseTitle of knownBaseTitles) {
      if (title === baseTitle) {
        highestIndex = Math.max(highestIndex, 1);
        continue;
      }

      const match = title.match(new RegExp(`^${escapeRegExp(baseTitle)}\\s+(\\d+)$`));
      if (match) {
        highestIndex = Math.max(highestIndex, Number(match[1]));
      }
    }
  }

  return `${localizedBaseTitle} ${highestIndex + 1}`;
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
  const lref = useRef<string | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [seid, setSeid] = useState<string | null>(null);
  const [lnk, setLnk] = useState<string | null>(null);
  const [cpId, setCpId] = useState<string | null>(null);
  const [rpId, setRpId] = useState<string | null>(null);
  const [ih, setIh] = useState(0);
  const [z, setZ] = useState(1);
  const [zh, setZh] = useState(false);
  const [q, setQ] = useState("");
  const [mt, setMt] = useState<string | null>(null);
  const [mb, setMb] = useState(false);
  const [bigM, setBigM] = useState(false);
  const [bigV, setBigV] = useState(false);
  const [sr, setSr] = useState(false);
  const [rre, setRre] = useState<Record<string, RoutedEdge>>({});
  const [ct, setCt] = useState<CanvasTransform>({
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
  const zhRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mtRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rcr = useRef<Map<string, RoutedEdge>>(new Map());
  const rrcr = useRef<RelationshipRouteCache>({
    routes: new Map(),
    signatures: new Map(),
    dirty: new Set(),
  });

  const lm = lnk !== null;
  const cpm = cpId !== null;
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
    lref.current = lnk;
  }, [lnk]);

  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  useEffect(() => {
    rcr.current.clear();
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
      if (zhRef.current) {
        clearTimeout(zhRef.current);
      }
      if (mtRef.current) {
        clearTimeout(mtRef.current);
      }
    };
  }, []);

  const nodes = useMemo(() => Object.values(map.nodes), [map.nodes]);
  const mapBounds = useMemo(() => getMapBounds(nodes, map.rootId), [map.rootId, nodes]);
  const viditelneIdcka = useMemo(() => collectVisibleNodeIds(map), [map]);
  const viditelneUzly = useMemo(
    () => nodes.filter((node) => viditelneIdcka.has(node.id)),
    [nodes, viditelneIdcka]
  );
  const podpisGeometrie = useMemo(() => {
    return [...viditelneUzly]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => {
        const attachmentCount = node.attachments?.length ?? 0;
        const tagCount = node.tags?.length ?? 0;
        return [
          node.id,
          node.x,
          node.y,
          node.size ?? "",
          node.title,
          node.note ? 1 : 0,
          node.dueAt ?? "",
          attachmentCount,
          tagCount,
          node.collapsed ? 1 : 0,
          node.children.join(","),
        ].join(":");
      })
      .join("|");
  }, [viditelneUzly]);
  const velkaMapa = totalNodeCount >= PROGRESSIVE_RENDER_NODE_LIMIT;
  const orezVyrezu = totalNodeCount > VIEWPORT_CULL_NODE_LIMIT;
  const importRozlozenie =
    map.importedFormat?.sourceFormat === "mm" || map.importedFormat?.sourceFormat === "xmind";
  const mudreCesty = velkaMapa || importRozlozenie;
  const podpisyVztahov = useMemo(() => {
    return map.edges.map((edge, edgeIndex) => ({
      id: edge.id,
      signature: [
        edgeIndex,
        edge.id,
        edge.fromId,
        edge.toId,
        edge.style ?? "",
        edge.width ?? "",
        mudreCesty ? 1 : 0,
        podpisGeometrie,
      ].join("|"),
    }));
  }, [map.edges, podpisGeometrie, mudreCesty]);
  const prekazkyCiest = useMemo(
    () => viditelneUzly.map((node) => makeNodeRouteRect(node, node.id === map.rootId, 26)),
    [map.rootId, viditelneUzly]
  );
  const stromoveCesty = useMemo<RouteColorRef[]>(() => {
    const routes: RouteColorRef[] = [];

    for (const parentNode of viditelneUzly) {
      for (const childId of parentNode.children) {
        const childNode = map.nodes[childId];
        if (!childNode || !viditelneIdcka.has(childId)) {
          continue;
        }

        routes.push({
          id: `tree-${parentNode.id}-${childId}`,
          points: getStructuredTreeEdgePoints(parentNode, childNode),
          color: childNode.edgeToParent?.color ?? "#9ca3af",
        });
      }
    }

    return routes;
  }, [map.nodes, viditelneIdcka, viditelneUzly]);
  const kreslitObsah = !velkaMapa || bigM;
  const nacitavaVelka = velkaMapa && !bigV;
  const svetovyVyrez = useMemo(
    () => makeWorldViewport(
      ct,
      velkaMapa ? 4.5 : 0.35,
      WORLD_W,
      WORLD_H,
      SURFACE_W,
      SURFACE_H
    ),
    [WORLD_H, WORLD_W, SURFACE_H, SURFACE_W, ct, velkaMapa]
  );
  const kresleneUzly = useMemo(() => {
    if (!velkaMapa) {
      return viditelneUzly;
    }
    if (!bigM) {
      return [];
    }
    if (!orezVyrezu) {
      return viditelneUzly;
    }

    const nextNodes = viditelneUzly.filter((node) =>
      viewportContainsNode(svetovyVyrez, node, node.id === map.rootId)
    );
    const included = new Set(nextNodes.map((node) => node.id));

    const includeNode = (nodeId: string | null) => {
      if (!nodeId || included.has(nodeId)) {
        return;
      }

      const node = map.nodes[nodeId];
      if (node && viditelneIdcka.has(nodeId)) {
        nextNodes.push(node);
        included.add(nodeId);
      }
    };

    includeNode(map.rootId);
    includeNode(sid);
    if (cpId) {
      includeNode(cpId);
    }
    if (lnk) {
      includeNode(lnk);
    }
    if (rpId) {
      includeNode(rpId);
    }

    return nextNodes;
  }, [
    cpId,
    velkaMapa,
    bigM,
    lnk,
    map.nodes,
    map.rootId,
    rpId,
    sid,
    orezVyrezu,
    viditelneIdcka,
    viditelneUzly,
    svetovyVyrez,
  ]);
  const kresleneIdcka = useMemo(
    () => new Set(kresleneUzly.map((node) => node.id)),
    [kresleneUzly]
  );
  useEffect(() => {
    setSr(true);
  }, [velkaMapa, map.id, svetovyVyrez.left, svetovyVyrez.right, svetovyVyrez.top, svetovyVyrez.bottom]);
  useEffect(() => {
    if (!velkaMapa) {
      setBigM(true);
      setBigV(true);
      return;
    }

    setBigM(false);
    setBigV(false);
    const timer = setTimeout(() => {
      setBigM(true);
    }, 120);

    return () => clearTimeout(timer);
  }, [velkaMapa, map.id]);
  useEffect(() => {
    if (!velkaMapa || !bigM) {
      return;
    }

    setBigV(false);
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const interaction = InteractionManager.runAfterInteractions(() => {
      revealTimer = setTimeout(() => {
        setBigV(true);
      }, 900);
    });

    return () => {
      interaction.cancel?.();
      if (revealTimer) {
        clearTimeout(revealTimer);
      }
    };
  }, [bigM, velkaMapa, map.id]);
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
    const shouldRouteEdge = !mudreCesty || directHitsNode || directHitsEdge;

    if (!shouldRouteEdge) {
      return { drawPoints: directPoints, committedPoints: directPoints };
    }

    const localNodeObstacles = mudreCesty
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
    const cached = rcr.current.get(cacheKey);
    if (cached?.points) {
      const cachedScore = scoreRoute(cached.points);
      if (cachedScore.nodeHits === 0 && cachedScore.edgeHits === 0) {
        return { drawPoints: cached.points, committedPoints: cached.points };
      }
    }

    const seeds = mudreCesty
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
    rcr.current.set(cacheKey, { id, points });
    if (rcr.current.size > 1200) {
      rcr.current.clear();
    }

    return { drawPoints: points, committedPoints: points };
  }, [mudreCesty]);

  const routedTreeEdges = useMemo(() => {
    if (!sr) {
      return {};
    }

    const routes: Record<string, RoutedEdge> = {};
    let routeIndex = 0;

    for (const parentNode of kresleneUzly) {
      if (routeIndex >= MAX_RENDERED_EDGES_PER_FRAME) {
        break;
      }

      if (!kresleneIdcka.has(parentNode.id)) {
        continue;
      }

      for (let childIndex = 0; childIndex < parentNode.children.length; childIndex += 1) {
        if (routeIndex >= MAX_RENDERED_EDGES_PER_FRAME) {
          break;
        }

        const childId = parentNode.children[childIndex];
        const childNode = map.nodes[childId];
        if (!childNode || !kresleneIdcka.has(childId)) {
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
  }, [map.nodes, kresleneIdcka, kresleneUzly, sr]);
  useEffect(() => {
    const cache = rrcr.current;
    const liveIds = new Set(podpisyVztahov.map((item) => item.id));
    let changed = false;

    for (const id of Array.from(cache.routes.keys())) {
      if (!liveIds.has(id)) {
        cache.routes.delete(id);
        cache.signatures.delete(id);
        cache.dirty.delete(id);
        changed = true;
      }
    }

    for (const item of podpisyVztahov) {
      if (cache.signatures.get(item.id) !== item.signature) {
        cache.signatures.set(item.id, item.signature);
        cache.dirty.add(item.id);
      }
    }

    if (!sr || cache.dirty.size === 0) {
      if (changed) {
        setRre(snapshotRoutes(cache.routes));
      }
      return;
    }

    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (cancelled) {
        return;
      }

      const currentCache = rrcr.current;
      const dirtyIds = new Set(currentCache.dirty);
      if (dirtyIds.size === 0) {
        return;
      }

      const nextRoutes = new Map(currentCache.routes);
      const committedRoutes: CommittedRoute[] = stromoveCesty.map((route) => ({
        id: route.id,
        points: route.points,
      }));

      map.edges.forEach((edge, edgeIndex) => {
        const fromNode = map.nodes[edge.fromId];
        const toNode = map.nodes[edge.toId];
        const existingRoute = nextRoutes.get(edge.id);

        if (!fromNode || !toNode || !viditelneIdcka.has(edge.fromId) || !viditelneIdcka.has(edge.toId)) {
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
          prekazkyCiest
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
      setRre(snapshotRoutes(currentCache.routes));
    });

    return () => {
      cancelled = true;
      interaction.cancel?.();
    };
  }, [
    chooseEdgeRoute,
    map.edges,
    map.nodes,
    podpisyVztahov,
    prekazkyCiest,
    stromoveCesty,
    sr,
    viditelneIdcka,
  ]);
  const stromHrany = useMemo(() => {
    const refs: { id: string; parentNode: MindMapNode; childNode: MindMapNode }[] = [];

    for (const parentNode of kresleneUzly) {
      for (const childId of parentNode.children) {
        if (refs.length >= MAX_RENDERED_EDGES_PER_FRAME) {
          return refs;
        }

        const childNode = map.nodes[childId];
        if (!childNode || !kresleneIdcka.has(childId)) {
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
  }, [map.nodes, kresleneIdcka, kresleneUzly]);
  const vztahHrany = useMemo(() => {
    const remainingSlots = Math.max(0, MAX_RENDERED_EDGES_PER_FRAME - stromHrany.length);
    if (remainingSlots === 0) {
      return [];
    }

    const refs: RelationshipEdge[] = [];
    for (const edge of map.edges) {
      if (refs.length >= remainingSlots) {
        break;
      }

      if (kresleneIdcka.has(edge.fromId) && kresleneIdcka.has(edge.toId)) {
        refs.push(edge);
      }
    }

    return refs;
  }, [map.edges, stromHrany.length, kresleneIdcka]);
  const farbyVztahov = useMemo(() => {
    const treeRoutes: RouteColorRef[] = stromHrany
      .map(({ id, parentNode, childNode }) => ({
        id,
        points: routedTreeEdges[id]?.points ?? [parentNode, childNode],
        color: childNode.edgeToParent?.color ?? "#9ca3af",
      }))
      .filter((route) => route.points.length >= 2);
    const relationshipRoutes: RouteColorRef[] = vztahHrany
      .map((edge) => {
        const points = rre[edge.id]?.points;
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
    return buildRelationshipDisplayColors(treeRoutes, relationshipRoutes, EDGE_PALETTE);
  }, [vztahHrany, stromHrany, rre, routedTreeEdges]);
  const postupMapy = velkaMapa
    ? bigV ? 100 : bigM ? 90 : 55
    : 100;
  const ukazPostupMapy = nacitavaVelka;
  const hladaneTrim = q.trim();
  const vysledkyHladania = useMemo(() => {
    const query = normalizeSearchValue(q);
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
        const hidden = !viditelneIdcka.has(node.id);

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
  }, [nodes, q, t, viditelneIdcka]);
  const selectedNode = sid ? map.nodes[sid] ?? null : null;
  const selectedEdge = seid ? map.edges.find((edge) => edge.id === seid) ?? null : null;
  const selectedEdgeFromNode = selectedEdge ? map.nodes[selectedEdge.fromId] ?? null : null;
  const selectedEdgeToNode = selectedEdge ? map.nodes[selectedEdge.toId] ?? null : null;
  const shouldShowInspector = !!selectedNode && !lm && !cpm && !selectedEdge && !rpId;
  const bottomInset = !isLandscape && shouldShowInspector ? Math.max(ih, 220) : 0;
  const containerPaddingTop = isLandscape ? 0 : Math.max(insets.top, 8);
  const containerPaddingBottom = isLandscape ? Math.max(insets.bottom, 8) : Math.max(insets.bottom, 12);
  const containerPaddingLeft = isLandscape ? Math.max(insets.left, 12) : 16;
  const containerPaddingRight = isLandscape ? Math.max(insets.right, 12) : 16;
  const canvasTopGap = isLandscape ? 0 : 8;
  const inspectorSideWidth = Math.min(360, Math.max(292, screenW * 0.34));

  useEffect(() => {
    if (velkaMapa || !selectedNode || lm || cpm || selectedEdge || rpId) {
      return;
    }

    const focusScale = z || 1;
    canvasRef.current?.centerOn(
      worldToSurfaceX(selectedNode.x),
      worldToSurfaceY(selectedNode.y),
      focusScale
    );
  }, [
    z,
    cpm,
    velkaMapa,
    lm,
    rpId,
    selectedEdge,
    selectedNode,
    worldToSurfaceX,
    worldToSurfaceY,
  ]);

  useEffect(() => {
    if (!velkaMapa || !bigV || didAutoFitMapIdRef.current === map.id) {
      return;
    }

    didAutoFitMapIdRef.current = map.id;
    const availableW = Math.max(1, ct.width - 48);
    const availableH = Math.max(1, ct.height - 48);
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
    ct.height,
    ct.width,
    velkaMapa,
    bigV,
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
    setMt(message);
    if (mtRef.current) {
      clearTimeout(mtRef.current);
    }
    mtRef.current = setTimeout(() => {
      setMt(null);
      mtRef.current = null;
    }, 2200);
  }, []);

  const attemptRepositionNode = useCallback((nodeId: string, x: number, y: number) => {
    const runMove = () => {
      try {
        const mapSnapshot = mapRef.current;
        const currentNode = mapSnapshot.nodes[nodeId];
        if (!currentNode || nodeId === mapSnapshot.rootId) {
          setRpId(null);
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
              x: target.x + slot.side * INSERTION_SLOT_X_GAP,
              y,
              edgeToParent: node.edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" },
            };

            return nextNodes;
          })(),
        }));
        setRpId(null);
        setSid(nodeId);
      } finally {
        setMb(false);
      }
    };

    if (velkaMapa) {
      setMb(true);
      setTimeout(runMove, 80);
      return;
    }

    runMove();
  }, [velkaMapa, showMoveToast, t]);

  const addChildToSelected = () => {
    if (!sid) {
      return;
    }

    const newId = `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    applyMap((prev) => {
      const parent = prev.nodes[sid];
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
        title: getNextDefaultNodeTitle(prev.nodes, t("map.newNode")),
        x: parent.x + parentSide * INSERTION_SLOT_X_GAP,
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

    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(newId);
  };

  const cancelLinkMode = () => {
    lref.current = null;
    setLnk(null);
    setSeid(null);
  };

  const startLinkMode = () => {
    if (!sid) {
      return;
    }

    if (lnk === sid) {
      cancelLinkMode();
      return;
    }

    setSeid(null);
    setCpId(null);
    lref.current = sid;
    setLnk(sid);
  };

  const cancelChangeParentMode = () => {
    setCpId(null);
  };

  const startChangeParentMode = () => {
    if (!sid || sid === map.rootId) {
      return;
    }

    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(sid);
  };

  const handleSelectLinkTarget = useCallback((targetId: string) => {
    const fromId = lref.current;

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

    lref.current = null;
    setSeid(null);
    setLnk(null);
    setCpId(null);
    setSid(null);
  }, []);

  const handleSelectChangeParentTarget = useCallback((targetId: string) => {
    const nodeId = cpId;
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

    setCpId(null);
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setSid(nodeId);
  }, [cpId, showMoveToast, t]);

  const handleSelectNode = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(nodeId);
  }, []);

  const handleStartReposition = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(null);
    setRpId(nodeId);
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
    setSeid(null);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(nodeId);
    setQ("");

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
    if (zhRef.current) {
      clearTimeout(zhRef.current);
      zhRef.current = null;
    }
    setZh(true);
  };

  const handleZoomGestureEnd = () => {
    if (zhRef.current) {
      clearTimeout(zhRef.current);
    }

    zhRef.current = setTimeout(() => {
      setZh(false);
      zhRef.current = null;
    }, 700);
  };

  const handleSelectRelationshipEdge = useCallback((edgeId: string) => {
    setSeid(edgeId);
    lref.current = null;
    setLnk(null);
    setCpId(null);
    setSid(null);
  }, []);

  const handleLongPressRelationshipEdge = useCallback((edgeId: string) => {
    setSid(null);
    setSeid(edgeId);
    lref.current = null;
    setLnk(null);
    setCpId(null);
  }, []);

  const handleCanvasPress = useCallback(() => {
    if (rpId) {
      return;
    }

    Keyboard.dismiss();
    if (seid) {
      setSeid(null);
      return;
    }

    if (!lm && !cpm) {
      setSid(null);
    }
  }, [cpm, lm, rpId, seid]);

  const handlePlacementTap = useCallback((locationX: number, locationY: number) => {
    if (!rpId) {
      return;
    }

    const target = canvasRef.current?.localToWorld(locationX, locationY);
    if (!target) {
      return;
    }

    attemptRepositionNode(
      rpId,
      surfaceToWorldX(target.x),
      surfaceToWorldY(target.y)
    );
  }, [attemptRepositionNode, rpId, surfaceToWorldX, surfaceToWorldY]);

  const deleteSelectedRelationshipEdge = () => {
    if (!seid) {
      return;
    }

    applyMap((prev) => ({
      ...prev,
      edges: prev.edges.filter((edge) => edge.id !== seid),
    }));

    setSeid(null);
  };

  const updateSelectedRelationshipEdge = (patch: {
    style?: EdgeStyle;
    width?: number;
    color?: string;
  }) => {
    if (!seid) {
      return;
    }

    applyMap((prev) => ({
      ...prev,
      edges: prev.edges.map((edge) =>
        edge.id === seid
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
      setSeid(null);
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

    if (sid === nodeId) {
      setSid(null);
    }
    if (lref.current === nodeId) {
      lref.current = null;
      setLnk(null);
    }
    if (selectedEdge && (selectedEdge.fromId === nodeId || selectedEdge.toId === nodeId)) {
      setSeid(null);
    }
  };

  const renderSvgNode = (node: MindMapNode) => {
    const isRootNode = node.id === map.rootId;
    const selected = node.id === sid;
    const placementMode = rpId === node.id;
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

      if (cpm) {
        handleSelectChangeParentTarget(node.id);
        return;
      }

      if (lm) {
        handleSelectLinkTarget(node.id);
        return;
      }

      handleSelectNode(node.id);
    };

    const handleNodeLongPress = (event?: { stopPropagation?: () => void }) => {
      event?.stopPropagation?.();
      if (lm || cpm || placementMode) {
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
            enabled={!rpId}
            minScale={velkaMapa ? 0.12 : 0.25}
            maxScale={1}
            onScaleChange={setZ}
            onDoubleTap={resetViewToRoot}
            tapEnabled={!!rpId}
            onTapPoint={handlePlacementTap}
            onZoomGestureStart={handleZoomGestureStart}
            onZoomGestureEnd={handleZoomGestureEnd}
            onTransformChange={setCt}
            notifyTransformDuringGesture
            transformNotifyIntervalMs={velkaMapa ? 180 : 80}
            notifyScaleDuringGesture={!velkaMapa}
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

                {kreslitObsah ? stromHrany.map(({ id, parentNode, childNode }) => (
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

                {kreslitObsah ? vztahHrany.map((edge) => {
                  const fromNode = map.nodes[edge.fromId];
                  const toNode = map.nodes[edge.toId];
                  const points = rre[edge.id]?.points;
                  if (!fromNode || !toNode || !points) {
                    return null;
                  }

                  return (
                    <EdgeView
                      key={edge.id}
                      from={{ x: fromNode.x, y: fromNode.y }}
                      to={{ x: toNode.x, y: toNode.y }}
                      points={points}
                      edgeStyle={edge.style ?? "dashed"}
                      width={edge.width ?? 2}
                      color={farbyVztahov[edge.id] ?? edge.color ?? "#94a3b8"}
                      selected={seid === edge.id}
                      onPress={velkaMapa ? undefined : () => handleSelectRelationshipEdge(edge.id)}
                      onLongPress={velkaMapa ? undefined : () => handleLongPressRelationshipEdge(edge.id)}
                      hitSlopWidth={velkaMapa ? 0 : 20}
                    />
                  );
                }) : null}

                {kreslitObsah && velkaMapa ? kresleneUzly.map(renderSvgNode) : null}
              </Svg>

              {kreslitObsah && !velkaMapa ? (
                <View style={{ position: "absolute", top: 0, left: 0, width: SURFACE_W, height: SURFACE_H }} pointerEvents="box-none">
                  {kresleneUzly.map((node) => (
                    <EditableNodeView
                      key={node.id}
                      node={node}
                      worldWidth={SURFACE_W}
                      worldHeight={SURFACE_H}
                      isRoot={node.id === map.rootId}
                      selected={node.id === sid}
                      shape={node.shape}
                      placementMode={rpId === node.id}
                      linkMode={lm}
                      changeParentMode={cpm}
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

          {!lm && !cpm && !selectedEdge && !rpId ? (
            <View style={[ui.topOverlay, isLandscape && ui.topOverlayLandscape]}>
              <View style={[ui.topRow, isLandscape && ui.topRowLandscape]}>
                <View style={[ui.searchPanel, isLandscape && ui.searchPanelLandscape]}>
                  <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder={t("map.searchPlaceholder")}
                    placeholderTextColor="#94a3b8"
                    style={[ui.searchInput, isDark && ui.searchInputDark]}
                    returnKeyType="search"
                  />
                </View>
                <View style={[ui.topActions, isLandscape && ui.topActionsLandscape]}>
                  {selectedNode ? (
                    <Pressable
                      onPress={addChildToSelected}
                      style={({ pressed }) => [
                        ui.actionButton,
                        isLandscape && ui.actionButtonLandscape,
                        ui.primaryButton,
                        pressed && ui.pressed,
                      ]}
                    >
                      <Text style={[ui.primaryButtonText, isLandscape && ui.primaryButtonTextLandscape]}>＋</Text>
                    </Pressable>
                  ) : null}
                  {selectedNode ? (
                    <Pressable
                      onPress={startLinkMode}
                      style={({ pressed }) => [
                        ui.actionButton,
                        isLandscape && ui.actionButtonLandscape,
                        ui.secondaryButton,
                        isDark && ui.secondaryButtonDark,
                        pressed && ui.pressed,
                      ]}
                    >
                      <Text style={[ui.secondaryButtonText, isLandscape && ui.secondaryButtonTextLandscape, isDark && ui.secondaryButtonTextDark]}>
                        {t("map.link")}
                      </Text>
                    </Pressable>
                  ) : null}
                  {selectedNode && selectedNode.id !== map.rootId ? (
                    <Pressable
                      onPress={startChangeParentMode}
                      style={({ pressed }) => [
                        ui.actionButton,
                        isLandscape && ui.actionButtonLandscape,
                        ui.secondaryButton,
                        isDark && ui.secondaryButtonDark,
                        pressed && ui.pressed,
                      ]}
                    >
                      <Text style={[ui.secondaryButtonText, isLandscape && ui.secondaryButtonTextLandscape, isDark && ui.secondaryButtonTextDark]}>
                        {t("map.changeParent")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {hladaneTrim ? (
                <View style={[ui.searchResults, isDark && ui.searchResultsDark, isLandscape && ui.searchResultsLandscape]}>
                  {vysledkyHladania.length === 0 ? (
                    <Text style={[ui.searchEmpty, isDark && ui.searchEmptyDark]}>{t("map.noMatchingNodes")}</Text>
                  ) : (
                    vysledkyHladania.map(({ node, subtitle }) => (
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

          {lm ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.selectSecondNode")}</Text>
              <Pressable onPress={cancelLinkMode} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {cpm ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.selectNewParentNode")}</Text>
              <Pressable onPress={cancelChangeParentMode} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
                <Text style={ui.bannerButtonText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          ) : null}

          {rpId ? (
            <View style={[ui.banner, isLandscape && ui.bannerLandscape]}>
              <Text style={ui.bannerText}>{t("map.tapWhereMoveNode")}</Text>
              <Pressable onPress={() => setRpId(null)} style={({ pressed }) => [ui.bannerButton, pressed && ui.pressed]}>
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

          {zh ? (
            <View style={[ui.zoomHud, isLandscape && ui.zoomHudLandscape]}>
              <Text style={ui.zoomHudText}>{Math.round(z * 100)}%</Text>
            </View>
          ) : null}

          {mt ? (
            <View style={[ui.moveToast, isLandscape && ui.moveToastLandscape]}>
              <Text style={ui.moveToastText}>{mt}</Text>
            </View>
          ) : null}

          {mb ? (
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
          ) : ukazPostupMapy ? (
            <View style={[ui.mapLoadOverlay, isDark && ui.mapLoadOverlayDark]}>
              <View style={[ui.mapLoadCard, isDark && ui.mapLoadCardDark, isLandscape && ui.mapLoadCardLandscape]}>
                <View style={ui.mapLoadProgressHeader}>
                  <Text style={[ui.mapLoadProgressTitle, isDark && ui.mapLoadProgressTitleDark]}>
                    {t("map.loadingMap")}
                  </Text>
                  <Text style={[ui.mapLoadProgressPercent, isDark && ui.mapLoadProgressPercentDark]}>
                    {postupMapy}%
                  </Text>
                </View>
                <View style={[ui.mapLoadProgressTrack, isDark && ui.mapLoadProgressTrackDark]}>
                  <View style={[ui.mapLoadProgressFill, { width: `${postupMapy}%` }]} />
                </View>
              </View>
            </View>
          ) : null}
        </View>

        {shouldShowInspector ? (
          <NodeInspector
            mode={isLandscape ? "side" : "sheet"}
            sideWidth={inspectorSideWidth}
            node={selectedNode}
            nodes={map.nodes}
            edges={map.edges}
            onClose={() => setSid(null)}
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
            onHeight={isLandscape ? () => {} : setIh}
            onSelectNode={handleSelectNode}
            onDeleteConnection={deleteConnection}
            onDeleteNode={deleteNode}
          />
        ) : null}
      </View>
    </View>
  );
}
