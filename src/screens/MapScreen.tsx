import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, PixelRatio, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/i18n/LanguagePreference";

import EdgeView, { EdgePoint } from "../components/EdgeView";
import EditableNodeView from "../components/EditableNodeView";
import NodeInspector from "../components/NodeInspector";
import ZoomableCanvas, { ZoomableCanvasHandle } from "../components/ZoomableCanvas";
import { EdgeStyle, MindMap, MindMapNode, NodeAttachment, NodeShape, RelationshipEdge } from "../types/map";
import { styles } from "./MapScreen.styles";

type Props = {
  initialMap?: MindMap;
  onMapChange?: (map: MindMap) => void;
};

type RouteRect = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type RoutedEdge = {
  id: string;
  points: EdgePoint[];
};

const DEFAULT_RELATIONSHIP_EDGE: Pick<RelationshipEdge, "style" | "width" | "color"> = {
  style: "dashed",
  width: 2,
  color: "#94a3b8",
};

const EDGE_PALETTE = [
  "#38bdf8",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ef4444",
  "#facc15",
  "#94a3b8",
];

const DOT_GRID_SMALL = 32;
const DOT_GRID_LARGE = 128;

function defaultTranslate(key: string) {
  const fallback: Record<string, string> = {
    "common.untitled": "Untitled",
    "map.sampleMap": "Sample Map",
    "map.root": "Root",
    "map.research": "Research",
    "map.design": "Design",
    "map.exportNode": "Export",
  };

  return fallback[key] ?? key;
}

function normalizeMap(map?: MindMap, t: (key: string) => string = defaultTranslate): MindMap {
  if (!map) {
    return {
      id: "map1",
      title: t("map.sampleMap"),
      rootId: "root",
      edges: [],
      nodes: {
        root: {
          id: "root",
          parentId: null,
          title: t("map.root"),
          x: 0,
          y: 0,
          children: ["c1", "c2", "c3"],
          size: 42,
          shape: "circle",
        },
        c1: {
          id: "c1",
          parentId: "root",
          title: t("map.research"),
          x: -140,
          y: 120,
          children: [],
          size: 30,
          shape: "circle",
          edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
        },
        c2: {
          id: "c2",
          parentId: "root",
          title: t("map.design"),
          x: 0,
          y: 140,
          children: [],
          size: 30,
          shape: "circle",
          edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
        },
        c3: {
          id: "c3",
          parentId: "root",
          title: t("map.exportNode"),
          x: 140,
          y: 120,
          children: [],
          size: 30,
          shape: "circle",
          edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
        },
      },
    };
  }

  const rawNodes = map && typeof map.nodes === "object" && map.nodes ? map.nodes : {};
  const normalizedNodes: Record<string, MindMapNode> = {};

  for (const [nodeId, rawNode] of Object.entries(rawNodes)) {
    if (!rawNode || typeof rawNode !== "object") {
      continue;
    }

    const safeId = typeof rawNode.id === "string" && rawNode.id.trim() ? rawNode.id : nodeId;
    const safeChildren = Array.isArray(rawNode.children)
      ? rawNode.children.filter((childId): childId is string => typeof childId === "string" && childId !== safeId)
      : [];
    const safeTags = Array.isArray(rawNode.tags)
      ? rawNode.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : undefined;
    const safeAttachments = Array.isArray(rawNode.attachments)
      ? rawNode.attachments
          .filter(
            (attachment): attachment is NodeAttachment =>
              !!attachment &&
              typeof attachment === "object" &&
              typeof attachment.id === "string" &&
              typeof attachment.name === "string" &&
              typeof attachment.uri === "string" &&
              attachment.name.trim().length > 0 &&
              attachment.uri.trim().length > 0
          )
          .map((attachment) => ({
            id: attachment.id,
            name: attachment.name.trim(),
            uri: attachment.uri.trim(),
            mimeType:
              typeof attachment.mimeType === "string" && attachment.mimeType.trim()
                ? attachment.mimeType.trim()
                : undefined,
            size: Number.isFinite(attachment.size) ? attachment.size : undefined,
          }))
      : undefined;
    const safeX = Number.isFinite(rawNode.x) ? rawNode.x : 0;
    const safeY = Number.isFinite(rawNode.y) ? rawNode.y : 0;
    const safeSize = Number.isFinite(rawNode.size) ? rawNode.size : undefined;
    const safeVendor =
      rawNode.vendor && typeof rawNode.vendor === "object" ? rawNode.vendor : undefined;
    const safeShape =
      rawNode.shape === "circle" || rawNode.shape === "rounded" || rawNode.shape === "capsule"
        ? rawNode.shape
        : undefined;

    normalizedNodes[safeId] = {
      id: safeId,
      parentId: typeof rawNode.parentId === "string" ? rawNode.parentId : null,
      title: typeof rawNode.title === "string" && rawNode.title.trim() ? rawNode.title : t("common.untitled"),
      note: typeof rawNode.note === "string" && rawNode.note.trim() ? rawNode.note : undefined,
      tags: safeTags?.length ? safeTags : undefined,
      attachments: safeAttachments?.length ? safeAttachments : undefined,
      dueAt:
        typeof rawNode.dueAt === "string" && rawNode.dueAt.trim() && !Number.isNaN(Date.parse(rawNode.dueAt))
          ? rawNode.dueAt
          : undefined,
      x: safeX,
      y: safeY,
      children: safeChildren,
      collapsed: rawNode.collapsed ? true : undefined,
      color: typeof rawNode.color === "string" && rawNode.color.trim() ? rawNode.color : undefined,
      size: safeSize,
      shape: safeShape,
      vendor: safeVendor,
      edgeToParent: rawNode.edgeToParent
        ? {
            style: rawNode.edgeToParent.style === "dashed" ? "dashed" : "solid",
            width: Number.isFinite(rawNode.edgeToParent.width) ? rawNode.edgeToParent.width : 2,
            color:
              typeof rawNode.edgeToParent.color === "string" && rawNode.edgeToParent.color.trim()
                ? rawNode.edgeToParent.color
                : undefined,
          }
        : undefined,
    };
  }

  let rootId =
    typeof map.rootId === "string" && normalizedNodes[map.rootId]
      ? map.rootId
      : Object.values(normalizedNodes).find((node) => node.parentId === null)?.id ??
        Object.keys(normalizedNodes)[0] ??
        "root";

  if (!normalizedNodes[rootId]) {
    normalizedNodes[rootId] = {
      id: rootId,
      parentId: null,
      title: t("map.root"),
      x: 0,
      y: 0,
      children: [],
      size: 42,
      shape: "circle",
    };
  }

  const connectedNodes = enforceRootConnectivity(normalizedNodes, rootId);

  const normalizedEdges = Array.isArray(map.edges)
    ? map.edges.filter(
        (edge) =>
          !!edge &&
          typeof edge.id === "string" &&
          typeof edge.fromId === "string" &&
          typeof edge.toId === "string" &&
          edge.fromId !== edge.toId &&
          !!connectedNodes[edge.fromId] &&
          !!connectedNodes[edge.toId]
      )
    : [];

  return {
    ...map,
    rootId,
    nodes: connectedNodes,
    edges: normalizedEdges,
  };
}

