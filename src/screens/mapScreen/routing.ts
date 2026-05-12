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

export const NODE_TITLE_DISPLAY_MAX = 20;
export const NODE_IMAGE_THUMB_SIZE = 18;

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

function ccw(a: EdgePoint, b: EdgePoint, c: EdgePoint) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: EdgePoint, b: EdgePoint, c: EdgePoint, d: EdgePoint) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
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
