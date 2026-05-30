/**
 * Súbor: benchmarks/run.ts
 * Abstrakt: Spúšťa reprodukovateľné merania výkonu editora myšlienkových máp.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { layoutStructuredMap } from "../src/screens/mapScreen/mapModel";
import {
  estimateNodeHalfBounds,
  makeNodeRouteRect,
  nearestRouteObstacles,
  routeEdgePoints,
  routeIntersectsRect,
  routeIntersectsRoute,
  routeSegmentRects,
  type RouteRect,
} from "../src/screens/mapScreen/routing";
import {
  LOCAL_ROUTE_OBSTACLE_LIMIT,
  MAX_RENDERED_EDGES_PER_FRAME,
  PROGRESSIVE_RENDER_NODE_LIMIT,
  VIEWPORT_CULL_NODE_LIMIT,
} from "../src/screens/mapScreen/constants";
import type { EdgePoint } from "../src/components/EdgeView";
import type { MindMap, MindMapNode, RelationshipEdge } from "../src/types/map";

type ConditionId =
  | "baseline"
  | "optimized"
  | "noViewportCulling"
  | "noSelectiveSmartRouting"
  | "noRouteCache"
  | "noTransformThrottle";

type Condition = {
  id: ConditionId;
  label: string;
  viewportCulling: boolean;
  selectiveSmartRouting: boolean | "auto";
  routeCache: boolean;
  transformThrottle: boolean;
  edgeLimit: number;
  relationshipRouting: "direct" | "smart";
};

type BenchmarkOptions = {
  sizes: number[];
  conditions: ConditionId[];
  repeats: number;
  warmup: number;
  seed: number;
  rawEvents: number;
  outDir: string;
};

type WorldViewport = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type TransformSample = {
  centerX: number;
  centerY: number;
  scale: number;
};

type CommittedRoute = {
  id: string;
  points: EdgePoint[];
};

type FrameMetrics = {
  frameMs: number;
  routingMs: number;
  renderedEdges: number;
  renderedNodes: number;
  routeCalls: number;
  cacheHits: number;
  cacheMisses: number;
};

type RouteState = {
  cache: Map<string, EdgePoint[]>;
  cacheHits: number;
  cacheMisses: number;
  routeCalls: number;
};

type RepeatMetrics = {
  timestamp: string;
  device: string;
  os: string;
  nodeVersion: string;
  expoVersion: string;
  reactNativeVersion: string;
  seed: number;
  nodeCount: number;
  freeEdgeCount: number;
  condition: ConditionId;
  repeat: number;
  warmup: boolean;
  layoutMs: number;
  frameMedianMs: number;
  frameIqrMs: number;
  frameMeanMs: number;
  simulatedFps: number;
  routingMedianMs: number;
  routingIqrMs: number;
  renderedEdgesMedian: number;
  renderedEdgesMax: number;
  renderedNodesMedian: number;
  processedFrames: number;
  rawEvents: number;
  totalFrameMs: number;
  routeCalls: number;
  cacheHits: number;
  cacheMisses: number;
  heapPeakMb: number;
};

type EnvironmentInfo = Pick<
  RepeatMetrics,
  "timestamp" | "device" | "os" | "nodeVersion" | "expoVersion" | "reactNativeVersion"
>;

type SummaryRow = {
  nodeCount: number;
  condition: ConditionId;
  layoutMedianMs: number;
  layoutIqrMs: number;
  frameMedianMs: number;
  frameIqrMs: number;
  fpsMedian: number;
  routingMedianMs: number;
  routingIqrMs: number;
  renderedEdgesMedian: number;
  heapPeakMedianMb: number;
  processedFramesMedian: number;
};

const CONDITIONS: Condition[] = [
  {
    id: "baseline",
    label: "Baseline",
    viewportCulling: false,
    selectiveSmartRouting: false,
    routeCache: false,
    transformThrottle: false,
    edgeLimit: Number.POSITIVE_INFINITY,
    relationshipRouting: "direct",
  },
  {
    id: "optimized",
    label: "Optimized",
    viewportCulling: true,
    selectiveSmartRouting: "auto",
    routeCache: true,
    transformThrottle: true,
    edgeLimit: MAX_RENDERED_EDGES_PER_FRAME,
    relationshipRouting: "smart",
  },
  {
    id: "noViewportCulling",
    label: "Bez viewport cullingu",
    viewportCulling: false,
    selectiveSmartRouting: "auto",
    routeCache: true,
    transformThrottle: true,
    edgeLimit: MAX_RENDERED_EDGES_PER_FRAME,
    relationshipRouting: "smart",
  },
  {
    id: "noSelectiveSmartRouting",
    label: "Bez selektívneho routingu",
    viewportCulling: true,
    selectiveSmartRouting: false,
    routeCache: true,
    transformThrottle: true,
    edgeLimit: MAX_RENDERED_EDGES_PER_FRAME,
    relationshipRouting: "smart",
  },
  {
    id: "noRouteCache",
    label: "Bez cache trás",
    viewportCulling: true,
    selectiveSmartRouting: "auto",
    routeCache: false,
    transformThrottle: true,
    edgeLimit: MAX_RENDERED_EDGES_PER_FRAME,
    relationshipRouting: "smart",
  },
  {
    id: "noTransformThrottle",
    label: "Bez throttlingu transformácií",
    viewportCulling: true,
    selectiveSmartRouting: "auto",
    routeCache: true,
    transformThrottle: false,
    edgeLimit: MAX_RENDERED_EDGES_PER_FRAME,
    relationshipRouting: "smart",
  },
];

const DEFAULT_OPTIONS: BenchmarkOptions = {
  sizes: [50, 100, 250, 500, 1000],
  conditions: [
    "baseline",
    "optimized",
    "noViewportCulling",
    "noSelectiveSmartRouting",
    "noTransformThrottle",
  ],
  repeats: 8,
  warmup: 2,
  seed: 20260530,
  rawEvents: 120,
  outDir: "benchmarks",
};

const CSV_COLUMNS = [
  "timestamp",
  "device",
  "os",
  "nodeVersion",
  "expoVersion",
  "reactNativeVersion",
  "seed",
  "nodeCount",
  "freeEdgeCount",
  "condition",
  "repeat",
  "warmup",
  "layoutMs",
  "frameMedianMs",
  "frameIqrMs",
  "frameMeanMs",
  "simulatedFps",
  "routingMedianMs",
  "routingIqrMs",
  "renderedEdgesMedian",
  "renderedEdgesMax",
  "renderedNodesMedian",
  "processedFrames",
  "rawEvents",
  "totalFrameMs",
  "routeCalls",
  "cacheHits",
  "cacheMisses",
  "heapPeakMb",
] as const;

function parseArgs(): BenchmarkOptions {
  const options = { ...DEFAULT_OPTIONS };
  const knownConditions = new Set(CONDITIONS.map((condition) => condition.id));

  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (!value) {
      continue;
    }

    if (key === "sizes") {
      options.sizes = value.split(",").map((item) => Number(item.trim())).filter(Number.isFinite);
    } else if (key === "conditions") {
      options.conditions = value
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is ConditionId => knownConditions.has(item as ConditionId));
    } else if (key === "repeats") {
      options.repeats = Number(value);
    } else if (key === "warmup") {
      options.warmup = Number(value);
    } else if (key === "seed") {
      options.seed = Number(value);
    } else if (key === "rawEvents") {
      options.rawEvents = Number(value);
    } else if (key === "outDir") {
      options.outDir = value;
    }
  }

  return options;
}

function getActiveConditions(options: BenchmarkOptions): Condition[] {
  const activeIds = new Set(options.conditions);
  return CONDITIONS.filter((condition) => activeIds.has(condition.id));
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function iqr(values: number[]): number {
  return percentile(values, 0.75) - percentile(values, 0.25);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function createNode(id: string, parentId: string | null, title: string): MindMapNode {
  return {
    id,
    parentId,
    title,
    x: 0,
    y: 0,
    children: [],
    size: id === "root" ? 42 : 30 + (id.length % 5),
    shape: id === "root" ? "circle" : id.length % 3 === 0 ? "rounded" : "circle",
    edgeToParent: parentId ? { style: "solid", width: 2, color: "#94a3b8" } : undefined,
  };
}

function createTreeMap(nodeCount: number, seed: number): MindMap {
  const rng = createRng(seed);
  const nodes: Record<string, MindMapNode> = {
    root: createNode("root", null, "Root"),
  };
  const parents = [{ id: "root", remaining: 8 }];

  for (let index = 1; index < nodeCount; index += 1) {
    const parentBucket = pick(parents, rng);
    const id = `n${index}`;
    nodes[id] = createNode(id, parentBucket.id, `Node ${index}`);
    nodes[parentBucket.id].children.push(id);
    parentBucket.remaining -= 1;

    const capacity = 1 + Math.floor(rng() * 5);
    parents.push({ id, remaining: capacity });
    for (let cursor = parents.length - 1; cursor >= 0; cursor -= 1) {
      if (parents[cursor].remaining <= 0) {
        parents.splice(cursor, 1);
      }
    }
  }

  return {
    id: `benchmark-${nodeCount}`,
    title: `Benchmark ${nodeCount}`,
    rootId: "root",
    nodes,
    edges: [],
  };
}

function addRelationshipEdges(map: MindMap, seed: number): MindMap {
  const rng = createRng(seed ^ 0xa53a9f17);
  const nodeIds = Object.keys(map.nodes).filter((id) => id !== map.rootId);
  const targetCount = Math.max(1, Math.round(nodeIds.length * 0.1));
  const edges: RelationshipEdge[] = [];
  const seen = new Set<string>();
  const candidates = [...nodeIds].sort((a, b) => map.nodes[a].y - map.nodes[b].y);
  const routeRects = Object.values(map.nodes).map((node) => makeNodeRouteRect(node, node.id === map.rootId));
  const treeSegmentRects = Object.values(map.nodes).flatMap((parentNode) =>
    parentNode.children.flatMap((childId) => {
      const childNode = map.nodes[childId];
      if (!childNode) {
        return [];
      }

      return routeSegmentRects(
        getStructuredTreeEdgePoints(parentNode, childNode),
        `tree-${parentNode.id}-${childId}`
      );
    })
  );

  const directRouteIsClear = (fromId: string, toId: string): boolean => {
    const from = map.nodes[fromId];
    const to = map.nodes[toId];
    const points = [from, to];
    const hitsNode = routeRects.some((rect) =>
      rect.id !== fromId &&
      rect.id !== toId &&
      routeIntersectsRect(points, rect)
    );
    const hitsTreeRoute = treeSegmentRects.some((rect) =>
      !rect.id.includes(fromId) &&
      !rect.id.includes(toId) &&
      routeIntersectsRect(points, rect)
    );
    return !hitsNode && !hitsTreeRoute;
  };

  let attempts = 0;
  while (edges.length < targetCount && attempts < targetCount * 300) {
    attempts += 1;
    const fromIndex = Math.floor(rng() * candidates.length);
    const offset = 1 + Math.floor(rng() * 8);
    const toIndex = Math.min(candidates.length - 1, fromIndex + offset);
    const fromId = candidates[fromIndex];
    const toId = candidates[toIndex];

    if (!fromId || !toId || fromId === toId) {
      continue;
    }

    const from = map.nodes[fromId];
    const to = map.nodes[toId];
    if (from.parentId === toId || to.parentId === fromId) {
      continue;
    }

    if (!directRouteIsClear(fromId, toId)) {
      continue;
    }

    const key = [fromId, toId].sort().join(":");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    edges.push({
      id: `rel-${edges.length}`,
      fromId,
      toId,
      style: rng() > 0.35 ? "dashed" : "solid",
      width: 2,
      color: "#38bdf8",
    });
  }

  return { ...map, edges };
}

function createBenchmarkMap(nodeCount: number, seed: number): MindMap {
  const tree = createTreeMap(nodeCount, seed);
  const laidOut = layoutStructuredMap(tree);
  return addRelationshipEdges(laidOut, seed);
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

function viewportContainsNode(viewport: WorldViewport, node: MindMapNode, isRoot: boolean): boolean {
  const { halfW, halfH } = estimateNodeHalfBounds(node, isRoot);
  return (
    node.x + halfW >= viewport.left &&
    node.x - halfW <= viewport.right &&
    node.y + halfH >= viewport.top &&
    node.y - halfH <= viewport.bottom
  );
}

function getMapBounds(nodes: MindMapNode[], rootId: string) {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const { halfW, halfH } = estimateNodeHalfBounds(node, node.id === rootId);
    left = Math.min(left, node.x - halfW);
    right = Math.max(right, node.x + halfW);
    top = Math.min(top, node.y - halfH);
    bottom = Math.max(bottom, node.y + halfH);
  }

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function createTransforms(map: MindMap, rawEvents: number): TransformSample[] {
  const bounds = getMapBounds(Object.values(map.nodes), map.rootId);
  const amplitudeX = Math.min(1600, bounds.width * 0.28);
  const amplitudeY = Math.min(1400, bounds.height * 0.22);

  return Array.from({ length: rawEvents }, (_, index) => {
    const t = index / Math.max(1, rawEvents - 1);
    return {
      centerX: bounds.left + bounds.width * t + Math.sin(t * Math.PI * 2) * amplitudeX,
      centerY: (bounds.top + bounds.bottom) / 2 + Math.cos(t * Math.PI * 2) * amplitudeY,
      scale: 0.78 + Math.sin(t * Math.PI) * 0.62,
    };
  });
}

function makeWorldViewport(transform: TransformSample, largeMapMode: boolean): WorldViewport {
  const width = 390;
  const height = 844;
  const overscan = largeMapMode ? 4.5 : 0.35;
  const halfW = (width / Math.max(0.2, transform.scale)) * (0.5 + overscan);
  const halfH = (height / Math.max(0.2, transform.scale)) * (0.5 + overscan);

  return {
    left: transform.centerX - halfW,
    right: transform.centerX + halfW,
    top: transform.centerY - halfH,
    bottom: transform.centerY + halfH,
  };
}

function chooseRenderedNodes(map: MindMap, condition: Condition, transform: TransformSample): MindMapNode[] {
  const nodes = Object.values(map.nodes);
  const largeMapMode = nodes.length >= PROGRESSIVE_RENDER_NODE_LIMIT;
  const cullingEnabled =
    condition.viewportCulling &&
    largeMapMode &&
    nodes.length > VIEWPORT_CULL_NODE_LIMIT;

  if (!cullingEnabled) {
    return nodes;
  }

  const viewport = makeWorldViewport(transform, largeMapMode);
  const visible = nodes.filter((node) => viewportContainsNode(viewport, node, node.id === map.rootId));
  if (!visible.some((node) => node.id === map.rootId)) {
    visible.push(map.nodes[map.rootId]);
  }
  return visible;
}

function resolveSelectiveSmartRouting(condition: Condition, nodeCount: number): boolean {
  return condition.selectiveSmartRouting === "auto"
    ? nodeCount >= PROGRESSIVE_RENDER_NODE_LIMIT
    : condition.selectiveSmartRouting;
}

function createRouteState(): RouteState {
  return {
    cache: new Map<string, EdgePoint[]>(),
    cacheHits: 0,
    cacheMisses: 0,
    routeCalls: 0,
  };
}

function createRouteChooser(condition: Condition, routeObstacles: RouteRect[], routeState: RouteState, nodeCount: number) {
  const selectiveSmartRouting = resolveSelectiveSmartRouting(condition, nodeCount);

  const chooseEdgeRoute = (
    id: string,
    fromNode: MindMapNode,
    toNode: MindMapNode,
    excludedIds: Set<string>,
    committedRoutes: CommittedRoute[],
    baseSeed: number,
    styleKey: string
  ): { drawPoints?: EdgePoint[]; committedPoints: EdgePoint[] } => {
    const directPoints = [fromNode, toNode];
    if (condition.relationshipRouting === "direct") {
      return { committedPoints: directPoints };
    }

    const directHitsNode = routeObstacles.some(
      (rect) => !excludedIds.has(rect.id) && routeIntersectsRect(directPoints, rect)
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

    if (condition.routeCache) {
      const cached = routeState.cache.get(cacheKey);
      if (cached) {
        routeState.cacheHits += 1;
        return { drawPoints: cached, committedPoints: cached };
      }
    }

    routeState.cacheMisses += 1;
    routeState.routeCalls += 1;

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
    if (condition.routeCache) {
      routeState.cache.set(cacheKey, points);
      if (routeState.cache.size > 1200) {
        routeState.cache.clear();
      }
    }

    return { drawPoints: points, committedPoints: points };
  };

  return {
    chooseEdgeRoute,
    counters: () => ({
      cacheHits: routeState.cacheHits,
      cacheMisses: routeState.cacheMisses,
      routeCalls: routeState.routeCalls,
    }),
  };
}

function routeFrame(map: MindMap, condition: Condition, transform: TransformSample, routeState: RouteState): FrameMetrics {
  const frameStart = performance.now();
  const renderedNodes = chooseRenderedNodes(map, condition, transform);
  const renderedIds = new Set(renderedNodes.map((node) => node.id));
  const routeObstacles = renderedNodes.map((node) => makeNodeRouteRect(node, node.id === map.rootId));
  const beforeCounters = {
    routeCalls: routeState.routeCalls,
    cacheHits: routeState.cacheHits,
    cacheMisses: routeState.cacheMisses,
  };
  const chooser = createRouteChooser(condition, routeObstacles, routeState, Object.keys(map.nodes).length);
  const routingStart = performance.now();
  const committedRoutes: CommittedRoute[] = [];
  let renderedEdges = 0;

  for (const parentNode of renderedNodes) {
    if (renderedEdges >= condition.edgeLimit) {
      break;
    }

    for (const childId of parentNode.children) {
      if (renderedEdges >= condition.edgeLimit) {
        break;
      }

      const childNode = map.nodes[childId];
      if (!childNode || !renderedIds.has(childId)) {
        continue;
      }

      const id = `tree-${parentNode.id}-${childId}`;
      const points = getStructuredTreeEdgePoints(parentNode, childNode);
      committedRoutes.push({ id, points });
      renderedEdges += 1;
    }
  }

  for (let edgeIndex = 0; edgeIndex < map.edges.length; edgeIndex += 1) {
    if (renderedEdges >= condition.edgeLimit) {
      break;
    }

    const edge = map.edges[edgeIndex];
    const fromNode = map.nodes[edge.fromId];
    const toNode = map.nodes[edge.toId];
    if (!fromNode || !toNode || !renderedIds.has(edge.fromId) || !renderedIds.has(edge.toId)) {
      continue;
    }

    const route = chooser.chooseEdgeRoute(
      edge.id,
      fromNode,
      toNode,
      new Set([edge.fromId, edge.toId]),
      committedRoutes,
      edgeIndex + 97,
      `${edge.style ?? "dashed"}:${edge.width ?? 2}`
    );
    committedRoutes.push({ id: edge.id, points: route.committedPoints });
    renderedEdges += 1;
  }

  const routingMs = performance.now() - routingStart;
  const frameMs = performance.now() - frameStart;
  const counters = chooser.counters();

  return {
    frameMs,
    routingMs,
    renderedEdges,
    renderedNodes: renderedNodes.length,
    routeCalls: counters.routeCalls - beforeCounters.routeCalls,
    cacheHits: counters.cacheHits - beforeCounters.cacheHits,
    cacheMisses: counters.cacheMisses - beforeCounters.cacheMisses,
  };
}

function runRepeat(
  baseMap: MindMap,
  condition: Condition,
  options: BenchmarkOptions,
  repeat: number,
  warmup: boolean,
  environment: EnvironmentInfo
): RepeatMetrics {
  if (typeof global.gc === "function") {
    global.gc();
  }

  let heapPeak = process.memoryUsage().heapUsed;
  const layoutStart = performance.now();
  const laidOut = layoutStructuredMap(baseMap);
  const layoutMs = performance.now() - layoutStart;
  heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);

  const transforms = createTransforms(laidOut, options.rawEvents);
  const processedTransforms = condition.transformThrottle
    ? transforms.filter((_, index) => index % 2 === 0)
    : transforms;

  const frames: FrameMetrics[] = [];
  const routeState = createRouteState();
  for (const transform of processedTransforms) {
    const metrics = routeFrame(laidOut, condition, transform, routeState);
    frames.push(metrics);
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  }

  const frameMs = frames.map((frame) => frame.frameMs);
  const routingMs = frames.map((frame) => frame.routingMs);
  const renderedEdges = frames.map((frame) => frame.renderedEdges);
  const renderedNodes = frames.map((frame) => frame.renderedNodes);
  const frameMedianMs = median(frameMs);

  return {
    ...environment,
    seed: options.seed,
    nodeCount: Object.keys(baseMap.nodes).length,
    freeEdgeCount: baseMap.edges.length,
    condition: condition.id,
    repeat,
    warmup,
    layoutMs,
    frameMedianMs,
    frameIqrMs: iqr(frameMs),
    frameMeanMs: mean(frameMs),
    simulatedFps: frameMedianMs > 0 ? 1000 / frameMedianMs : 0,
    routingMedianMs: median(routingMs),
    routingIqrMs: iqr(routingMs),
    renderedEdgesMedian: median(renderedEdges),
    renderedEdgesMax: Math.max(...renderedEdges),
    renderedNodesMedian: median(renderedNodes),
    processedFrames: processedTransforms.length,
    rawEvents: options.rawEvents,
    totalFrameMs: frameMs.reduce((sum, value) => sum + value, 0),
    routeCalls: frames.reduce((sum, frame) => sum + frame.routeCalls, 0),
    cacheHits: frames.reduce((sum, frame) => sum + frame.cacheHits, 0),
    cacheMisses: frames.reduce((sum, frame) => sum + frame.cacheMisses, 0),
    heapPeakMb: heapPeak / (1024 * 1024),
  };
}

function csvEscape(value: unknown): string {
  const text = typeof value === "number" ? String(round(value, 6)) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeResultsCsv(filePath: string, rows: RepeatMetrics[]): void {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvEscape(row[column])).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function summarize(rows: RepeatMetrics[], conditions: Condition[]): SummaryRow[] {
  const measured = rows.filter((row) => !row.warmup);
  const output: SummaryRow[] = [];

  for (const nodeCount of [...new Set(measured.map((row) => row.nodeCount))].sort((a, b) => a - b)) {
    for (const condition of conditions) {
      const group = measured.filter((row) => row.nodeCount === nodeCount && row.condition === condition.id);
      if (group.length === 0) {
        continue;
      }

      output.push({
        nodeCount,
        condition: condition.id,
        layoutMedianMs: median(group.map((row) => row.layoutMs)),
        layoutIqrMs: iqr(group.map((row) => row.layoutMs)),
        frameMedianMs: median(group.map((row) => row.frameMedianMs)),
        frameIqrMs: iqr(group.map((row) => row.frameMedianMs)),
        fpsMedian: median(group.map((row) => row.simulatedFps)),
        routingMedianMs: median(group.map((row) => row.routingMedianMs)),
        routingIqrMs: iqr(group.map((row) => row.routingMedianMs)),
        renderedEdgesMedian: median(group.map((row) => row.renderedEdgesMedian)),
        heapPeakMedianMb: median(group.map((row) => row.heapPeakMb)),
        processedFramesMedian: median(group.map((row) => row.processedFrames)),
      });
    }
  }

  return output;
}

function summaryLookup(summary: SummaryRow[], nodeCount: number, condition: ConditionId): SummaryRow {
  const row = summary.find((item) => item.nodeCount === nodeCount && item.condition === condition);
  if (!row) {
    throw new Error(`Missing summary for ${nodeCount}/${condition}`);
  }
  return row;
}

function writeSummaryCsv(filePath: string, summary: SummaryRow[]): void {
  const columns = [
    "nodeCount",
    "condition",
    "layoutMedianMs",
    "layoutIqrMs",
    "frameMedianMs",
    "frameIqrMs",
    "fpsMedian",
    "routingMedianMs",
    "routingIqrMs",
    "renderedEdgesMedian",
    "heapPeakMedianMb",
    "processedFramesMedian",
  ] as const;
  const lines = [
    columns.join(","),
    ...summary.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function writeLatexTable(filePath: string, summary: SummaryRow[], sizes: number[]): void {
  const lines = [
    "\\begin{table}[htbp]",
    "\\centering",
    "\\caption{Porovnanie výkonu editora pre syntetické mapy rôznych veľkostí. Hodnoty predstavujú medián z meraných opakovaní.}",
    "\\label{tab:nodify-performance}",
    "\\begin{tabular}{rrrrrrr}",
    "\\toprule",
    "$N$ & \\multicolumn{2}{c}{Layout (ms)} & \\multicolumn{2}{c}{Čas rámca (ms)} & \\multicolumn{2}{c}{Hrany/rámec} \\\\",
    "\\cmidrule(lr){2-3}\\cmidrule(lr){4-5}\\cmidrule(lr){6-7}",
    " & baseline & optimized & baseline & optimized & baseline & optimized \\\\",
    "\\midrule",
  ];

  for (const size of sizes) {
    const baseline = summaryLookup(summary, size, "baseline");
    const optimized = summaryLookup(summary, size, "optimized");
    lines.push(
      `${size} & ${round(baseline.layoutMedianMs, 2)} & ${round(optimized.layoutMedianMs, 2)} & ` +
      `${round(baseline.frameMedianMs, 2)} & ${round(optimized.frameMedianMs, 2)} & ` +
      `${round(baseline.renderedEdgesMedian, 0)} & ${round(optimized.renderedEdgesMedian, 0)} \\\\`
    );
  }

  lines.push("\\bottomrule", "\\end{tabular}", "\\end{table}", "");
  fs.writeFileSync(filePath, lines.join("\n"));
}

function writeSvgChart(filePath: string, summary: SummaryRow[], sizes: number[]): void {
  const width = 920;
  const height = 520;
  const margin = { left: 70, right: 30, top: 36, bottom: 64 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const baselineValues = sizes.map((size) => summaryLookup(summary, size, "baseline").frameMedianMs);
  const optimizedValues = sizes.map((size) => summaryLookup(summary, size, "optimized").frameMedianMs);
  const maxY = Math.max(...baselineValues, ...optimizedValues) * 1.15 || 1;
  const xFor = (index: number) => margin.left + (index / Math.max(1, sizes.length - 1)) * plotW;
  const yFor = (value: number) => margin.top + plotH - (value / maxY) * plotH;
  const points = (values: number[]) => values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => maxY * part);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    "<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>",
    `<text x="${width / 2}" y="24" text-anchor="middle" font-family="Arial" font-size="18" font-weight="700">Čas rámca vs. počet uzlov</text>`,
    `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#334155"/>`,
    `<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#334155"/>`,
    ...ticks.map((tick) => {
      const y = yFor(tick);
      return `<g><line x1="${margin.left - 5}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#e2e8f0"/><text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-family="Arial" font-size="12">${round(tick, 2)}</text></g>`;
    }),
    ...sizes.map((size, index) => {
      const x = xFor(index);
      return `<g><line x1="${x}" y1="${margin.top + plotH}" x2="${x}" y2="${margin.top + plotH + 5}" stroke="#334155"/><text x="${x}" y="${height - 28}" text-anchor="middle" font-family="Arial" font-size="12">${size}</text></g>`;
    }),
    `<polyline points="${points(baselineValues)}" fill="none" stroke="#dc2626" stroke-width="3"/>`,
    `<polyline points="${points(optimizedValues)}" fill="none" stroke="#0284c7" stroke-width="3"/>`,
    ...baselineValues.map((value, index) => `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="4" fill="#dc2626"/>`),
    ...optimizedValues.map((value, index) => `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="4" fill="#0284c7"/>`),
    `<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-family="Arial" font-size="13">Počet uzlov N</text>`,
    `<text x="16" y="${height / 2}" transform="rotate(-90 16 ${height / 2})" text-anchor="middle" font-family="Arial" font-size="13">Medián času rámca (ms)</text>`,
    `<rect x="${width - 210}" y="48" width="160" height="58" fill="#ffffff" stroke="#cbd5e1"/>`,
    `<line x1="${width - 194}" y1="68" x2="${width - 158}" y2="68" stroke="#dc2626" stroke-width="3"/><text x="${width - 148}" y="72" font-family="Arial" font-size="13">baseline</text>`,
    `<line x1="${width - 194}" y1="90" x2="${width - 158}" y2="90" stroke="#0284c7" stroke-width="3"/><text x="${width - 148}" y="94" font-family="Arial" font-size="13">optimized</text>`,
    "</svg>",
  ].join("\n");

  fs.writeFileSync(filePath, svg);
}

function writeMethodology(
  filePath: string,
  rows: RepeatMetrics[],
  summary: SummaryRow[],
  options: BenchmarkOptions,
  conditions: Condition[]
): void {
  const measuredRows = rows.filter((row) => !row.warmup);
  const first = rows[0];
  const paragraph =
    `Meranie výkonu bolo spustené na vývojovom zariadení ${first.device} ` +
    `(${first.os}, Node.js ${first.nodeVersion}) s verziami Expo ${first.expoVersion} ` +
    `a React Native ${first.reactNativeVersion}. Pre každú veľkosť syntetickej mapy ` +
    `N ∈ {${options.sizes.join(", ")}} bol použitý deterministický generátor so seedom ` +
    `${options.seed}; mapy obsahovali realistickú stromovú štruktúru a približne 10 % ` +
    `voľných vzťahov. Pred meraním prebehli ${options.warmup} zahrievacie opakovania ` +
    `a následne ${options.repeats} meraných opakovaní pre každú konfiguráciu. Skript ` +
    `meral čas funkcie layoutStructuredMap, CPU čas simulovaného rámca pri pan/zoom ` +
    `trajektórii, čas routovania hrán, počet skutočne spracovaných hrán a vrcholové ` +
    `využitie JS heap. FPS je odvodené ako 1000 / medián času simulovaného rámca; ` +
    `nejde o profilovanie natívneho vykresľovania na zariadení, pretože toto meranie ` +
    `prebieha mimo Expo runtime. Výsledky sú uvádzané mediánom a medzikvartilovým rozpätím.`;

  const ablationLines = conditions.map((condition) => {
    const groups = measuredRows.filter((row) => row.condition === condition.id);
    return `- ${condition.label}: ${groups.length} meraných riadkov.`;
  });

  const optimized1000 = summaryLookup(summary, Math.max(...options.sizes), "optimized");
  const baseline1000 = summaryLookup(summary, Math.max(...options.sizes), "baseline");

  const lines = [
    "# Meranie výkonu",
    "",
    paragraph,
    "",
    "## Konfigurácie",
    "",
    ...ablationLines,
    "",
    "## Poznámka k interpretácii",
    "",
    `Pri najväčšej mape mal baseline medián simulovaného rámca ${round(baseline1000.frameMedianMs, 2)} ms, zatiaľ čo optimalizovaná konfigurácia mala ${round(optimized1000.frameMedianMs, 2)} ms. Súbor results.csv obsahuje surové opakovania merania a summary.csv agregované mediány s IQR.`,
    "Ablácia bez cache trás je dostupná prepínačom --conditions=noRouteCache, ale nie je súčasťou predvoleného behu, pretože pri malých mapách zámerne vytvára extrémne pomalý stresový scenár routovania.",
    "",
  ];

  fs.writeFileSync(filePath, lines.join("\n"));
}

function getEnvironment() {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const cpu = os.cpus()[0]?.model ?? "Unknown CPU";
  const memoryGb = round(os.totalmem() / (1024 ** 3), 1);

  return {
    timestamp: new Date().toISOString(),
    device: `${os.hostname()} / ${cpu} / ${memoryGb} GB RAM`,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    nodeVersion: process.version,
    expoVersion: packageJson.dependencies?.expo ?? "unknown",
    reactNativeVersion: packageJson.dependencies?.["react-native"] ?? "unknown",
  };
}

function main(): void {
  const options = parseArgs();
  const activeConditions = getActiveConditions(options);
  fs.mkdirSync(options.outDir, { recursive: true });

  const rows: RepeatMetrics[] = [];
  const environment = getEnvironment();

  for (const size of options.sizes) {
    const baseMap = createBenchmarkMap(size, options.seed + size);
    for (const condition of activeConditions) {
      for (let repeat = -options.warmup; repeat < options.repeats; repeat += 1) {
        const warmup = repeat < 0;
        const measuredRepeat = warmup ? repeat + options.warmup : repeat;
        const metrics = runRepeat(baseMap, condition, options, measuredRepeat, warmup, environment);
        rows.push(metrics);
        const phase = warmup ? "warmup" : "measure";
        process.stdout.write(
          `${phase} N=${size} condition=${condition.id} repeat=${measuredRepeat} ` +
          `frame=${round(metrics.frameMedianMs, 3)}ms layout=${round(metrics.layoutMs, 3)}ms\n`
        );
      }
    }
  }

  const measuredRows = rows.filter((row) => !row.warmup);
  const summary = summarize(rows, activeConditions);
  writeResultsCsv(path.join(options.outDir, "results.csv"), measuredRows);
  writeSummaryCsv(path.join(options.outDir, "summary.csv"), summary);
  writeLatexTable(path.join(options.outDir, "table.tex"), summary, options.sizes);
  writeSvgChart(path.join(options.outDir, "frame-time.svg"), summary, options.sizes);
  writeMethodology(path.join(options.outDir, "methodology.sk.md"), rows, summary, options, activeConditions);
}

main();
