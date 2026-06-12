/**
 * Súbor: src/screens/mapScreen/routing.ts
 * Abstrakt: Počíta trasy, kotviace body a geometriu spojníc medzi uzlami.
 */
import type { EdgePoint } from "@/src/components/EdgeView";
import { MindMapNode, NodeAttachment } from "@/src/types/map";

import { LOCAL_ROUTE_OBSTACLE_LIMIT } from "./constants";

export type RouteRect = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type RoutedEdge = {
  id: string;
  points?: EdgePoint[];
};

export type InsertionSlot = {
  parentId: string;
  index: number;
  side: -1 | 1;
  distance: number;
};

export const NODE_TITLE_DISPLAY_MAX = 20;
export const NODE_IMAGE_THUMB_SIZE = 18;
export const INSERTION_SLOT_X_GAP = 230;
export const INSERTION_SLOT_Y_GAP = 112;
export const INSERTION_SLOT_MAX_DISTANCE = 360;
const GEOMETRY_EPSILON = 0.000001;

export function isImageAttachment(attachment: NodeAttachment | undefined) {
  if (!attachment) {
    return false;
  }

  const mime = attachment.mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) {
    return true;
  }

  const source = `${attachment.name ?? ""} ${attachment.uri ?? ""}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)(?:$|[?#\s])/i.test(source);
}

export function getNodeImageAttachment(node: MindMapNode | undefined) {
  return (node?.attachments ?? []).find(isImageAttachment);
}

export function getDisplayNodeTitle(title: string | undefined, maxLength = NODE_TITLE_DISPLAY_MAX) {
  const value = title ?? "";
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function estimateNodeHalfBounds(node: MindMapNode | undefined, isRoot: boolean) {
  const baseRadius = Math.max(isRoot ? 42 : 30, node?.size ?? (isRoot ? 42 : 30));
  const fontSize = Math.max(12, Math.round(baseRadius * (isRoot ? 0.45 : 0.38)));
  const textPaddingX = isRoot ? 22 : 18;
  const approxCharW = fontSize * 0.6;
  const textW = Math.max(24, getDisplayNodeTitle(node?.title).length * approxCharW);
  const hasImage = !!getNodeImageAttachment(node);
  const hasMeta = !!node?.note || !!node?.dueAt || (node?.attachments ?? []).length > 0 || (node?.tags ?? []).length > 0;
  const wBase = Math.max(
    baseRadius * (isRoot ? 2.8 : 2.65),
    textW + textPaddingX * 2 + (hasImage ? NODE_IMAGE_THUMB_SIZE + 6 : 0),
    hasMeta ? 112 : 0
  );
  const hBase = baseRadius * (hasMeta ? 2.35 : 2.1);

  return {
    halfW: wBase / 2,
    halfH: hBase / 2,
  };
}

export function makeNodeRouteRect(node: MindMapNode, isRoot: boolean, padding = 16): RouteRect {
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

function orientation(a: EdgePoint, b: EdgePoint, c: EdgePoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isPointOnSegment(point: EdgePoint, a: EdgePoint, b: EdgePoint) {
  return (
    Math.abs(orientation(a, b, point)) <= GEOMETRY_EPSILON &&
    point.x >= Math.min(a.x, b.x) - GEOMETRY_EPSILON &&
    point.x <= Math.max(a.x, b.x) + GEOMETRY_EPSILON &&
    point.y >= Math.min(a.y, b.y) - GEOMETRY_EPSILON &&
    point.y <= Math.max(a.y, b.y) + GEOMETRY_EPSILON
  );
}

function segmentsIntersect(a: EdgePoint, b: EdgePoint, c: EdgePoint, d: EdgePoint) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (
    ((o1 > GEOMETRY_EPSILON && o2 < -GEOMETRY_EPSILON) ||
      (o1 < -GEOMETRY_EPSILON && o2 > GEOMETRY_EPSILON)) &&
    ((o3 > GEOMETRY_EPSILON && o4 < -GEOMETRY_EPSILON) ||
      (o3 < -GEOMETRY_EPSILON && o4 > GEOMETRY_EPSILON))
  ) {
    return true;
  }

  return (
    isPointOnSegment(c, a, b) ||
    isPointOnSegment(d, a, b) ||
    isPointOnSegment(a, c, d) ||
    isPointOnSegment(b, c, d)
  );
}

function samePoint(a: EdgePoint, b: EdgePoint) {
  return a.x === b.x && a.y === b.y;
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

function routeIsClear(points: EdgePoint[], obstacles: RouteRect[]) {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (!isSegmentClear(points[index], points[index + 1], obstacles)) {
      return false;
    }
  }

  return true;
}

function routeLength(points: EdgePoint[]) {
  return points.slice(0, -1).reduce((sum, point, index) => {
    const next = points[index + 1];
    return sum + Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
  }, 0);
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

function findOuterDetour(
  from: EdgePoint,
  to: EdgePoint,
  obstacles: RouteRect[],
  routePadding: number,
  laneSeed: number
) {
  if (obstacles.length === 0) {
    return null;
  }

  const laneOffset = Math.abs(((laneSeed % 9) - 4) * 18);
  const outerPadding = routePadding * 8 + laneOffset;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const rect of obstacles) {
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }

  const outerXs = [left - outerPadding, right + outerPadding];
  const outerYs = [top - outerPadding, bottom + outerPadding];
  const candidates: EdgePoint[][] = [];

  for (const y of outerYs) {
    candidates.push([from, { x: from.x, y }, { x: to.x, y }, to]);
  }

  for (const x of outerXs) {
    candidates.push([from, { x, y: from.y }, { x, y: to.y }, to]);
  }

  for (const x of outerXs) {
    for (const y of outerYs) {
      candidates.push([from, { x, y: from.y }, { x, y }, { x: to.x, y }, to]);
      candidates.push([from, { x: from.x, y }, { x, y }, { x, y: to.y }, to]);
    }
  }

  return candidates
    .map(simplifyRoute)
    .filter((points) => routeIsClear(points, obstacles))
    .sort((a, b) => routeLength(a) - routeLength(b))[0] ?? null;
}

export function routeEdgePoints(
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

  if (obstacles.length > 0) {
    const outerPadding = routePadding * 4;
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    for (const rect of obstacles) {
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
      top = Math.min(top, rect.top);
      bottom = Math.max(bottom, rect.bottom);
    }

    xs.add(left - outerPadding);
    xs.add(right + outerPadding);
    ys.add(top - outerPadding);
    ys.add(bottom + outerPadding);
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
    for (const paddingMultiplier of [1, 1.6, 2.4, 3.4]) {
      const detour = findOuterDetour(from, to, obstacles, routePadding * paddingMultiplier, laneSeed);
      if (detour) {
        return detour;
      }
    }

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

export function routeSimpleEdgePoints(
  from: EdgePoint,
  to: EdgePoint,
  obstacles: RouteRect[],
  laneSeed = 0
): EdgePoint[] {
  const directRoute = [from, to];
  if (routeIsClear(directRoute, obstacles)) {
    return directRoute;
  }

  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const laneSkew = ((laneSeed % 5) - 2) * 14;
  const routePadding = 34 + Math.abs(laneSkew);
  const distanceToMid = (rect: RouteRect) => {
    const rectMidX = (rect.left + rect.right) / 2;
    const rectMidY = (rect.top + rect.bottom) / 2;
    return Math.abs(rectMidX - midX) + Math.abs(rectMidY - midY);
  };
  const blockingObstacles = obstacles
    .filter((rect) => routeIntersectsRect(directRoute, rect))
    .sort((a, b) => distanceToMid(a) - distanceToMid(b))
    .slice(0, 8);
  const laneObstacles = blockingObstacles.length > 0
    ? blockingObstacles
    : [...obstacles].sort((a, b) => distanceToMid(a) - distanceToMid(b)).slice(0, 6);
  const candidates: EdgePoint[][] = [];
  const addCandidate = (points: EdgePoint[]) => {
    candidates.push(simplifyRoute(points));
  };

  addCandidate([from, { x: midX + laneSkew, y: from.y }, { x: midX + laneSkew, y: to.y }, to]);
  addCandidate([from, { x: from.x, y: midY + laneSkew }, { x: to.x, y: midY + laneSkew }, to]);

  for (const rect of laneObstacles) {
    const topLane = rect.top - routePadding;
    const bottomLane = rect.bottom + routePadding;
    const leftLane = rect.left - routePadding;
    const rightLane = rect.right + routePadding;

    addCandidate([from, { x: from.x, y: topLane }, { x: to.x, y: topLane }, to]);
    addCandidate([from, { x: from.x, y: bottomLane }, { x: to.x, y: bottomLane }, to]);
    addCandidate([from, { x: leftLane, y: from.y }, { x: leftLane, y: to.y }, to]);
    addCandidate([from, { x: rightLane, y: from.y }, { x: rightLane, y: to.y }, to]);
  }

  if (laneObstacles.length > 0) {
    const left = Math.min(...laneObstacles.map((rect) => rect.left));
    const right = Math.max(...laneObstacles.map((rect) => rect.right));
    const top = Math.min(...laneObstacles.map((rect) => rect.top));
    const bottom = Math.max(...laneObstacles.map((rect) => rect.bottom));
    const topLane = top - routePadding * 1.4;
    const bottomLane = bottom + routePadding * 1.4;
    const leftLane = left - routePadding * 1.4;
    const rightLane = right + routePadding * 1.4;

    addCandidate([from, { x: from.x, y: topLane }, { x: to.x, y: topLane }, to]);
    addCandidate([from, { x: from.x, y: bottomLane }, { x: to.x, y: bottomLane }, to]);
    addCandidate([from, { x: leftLane, y: from.y }, { x: leftLane, y: to.y }, to]);
    addCandidate([from, { x: rightLane, y: from.y }, { x: rightLane, y: to.y }, to]);
  }

  const clearCandidate = candidates
    .filter((points) => points.length >= 2 && routeIsClear(points, obstacles))
    .sort((a, b) => {
      const aScore = routeLength(a) + Math.max(0, a.length - 2) * 42;
      const bScore = routeLength(b) + Math.max(0, b.length - 2) * 42;
      return aScore - bScore;
    })[0];
  if (clearCandidate) {
    return clearCandidate;
  }

  return findOuterDetour(from, to, obstacles, routePadding, laneSeed) ?? directRoute;
}

export function routeIntersectsRect(points: EdgePoint[], rect: RouteRect) {
  for (let index = 0; index < points.length - 1; index += 1) {
    if (segmentIntersectsRect(points[index], points[index + 1], rect)) {
      return true;
    }
  }

  return false;
}

export function routeIntersectsRoute(aPoints: EdgePoint[], bPoints: EdgePoint[]) {
  for (let aIndex = 0; aIndex < aPoints.length - 1; aIndex += 1) {
    const aStart = aPoints[aIndex];
    const aEnd = aPoints[aIndex + 1];

    for (let bIndex = 0; bIndex < bPoints.length - 1; bIndex += 1) {
      const bStart = bPoints[bIndex];
      const bEnd = bPoints[bIndex + 1];

      if (
        samePoint(aStart, bStart) ||
        samePoint(aStart, bEnd) ||
        samePoint(aEnd, bStart) ||
        samePoint(aEnd, bEnd)
      ) {
        continue;
      }

      if (segmentsIntersect(aStart, aEnd, bStart, bEnd)) {
        return true;
      }
    }
  }

  return false;
}

export function routeSegmentRects(points: EdgePoint[], idPrefix: string, padding = 8): RouteRect[] {
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

export function nearestRouteObstacles(
  from: EdgePoint,
  to: EdgePoint,
  obstacles: RouteRect[],
  excludedIds: Set<string>,
  limit = LOCAL_ROUTE_OBSTACLE_LIMIT
): RouteRect[] {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const ranked: { rect: RouteRect; distance: number }[] = [];

  for (const rect of obstacles) {
    if (excludedIds.has(rect.id)) {
      continue;
    }

    const rectMidX = (rect.left + rect.right) / 2;
    const rectMidY = (rect.top + rect.bottom) / 2;
    const distance = Math.abs(rectMidX - midX) + Math.abs(rectMidY - midY);
    const entry = { rect, distance };
    const insertAt = ranked.findIndex((item) => distance < item.distance);

    if (insertAt === -1) {
      if (ranked.length < limit) {
        ranked.push(entry);
      }
      continue;
    }

    ranked.splice(insertAt, 0, entry);
    if (ranked.length > limit) {
      ranked.pop();
    }
  }

  return ranked.map((item) => item.rect);
}

function collectDescendantIds(nodes: Record<string, MindMapNode>, nodeId: string): Set<string> {
  const descendants = new Set<string>();
  const visitNode = (id: string): void => {
    const node = nodes[id];
    if (!node) {
      return;
    }

    for (const childId of node.children) {
      if (descendants.has(childId)) {
        continue;
      }
      descendants.add(childId);
      visitNode(childId);
    }
  };

  visitNode(nodeId);
  return descendants;
}

function getBranchSide(map: { rootId: string; nodes: Record<string, MindMapNode> }, parent: MindMapNode, child?: MindMapNode): -1 | 1 {
  const root = map.nodes[map.rootId];
  if (parent.id === map.rootId) {
    if (child) {
      return child.x < parent.x ? -1 : 1;
    }
    return 1;
  }

  return parent.x < (root?.x ?? 0) ? -1 : 1;
}

function estimateInsertionSlotY(children: MindMapNode[], index: number, parentY: number): number {
  if (children.length === 0) {
    return parentY;
  }
  if (index <= 0) {
    return children[0].y - INSERTION_SLOT_Y_GAP;
  }
  if (index >= children.length) {
    return children[children.length - 1].y + INSERTION_SLOT_Y_GAP;
  }
  return (children[index - 1].y + children[index].y) / 2;
}

function getSlotDistance(x: number, y: number, slotX: number, slotY: number): number {
  const dx = Math.abs(x - slotX);
  const dy = Math.abs(y - slotY);
  return dx * 0.85 + dy;
}

type SortedVisibleChildrenOptions = {
  map: { nodes: Record<string, MindMapNode> };
  parent: MindMapNode;
  movingNodeId: string;
  descendantIds: Set<string>;
  visibleIds: Set<string>;
};

function getSortedVisibleChildren(options: SortedVisibleChildrenOptions): MindMapNode[] {
  const { map, parent, movingNodeId, descendantIds, visibleIds } = options;
  return parent.children
    .map((childId) => map.nodes[childId])
    .filter((child): child is MindMapNode =>
      !!child &&
      child.id !== movingNodeId &&
      !descendantIds.has(child.id) &&
      visibleIds.has(child.id)
    )
    .sort((a, b) => a.y - b.y);
}

export function findNearestInsertionSlot(
  map: { rootId: string; nodes: Record<string, MindMapNode> },
  nodeId: string,
  x: number,
  y: number
): InsertionSlot | null {
  const movingNode = map.nodes[nodeId];
  const root = map.nodes[map.rootId];
  if (!movingNode || !root || nodeId === map.rootId) {
    return null;
  }

  const visibleIds = new Set<string>();
  const visitVisibleNode = (visibleNodeId: string): void => {
    const node = map.nodes[visibleNodeId];
    if (!node || visibleIds.has(visibleNodeId)) {
      return;
    }

    visibleIds.add(visibleNodeId);
    if (!node.collapsed) {
      node.children.forEach(visitVisibleNode);
    }
  };
  visitVisibleNode(map.rootId);

  const descendants = collectDescendantIds(map.nodes, nodeId);
  let bestSlot: InsertionSlot | null = null;
  const considerSlot = (parent: MindMapNode, side: -1 | 1, children: MindMapNode[]): void => {
    for (let index = 0; index <= children.length; index += 1) {
      const slotX = parent.x + side * INSERTION_SLOT_X_GAP;
      const slotY = estimateInsertionSlotY(children, index, parent.y);
      const distance = getSlotDistance(x, y, slotX, slotY);

      if (!bestSlot || distance < bestSlot.distance) {
        bestSlot = { parentId: parent.id, index, side, distance };
      }
    }
  };

  for (const parent of Object.values(map.nodes)) {
    if (parent.id === nodeId || descendants.has(parent.id) || !visibleIds.has(parent.id)) {
      continue;
    }

    const childNodes = getSortedVisibleChildren({
      map,
      parent,
      movingNodeId: nodeId,
      descendantIds: descendants,
      visibleIds,
    });

    if (parent.id === map.rootId) {
      considerSlot(parent, -1, childNodes.filter((child) => child.x < parent.x));
      considerSlot(parent, 1, childNodes.filter((child) => child.x >= parent.x));
      continue;
    }

    considerSlot(parent, getBranchSide(map, parent), childNodes);
  }

  const nearestSlot = bestSlot as InsertionSlot | null;
  return nearestSlot && nearestSlot.distance <= INSERTION_SLOT_MAX_DISTANCE ? nearestSlot : null;
}