function hasRelationshipEdge(edges: RelationshipEdge[], fromId: string, toId: string) {
  return edges.some(
    (edge) =>
      (edge.fromId === fromId && edge.toId === toId) ||
      (edge.fromId === toId && edge.toId === fromId)
  );
}

function removeRelationshipEdge(edges: RelationshipEdge[], fromId: string, toId: string) {
  return edges.filter(
    (edge) =>
      !(
        (edge.fromId === fromId && edge.toId === toId) ||
        (edge.fromId === toId && edge.toId === fromId)
      )
  );
}

function enforceRootConnectivity(nodes: Record<string, MindMapNode>, rootId: string): Record<string, MindMapNode> {
  const nextNodes: Record<string, MindMapNode> = {};

  for (const [nodeId, node] of Object.entries(nodes)) {
    nextNodes[nodeId] = {
      ...node,
      parentId: nodeId === rootId ? null : node.parentId,
      children: node.children.filter((childId) => childId !== nodeId && !!nodes[childId]),
    };
  }

  for (const node of Object.values(nextNodes)) {
    if (node.id === rootId) {
      node.parentId = null;
      continue;
    }

    if (!node.parentId || !nextNodes[node.parentId]) {
      node.parentId = rootId;
    }
  }

  const reachesRoot = (nodeId: string) => {
    const seen = new Set<string>();
    let cursor: string | null = nodeId;

    while (cursor) {
      if (cursor === rootId) {
        return true;
      }

      if (seen.has(cursor)) {
        return false;
      }

      seen.add(cursor);
      cursor = nextNodes[cursor]?.parentId ?? null;
    }

    return false;
  };

  for (const node of Object.values(nextNodes)) {
    if (node.id !== rootId && !reachesRoot(node.id)) {
      node.parentId = rootId;
    }
  }

  const childBuckets: Record<string, string[]> = Object.fromEntries(
    Object.keys(nextNodes).map((nodeId) => [nodeId, []])
  );
  const pushChild = (parentId: string, childId: string) => {
    if (!childBuckets[parentId]?.includes(childId)) {
      childBuckets[parentId]?.push(childId);
    }
  };

  for (const node of Object.values(nextNodes)) {
    for (const childId of node.children) {
      if (nextNodes[childId]?.parentId === node.id) {
        pushChild(node.id, childId);
      }
    }
  }

  for (const node of Object.values(nextNodes)) {
    if (node.id !== rootId && node.parentId) {
      pushChild(node.parentId, node.id);
    }
  }

  for (const node of Object.values(nextNodes)) {
    node.children = childBuckets[node.id] ?? [];
  }

  return nextNodes;
}

