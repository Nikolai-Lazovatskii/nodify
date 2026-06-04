/**
 * Súbor: src/screens/mapScreen/routeColors.ts
 * Abstrakt: Vyberá dočasné farby pre vzťahové hrany, ktoré sa križujú s inými trasami.
 */
import type { EdgePoint } from "@/src/components/EdgeView";

import { routeIntersectsRoute } from "./routing";

export type RouteColorRef = {
  id: string;
  points: EdgePoint[];
  color: string;
};

function normalizeColor(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function parseHexColor(value: string) {
  const trimmed = normalizeColor(value);
  const short = trimmed.match(/^#([0-9a-f]{3})$/);
  if (short) {
    return short[1].split("").map((char) => parseInt(`${char}${char}`, 16));
  }

  const long = trimmed.match(/^#([0-9a-f]{6})$/);
  if (!long) {
    return null;
  }

  return [
    parseInt(long[1].slice(0, 2), 16),
    parseInt(long[1].slice(2, 4), 16),
    parseInt(long[1].slice(4, 6), 16),
  ];
}

function colorDistance(a: string, b: string) {
  const rgbA = parseHexColor(a);
  const rgbB = parseHexColor(b);
  if (!rgbA || !rgbB) {
    return normalizeColor(a) === normalizeColor(b) ? 0 : 255;
  }

  return Math.hypot(rgbA[0] - rgbB[0], rgbA[1] - rgbB[1], rgbA[2] - rgbB[2]);
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pickDistinctRouteColor(baseColor: string, avoidColors: string[], palette: string[], seed: string) {
  const avoid = [...avoidColors, baseColor].filter(Boolean);
  const candidates = palette.filter(
    (candidate) => !avoid.some((color) => normalizeColor(color) === normalizeColor(candidate))
  );
  const scored = (candidates.length > 0 ? candidates : palette)
    .map((candidate) => ({
      color: candidate,
      score: avoid.reduce(
        (nearest, color) => Math.min(nearest, colorDistance(candidate, color)),
        Number.POSITIVE_INFINITY
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  const chosen = top[hashString(seed) % Math.max(1, top.length)] ?? scored[0];

  return chosen?.color ?? baseColor;
}

export function buildRelationshipDisplayColors(
  treeRoutes: RouteColorRef[],
  relationshipRoutes: RouteColorRef[],
  palette: string[]
) {
  const routesById = new Map(relationshipRoutes.map((route) => [route.id, route]));
  const treeCrossingColors = new Map<string, string[]>();
  const relationshipNeighbors = new Map<string, Set<string>>();

  for (const route of relationshipRoutes) {
    const colors: string[] = [];
    for (const treeRoute of treeRoutes) {
      if (routeIntersectsRoute(route.points, treeRoute.points)) {
        colors.push(treeRoute.color);
      }
    }
    if (colors.length > 0) {
      treeCrossingColors.set(route.id, colors);
    }
  }

  for (let leftIndex = 0; leftIndex < relationshipRoutes.length; leftIndex += 1) {
    const left = relationshipRoutes[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < relationshipRoutes.length; rightIndex += 1) {
      const right = relationshipRoutes[rightIndex];
      if (!routeIntersectsRoute(left.points, right.points)) {
        continue;
      }

      if (!relationshipNeighbors.has(left.id)) {
        relationshipNeighbors.set(left.id, new Set<string>());
      }
      if (!relationshipNeighbors.has(right.id)) {
        relationshipNeighbors.set(right.id, new Set<string>());
      }

      relationshipNeighbors.get(left.id)?.add(right.id);
      relationshipNeighbors.get(right.id)?.add(left.id);
    }
  }

  const routesToColor = relationshipRoutes
    .filter((route) => (treeCrossingColors.get(route.id)?.length ?? 0) > 0 || (relationshipNeighbors.get(route.id)?.size ?? 0) > 0)
    .sort((a, b) => {
      const aDegree = (treeCrossingColors.get(a.id)?.length ?? 0) + (relationshipNeighbors.get(a.id)?.size ?? 0);
      const bDegree = (treeCrossingColors.get(b.id)?.length ?? 0) + (relationshipNeighbors.get(b.id)?.size ?? 0);
      return bDegree - aDegree || a.id.localeCompare(b.id);
    });
  const displayColors: Record<string, string> = {};

  for (const route of routesToColor) {
    const avoidColors = [...(treeCrossingColors.get(route.id) ?? [])];
    for (const neighborId of relationshipNeighbors.get(route.id) ?? []) {
      const neighbor = routesById.get(neighborId);
      const neighborColor = displayColors[neighborId] ?? neighbor?.color;
      if (neighborColor) {
        avoidColors.push(neighborColor);
      }
    }

    displayColors[route.id] = pickDistinctRouteColor(route.color, avoidColors, palette, route.id);
  }

  return displayColors;
}