function collectVisibleNodeIds(map: MindMap): Set<string> {
  const visible = new Set<string>();

  const visit = (nodeId: string) => {
    const node = map.nodes[nodeId];
    if (!node || visible.has(nodeId)) {
      return;
    }

    visible.add(nodeId);

    if (node.collapsed) {
      return;
    }

    for (const childId of node.children) {
      visit(childId);
    }
  };

  visit(map.rootId);

  return visible;
}

function normalizeSearchValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function estimateNodeHalfBounds(node: MindMapNode | undefined, isRoot: boolean) {
  const baseRadius = Math.max(isRoot ? 42 : 30, node?.size ?? (isRoot ? 42 : 30));
  const fontSize = Math.max(12, Math.round(baseRadius * (isRoot ? 0.45 : 0.38)));
  const textPaddingX = isRoot ? 22 : 18;
  const approxCharW = fontSize * 0.6;
  const textW = Math.max(24, (node?.title ?? "").length * approxCharW);
  const hasMeta = !!node?.note || !!node?.dueAt || (node?.attachments ?? []).length > 0 || (node?.tags ?? []).length > 0;
  const wBase = Math.max(baseRadius * (isRoot ? 2.8 : 2.65), textW + textPaddingX * 2, hasMeta ? 112 : 0);
  const hBase = baseRadius * (hasMeta ? 2.35 : 2.1);

  return {
    halfW: wBase / 2,
    halfH: hBase / 2,
  };
}

function makeNodeRouteRect(node: MindMapNode, isRoot: boolean, padding = 16): RouteRect {
  const { halfW, halfH } = estimateNodeHalfBounds(node, isRoot);

  return {
    id: node.id,
    left: node.x - halfW - padding,
    right: node.x + halfW + padding,
    top: node.y - halfH - padding,
    bottom: node.y + halfH + padding,
  };
}

function isPointInRect(point: EdgePoint, rect: RouteRect) {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

function ccw(a: EdgePoint, b: EdgePoint, c: EdgePoint) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: EdgePoint, b: EdgePoint, c: EdgePoint, d: EdgePoint) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function segmentIntersectsRect(a: EdgePoint, b: EdgePoint, rect: RouteRect) {
  if (isPointInRect(a, rect) || isPointInRect(b, rect)) {
    return true;
  }

  const topLeft = { x: rect.left, y: rect.top };
  const topRight = { x: rect.right, y: rect.top };
  const bottomRight = { x: rect.right, y: rect.bottom };
  const bottomLeft = { x: rect.left, y: rect.bottom };

  return (
    segmentsIntersect(a, b, topLeft, topRight) ||
    segmentsIntersect(a, b, topRight, bottomRight) ||
    segmentsIntersect(a, b, bottomRight, bottomLeft) ||
    segmentsIntersect(a, b, bottomLeft, topLeft)
  );
}

function isSegmentClear(a: EdgePoint, b: EdgePoint, obstacles: RouteRect[]) {
  return !obstacles.some((rect) => segmentIntersectsRect(a, b, rect));
}

function simplifyRoute(points: EdgePoint[]) {
  if (points.length <= 2) {
    return points;
  }

  const simplified: EdgePoint[] = [];

  for (const point of points) {
    const prev = simplified[simplified.length - 1];
    if (prev && prev.x === point.x && prev.y === point.y) {
      continue;
    }

    const beforePrev = simplified[simplified.length - 2];
    if (
      beforePrev &&
      prev &&
      ((beforePrev.x === prev.x && prev.x === point.x) ||
        (beforePrev.y === prev.y && prev.y === point.y))
    ) {
      simplified[simplified.length - 1] = point;
      continue;
    }

    simplified.push(point);
  }

  return simplified;
}

function routeEdgePoints(
  from: EdgePoint,
  to: EdgePoint,
  obstacles: RouteRect[],
  laneSeed: number
): EdgePoint[] {
  if (isSegmentClear(from, to, obstacles)) {
    return [from, to];
  }

  const laneOffset = ((laneSeed % 9) - 4) * 18;
  const xs = new Set<number>([from.x, to.x, from.x + laneOffset, to.x + laneOffset]);
  const ys = new Set<number>([from.y, to.y, from.y + laneOffset, to.y + laneOffset]);
  const routePadding = 28;

  for (const rect of obstacles) {
    xs.add(rect.left - routePadding);
    xs.add(rect.right + routePadding);
    xs.add((rect.left + rect.right) / 2);
    ys.add(rect.top - routePadding);
    ys.add(rect.bottom + routePadding);
    ys.add((rect.top + rect.bottom) / 2);
  }

  const sortedXs = Array.from(xs).sort((a, b) => a - b);
  const sortedYs = Array.from(ys).sort((a, b) => a - b);
  const pointKey = (x: number, y: number) => `${x}:${y}`;
  const points = new Map<string, EdgePoint>();

  for (const x of sortedXs) {
    for (const y of sortedYs) {
      const point = { x, y };
      if (!obstacles.some((rect) => isPointInRect(point, rect))) {
        points.set(pointKey(x, y), point);
      }
    }
  }

  const startKey = pointKey(from.x, from.y);
  const goalKey = pointKey(to.x, to.y);
  points.set(startKey, from);
  points.set(goalKey, to);

  const neighbors = new Map<string, { key: string; cost: number }[]>();
  const addNeighbor = (a: EdgePoint, b: EdgePoint) => {
    if (!isSegmentClear(a, b, obstacles)) {
      return;
    }

    const aKey = pointKey(a.x, a.y);
    const bKey = pointKey(b.x, b.y);
    const cost = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    neighbors.set(aKey, [...(neighbors.get(aKey) ?? []), { key: bKey, cost }]);
    neighbors.set(bKey, [...(neighbors.get(bKey) ?? []), { key: aKey, cost }]);
  };

  for (const y of sortedYs) {
    const row = sortedXs
      .map((x) => points.get(pointKey(x, y)))
      .filter(Boolean) as EdgePoint[];
    for (let index = 0; index < row.length - 1; index += 1) {
      addNeighbor(row[index], row[index + 1]);
    }
  }

  for (const x of sortedXs) {
    const column = sortedYs
      .map((y) => points.get(pointKey(x, y)))
      .filter(Boolean) as EdgePoint[];
    for (let index = 0; index < column.length - 1; index += 1) {
      addNeighbor(column[index], column[index + 1]);
    }
  }

  const open = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const costSoFar = new Map<string, number>([[startKey, 0]]);

  while (open.size > 0) {
    let current = Array.from(open)[0];
    let currentScore = Number.POSITIVE_INFINITY;

    for (const key of open) {
      const point = points.get(key);
      if (!point) {
        continue;
      }
      const score = (costSoFar.get(key) ?? Number.POSITIVE_INFINITY) + Math.abs(point.x - to.x) + Math.abs(point.y - to.y);
      if (score < currentScore) {
        current = key;
        currentScore = score;
      }
    }

    if (current === goalKey) {
      break;
    }

    open.delete(current);
    for (const next of neighbors.get(current) ?? []) {
      const nextCost = (costSoFar.get(current) ?? 0) + next.cost;
      if (nextCost < (costSoFar.get(next.key) ?? Number.POSITIVE_INFINITY)) {
        costSoFar.set(next.key, nextCost);
        cameFrom.set(next.key, current);
        open.add(next.key);
      }
    }
  }

  if (!cameFrom.has(goalKey)) {
    return [from, to];
  }

  const route: EdgePoint[] = [];
  let cursor = goalKey;
  while (cursor) {
    const point = points.get(cursor);
    if (point) {
      route.push(point);
    }
    const previous = cameFrom.get(cursor);
    if (!previous) {
      break;
    }
    cursor = previous;
  }

  return simplifyRoute(route.reverse());
}

function routeIntersectsRect(points: EdgePoint[], rect: RouteRect) {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (segmentIntersectsRect(points[index], points[index + 1], rect)) {
      return true;
    }
  }

  return false;
}

function routeSegmentRects(points: EdgePoint[], idPrefix: string, padding = 8): RouteRect[] {
  const rects: RouteRect[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const trim = Math.min(24, length / 3);
    if (length <= trim * 2 + 2) {
      continue;
    }
    const start = {
      x: a.x + ((b.x - a.x) / length) * trim,
      y: a.y + ((b.y - a.y) / length) * trim,
    };
    const end = {
      x: b.x - ((b.x - a.x) / length) * trim,
      y: b.y - ((b.y - a.y) / length) * trim,
    };

    rects.push({
      id: `${idPrefix}:segment:${index}`,
      left: Math.min(start.x, end.x) - padding,
      right: Math.max(start.x, end.x) + padding,
      top: Math.min(start.y, end.y) - padding,
      bottom: Math.max(start.y, end.y) + padding,
    });
  }

  return rects;
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
  const [repositionNodeId, setRepositionNodeId] = useState<string | null>(null);
  const [inspectorH, setInspectorH] = useState(0);
  const [canvasScale, setCanvasScale] = useState(1);
  const [zoomHudVisible, setZoomHudVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [moveToast, setMoveToast] = useState<string | null>(null);
  const [map, setMap] = useState<MindMap>(() => normalizeMap(initialMap, t));
  const didNotifyMapChange = useRef(false);
  const mapRef = useRef(map);
  const canvasRef = useRef<ZoomableCanvasHandle | null>(null);
  const zoomHudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const linkMode = linkFromId !== null;
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

  const androidSurfaceCap = Math.max(1400, Math.round(4600 / PixelRatio.get()));
  const worldPaddingX = Math.max(isLandscape ? 360 : 300, screenW * 0.62);
  const worldPaddingY = Math.max(isLandscape ? 300 : 360, screenH * 0.52);
  const minWorldW = Math.max(1200, screenW * 1.6);
  const minWorldH = Math.max(1200, screenH * 1.6);
  const desiredWorldW = Math.round(Math.max(minWorldW, (worldReach.maxX + worldPaddingX) * 2));
  const desiredWorldH = Math.round(Math.max(minWorldH, (worldReach.maxY + worldPaddingY) * 2));
  const WORLD_W = Platform.OS === "android" ? Math.min(androidSurfaceCap, desiredWorldW) : desiredWorldW;
  const WORLD_H = Platform.OS === "android" ? Math.min(androidSurfaceCap, desiredWorldH) : desiredWorldH;
  const VIEWBOX = `${-WORLD_W / 2} ${-WORLD_H / 2} ${WORLD_W} ${WORLD_H}`;
  const backgroundBase = isDark ? "#020617" : "#f8fafc";
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
    if (!didNotifyMapChange.current) {
      didNotifyMapChange.current = true;
      return;
    }

    onMapChange?.(map);
  }, [map, onMapChange]);

  const applyMap = (updater: (prev: MindMap) => MindMap) => {
    setMap((prev) => {
      const next = updater(prev);
      return {
        ...next,
        nodes: enforceRootConnectivity(next.nodes, next.rootId),
      };
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
  const visibleNodeIds = useMemo(() => collectVisibleNodeIds(map), [map]);
  const visibleNodes = useMemo(
    () => nodes.filter((node) => visibleNodeIds.has(node.id)),
    [nodes, visibleNodeIds]
  );
  const routeObstacles = useMemo(
    () => visibleNodes.map((node) => makeNodeRouteRect(node, node.id === map.rootId)),
    [map.rootId, visibleNodes]
  );
  const routedTreeEdges = useMemo(() => {
    const routes: Record<string, RoutedEdge> = {};
    const edgeObstacles: RouteRect[] = [];
    let routeIndex = 0;

    for (const parentNode of Object.values(map.nodes)) {
      if (!visibleNodeIds.has(parentNode.id)) {
        continue;
      }

      parentNode.children.forEach((childId, childIndex) => {
        const childNode = map.nodes[childId];
        if (!childNode || !visibleNodeIds.has(childId)) {
          return;
        }

        const obstacles = routeObstacles.filter(
          (rect) => rect.id !== parentNode.id && rect.id !== childNode.id
        );
        const id = `tree-${parentNode.id}-${childId}`;
        const points = routeEdgePoints(parentNode, childNode, [...obstacles, ...edgeObstacles], routeIndex + childIndex);
        routes[id] = {
          id,
          points,
        };
        edgeObstacles.push(...routeSegmentRects(points, id));
        routeIndex += 1;
      });
    }

    return routes;
  }, [map.nodes, routeObstacles, visibleNodeIds]);
  const routedRelationshipEdges = useMemo(() => {
    const routes: Record<string, RoutedEdge> = {};
    const edgeObstacles = Object.values(routedTreeEdges).flatMap((route) =>
      routeSegmentRects(route.points, route.id)
    );

    map.edges.forEach((edge, edgeIndex) => {
      const fromNode = map.nodes[edge.fromId];
      const toNode = map.nodes[edge.toId];
      if (
        !fromNode ||
        !toNode ||
        !visibleNodeIds.has(edge.fromId) ||
        !visibleNodeIds.has(edge.toId)
      ) {
        return;
      }

      const obstacles = routeObstacles.filter(
        (rect) => rect.id !== edge.fromId && rect.id !== edge.toId
      );
      const points = routeEdgePoints(fromNode, toNode, [...obstacles, ...edgeObstacles], edgeIndex + 97);
      routes[edge.id] = {
        id: edge.id,
        points,
      };
      edgeObstacles.push(...routeSegmentRects(points, edge.id));
    });

    return routes;
  }, [map.edges, map.nodes, routeObstacles, routedTreeEdges, visibleNodeIds]);
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
  const shouldShowInspector = !!selectedNode && !linkMode && !selectedEdge && !repositionNodeId;
  const bottomInset = !isLandscape && shouldShowInspector ? Math.max(inspectorH, 220) : 0;
  const containerPaddingTop = isLandscape ? 0 : Math.max(insets.top, 8);
  const containerPaddingBottom = isLandscape ? Math.max(insets.bottom, 8) : Math.max(insets.bottom, 12);
  const containerPaddingLeft = isLandscape ? Math.max(insets.left, 12) : 16;
  const containerPaddingRight = isLandscape ? Math.max(insets.right, 12) : 16;
  const canvasTopGap = isLandscape ? 0 : 8;

  useEffect(() => {
    if (!selectedNode || linkMode || selectedEdge || repositionNodeId) {
      return;
    }

    const focusScale = canvasScale || 1;
    canvasRef.current?.centerOn(
      selectedNode.x,
      selectedNode.y,
      focusScale
    );
  }, [canvasScale, linkMode, repositionNodeId, selectedEdge, selectedNode]);

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

  const clampNodePositionToWorld = useCallback(
    (nodeId: string, x: number, y: number, mapState: MindMap) => {
      const node = mapState.nodes[nodeId];
      const { halfW, halfH } = estimateNodeHalfBounds(node, nodeId === mapState.rootId);
      const mapPadding = 32;
      const minX = -WORLD_W / 2 + halfW + mapPadding;
      const maxX = WORLD_W / 2 - halfW - mapPadding;
      const minY = -WORLD_H / 2 + halfH + mapPadding;
      const maxY = WORLD_H / 2 - halfH - mapPadding;

      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)),
      };
    },
    [WORLD_H, WORLD_W]
  );

  const resolveCollisionPosition = useCallback((prev: MindMap, nodeId: string, x: number, y: number) => {
    const pad = 6;
    const radiusOf = (id: string, rootId: string) => {
      const node = prev.nodes[id];
      const fallback = id === rootId ? 42 : 30;
      return Math.max(id === rootId ? 42 : 30, node?.size ?? fallback);
    };
    const selfRadius = radiusOf(nodeId, prev.rootId);
    let nextX = x;
    let nextY = y;

    for (let pass = 0; pass < 4; pass += 1) {
      for (const [otherId, otherNode] of Object.entries(prev.nodes)) {
        if (otherId === nodeId) {
          continue;
        }

        const otherRadius = radiusOf(otherId, prev.rootId);
        const minDistance = selfRadius + otherRadius + pad;
        const dx = nextX - otherNode.x;
        const dy = nextY - otherNode.y;
        const distance = Math.hypot(dx, dy);

        if (distance < minDistance) {
          const safeDistance = distance === 0 ? 1 : distance;
          nextX = otherNode.x + (dx / safeDistance) * minDistance;
          nextY = otherNode.y + (dy / safeDistance) * minDistance;
        }
      }
    }

    return clampNodePositionToWorld(nodeId, nextX, nextY, prev);
  }, [clampNodePositionToWorld]);

  const canPlaceNodeAt = useCallback((prev: MindMap, nodeId: string, x: number, y: number) => {
    const targetNode = prev.nodes[nodeId];
    const selfRadius = Math.max(
      nodeId === prev.rootId ? 42 : 30,
      targetNode?.size ?? (nodeId === prev.rootId ? 42 : 30)
    );

    for (const [otherId, otherNode] of Object.entries(prev.nodes)) {
      if (otherId === nodeId) {
        continue;
      }

      const otherRadius = Math.max(
        otherId === prev.rootId ? 42 : 30,
        otherNode.size ?? (otherId === prev.rootId ? 42 : 30)
      );

      if (Math.hypot(x - otherNode.x, y - otherNode.y) < selfRadius + otherRadius + 6) {
        return false;
      }
    }

    if (targetNode) {
      const visibleIds = collectVisibleNodeIds(prev);
      const candidateNode = { ...targetNode, x, y };
      const candidateRect = makeNodeRouteRect(candidateNode, nodeId === prev.rootId, 12);
      const obstacles = Object.values(prev.nodes)
        .filter((node) => visibleIds.has(node.id) && node.id !== nodeId)
        .map((node) => makeNodeRouteRect(node, node.id === prev.rootId));
      let routeIndex = 0;

      for (const parentNode of Object.values(prev.nodes)) {
        if (!visibleIds.has(parentNode.id)) {
          continue;
        }

        for (const childId of parentNode.children) {
          const childNode = prev.nodes[childId];
          if (
            !childNode ||
            !visibleIds.has(childId) ||
            parentNode.id === nodeId ||
            childId === nodeId
          ) {
            continue;
          }

          const route = routeEdgePoints(
            parentNode,
            childNode,
            obstacles.filter((rect) => rect.id !== parentNode.id && rect.id !== childNode.id),
            routeIndex
          );
          routeIndex += 1;

          if (routeIntersectsRect(route, candidateRect)) {
            return false;
          }
        }
      }

      for (let edgeIndex = 0; edgeIndex < prev.edges.length; edgeIndex += 1) {
        const edge = prev.edges[edgeIndex];
        const fromNode = prev.nodes[edge.fromId];
        const toNode = prev.nodes[edge.toId];
        if (
          !fromNode ||
          !toNode ||
          !visibleIds.has(edge.fromId) ||
          !visibleIds.has(edge.toId) ||
          edge.fromId === nodeId ||
          edge.toId === nodeId
        ) {
          continue;
        }

        const route = routeEdgePoints(
          fromNode,
          toNode,
          obstacles.filter((rect) => rect.id !== edge.fromId && rect.id !== edge.toId),
          edgeIndex + 97
        );

        if (routeIntersectsRect(route, candidateRect)) {
          return false;
        }
      }
    }

    return true;
  }, []);

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
    const mapSnapshot = mapRef.current;
    const currentNode = mapSnapshot.nodes[nodeId];
    if (!currentNode) {
      setRepositionNodeId(null);
      return;
    }

    const position = clampNodePositionToWorld(nodeId, x, y, mapSnapshot);
    if (!canPlaceNodeAt(mapSnapshot, nodeId, position.x, position.y)) {
      showMoveToast(t("map.cannotMoveNodeThere"));
      return;
    }

    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: {
          ...prev.nodes[nodeId],
          x: position.x,
          y: position.y,
        },
      },
    }));
    setRepositionNodeId(null);
    setSelectedId(null);
  }, [canPlaceNodeAt, clampNodePositionToWorld, showMoveToast]);

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

      const siblingsCount = parent.children.length;
      const radius = 110;
      const angleStep = Math.PI / 4;
      const theta = -Math.PI / 2 + siblingsCount * angleStep;
      const rawX = parent.x + Math.cos(theta) * radius;
      const rawY = parent.y + Math.sin(theta) * radius;
      const placed = resolveCollisionPosition(prev, newId, rawX, rawY);

      const child: MindMapNode = {
        id: newId,
        parentId: parent.id,
        title: t("map.newNode"),
        x: placed.x,
        y: placed.y,
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
    linkFromIdRef.current = selectedId;
    setLinkFromId(selectedId);
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
    setSelectedId(targetId);
  }, []);

  const handleSelectNode = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
    setSelectedId(nodeId);
  }, []);

  const handleStartReposition = useCallback((nodeId: string) => {
    Keyboard.dismiss();
    setSelectedEdgeId(null);
    linkFromIdRef.current = null;
    setLinkFromId(null);
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
    setSelectedId(nodeId);
    setSearchQuery("");

    if (targetNode) {
      canvasRef.current?.centerOn(targetNode.x, targetNode.y, 1);
    }
  };

  const resetViewToRoot = () => {
    const rootNode = map.nodes[map.rootId];
    if (!rootNode) {
      canvasRef.current?.reset();
      return;
    }

    canvasRef.current?.centerOn(rootNode.x, rootNode.y, 1);
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
    setSelectedId(null);
  }, []);

  const handleLongPressRelationshipEdge = useCallback((edgeId: string) => {
    setSelectedId(null);
    setSelectedEdgeId(edgeId);
    linkFromIdRef.current = null;
    setLinkFromId(null);
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

    if (!linkMode) {
      setSelectedId(null);
    }
  }, [linkMode, repositionNodeId, selectedEdgeId]);

  const handlePlacementTap = useCallback((locationX: number, locationY: number) => {
    if (!repositionNodeId) {
      return;
    }

    const target = canvasRef.current?.localToWorld(locationX, locationY);
    if (!target) {
      return;
    }

    attemptRepositionNode(repositionNodeId, target.x, target.y);
  }, [attemptRepositionNode, repositionNodeId]);

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
            minScale={0.25}
            maxScale={1}
            onScaleChange={setCanvasScale}
            onDoubleTap={resetViewToRoot}
            tapEnabled={!!repositionNodeId}
            onTapPoint={handlePlacementTap}
            onZoomGestureStart={handleZoomGestureStart}
            onZoomGestureEnd={handleZoomGestureEnd}
            contentWidth={WORLD_W}
            contentHeight={WORLD_H}
          >
            <View style={{ width: WORLD_W, height: WORLD_H }}>
              <Svg
                width={WORLD_W}
                height={WORLD_H}
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
                <Rect
                  x={-WORLD_W / 2}
                  y={-WORLD_H / 2}
                  width={WORLD_W}
                  height={WORLD_H}
                  fill="transparent"
                  onPress={Platform.OS === "android" ? undefined : handleCanvasPress}
                />

                {Object.values(map.nodes).flatMap((parentNode) =>
                  parentNode.children.map((childId) => {
                    const childNode = map.nodes[childId];
                    if (
                      !childNode ||
                      !visibleNodeIds.has(parentNode.id) ||
                      !visibleNodeIds.has(childId)
                    ) {
                      return null;
                    }

                    return (
                      <EdgeView
                        key={`tree-${parentNode.id}-${childId}`}
                        from={{ x: parentNode.x, y: parentNode.y }}
                        to={{ x: childNode.x, y: childNode.y }}
                        points={routedTreeEdges[`tree-${parentNode.id}-${childId}`]?.points}
                        edgeStyle={childNode.edgeToParent?.style ?? "solid"}
                        width={childNode.edgeToParent?.width ?? 2}
                        color={childNode.edgeToParent?.color ?? "#9ca3af"}
                      />
                    );
                  })
                )}

                {map.edges.map((edge) => {
                  const fromNode = map.nodes[edge.fromId];
                  const toNode = map.nodes[edge.toId];
                  if (
                    !fromNode ||
                    !toNode ||
                    !visibleNodeIds.has(edge.fromId) ||
                    !visibleNodeIds.has(edge.toId)
                  ) {
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
                      onPress={() => handleSelectRelationshipEdge(edge.id)}
                      onLongPress={() => handleLongPressRelationshipEdge(edge.id)}
                      hitSlopWidth={20}
                    />
                  );
                })}
              </Svg>

              <View style={{ position: "absolute", top: 0, left: 0, width: WORLD_W, height: WORLD_H }} pointerEvents="box-none">
                {visibleNodes.map((node) => (
                  <EditableNodeView
                    key={node.id}
                    node={node}
                    worldWidth={WORLD_W}
                    worldHeight={WORLD_H}
                    isRoot={node.id === map.rootId}
                    selected={node.id === selectedId}
                    shape={node.shape}
                    placementMode={repositionNodeId === node.id}
                    linkMode={linkMode}
                    onSelect={handleSelectNode}
                    onSelectLinkTarget={handleSelectLinkTarget}
                    onStartReposition={handleStartReposition}
                  />
                ))}
              </View>
            </View>
          </ZoomableCanvas>

          {!linkMode && !selectedEdge && !repositionNodeId ? (
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

const ui = StyleSheet.create({
  topOverlay: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    gap: 10,
    alignItems: "flex-start",
  },
  topRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topRowLandscape: {
    maxWidth: 620,
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  topActionsLandscape: {
    alignSelf: "auto",
  },
  actionButton: {
    minWidth: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  searchPanel: {
    flex: 1,
  },
  searchPanelLandscape: {
    maxWidth: 320,
  },
  searchInput: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    color: "#0f172a",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  searchInputDark: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    color: "#f8fafc",
  },
  searchResults: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  searchResultsDark: {
    backgroundColor: "#111827",
    borderColor: "#334155",
  },
  searchResultsLandscape: {
    maxWidth: 320,
  },
  searchResultItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    backgroundColor: "#ffffff",
  },
  searchResultItemDark: {
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#111827",
  },
  searchResultTitle: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
  },
  searchResultTitleDark: {
    color: "#f8fafc",
  },
  searchResultMeta: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
  },
  searchResultMetaDark: {
    color: "#94a3b8",
  },
  searchEmpty: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  searchEmptyDark: {
    color: "#94a3b8",
  },
  primaryButton: {
    backgroundColor: "#0ea5e9",
  },
  secondaryButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  secondaryButtonDark: {
    backgroundColor: "#111827",
    borderColor: "#334155",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 26,
    lineHeight: 26,
    fontWeight: "800",
    marginTop: -2,
  },
  secondaryButtonText: {
    color: "#0f172a",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryButtonTextDark: {
    color: "#f8fafc",
  },
  banner: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "rgba(15, 23, 42, 0.92)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    gap: 12,
  },
  bannerLandscape: {
    left: 12,
    right: 12,
  },
  bannerText: {
    flex: 1,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  bannerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#1d4ed8",
  },
  bannerButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#dc2626",
  },
  deleteButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  edgePanel: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.98)",
    borderWidth: 1,
    borderColor: "#dbeafe",
    padding: 14,
    gap: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  edgePanelDark: {
    backgroundColor: "rgba(15, 23, 42, 0.98)",
    borderColor: "#334155",
  },
  edgePanelLandscape: {
    maxWidth: 380,
  },
  edgePanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  edgePanelTitle: {
    color: "#0f172a",
    fontSize: 15,
    fontWeight: "800",
  },
  edgePanelTitleDark: {
    color: "#f8fafc",
  },
  edgePanelMeta: {
    marginTop: 4,
    color: "#475569",
    fontSize: 12,
    fontWeight: "600",
  },
  edgePanelMetaDark: {
    color: "#94a3b8",
  },
  edgePanelSection: {
    gap: 8,
  },
  edgePanelLabel: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
  },
  edgePanelLabelDark: {
    color: "#cbd5e1",
  },
  edgePills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  edgePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  edgePillDark: {
    backgroundColor: "#1e293b",
  },
  edgePillActive: {
    backgroundColor: "#0ea5e9",
  },
  edgePillText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  edgePillTextDark: {
    color: "#cbd5e1",
  },
  edgePillTextActive: {
    color: "#ffffff",
  },
  edgeStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  edgeStepButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  edgeStepButtonDark: {
    backgroundColor: "#1e293b",
  },
  edgeStepButtonText: {
    color: "#111827",
    fontSize: 20,
    lineHeight: 20,
    fontWeight: "700",
  },
  edgeStepButtonTextDark: {
    color: "#f8fafc",
  },
  edgeStepValue: {
    minWidth: 18,
    textAlign: "center",
    color: "#111827",
    fontSize: 15,
    fontWeight: "700",
  },
  edgeStepValueDark: {
    color: "#f8fafc",
  },
  edgePalette: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
  },
  edgeSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "transparent",
  },
  edgeSwatchActive: {
    borderColor: "#0f172a",
  },
  zoomHud: {
    position: "absolute",
    top: 72,
    alignSelf: "center",
    minWidth: 78,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.86)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomHudLandscape: {
    top: 20,
  },
  zoomHudText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },
  moveToast: {
    position: "absolute",
    top: 84,
    alignSelf: "center",
    maxWidth: 280,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(220, 38, 38, 0.96)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 45,
  },
  moveToastLandscape: {
    top: 24,
  },
  moveToastText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
});
