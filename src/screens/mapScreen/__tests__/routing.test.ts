/**
 * Súbor: src/screens/mapScreen/__tests__/routing.test.ts
 * Abstrakt: Overuje smerovanie vzťahov a výpočty trás medzi uzlami mapy.
 */
import type { EdgePoint } from "../../../components/EdgeView";
import type { MindMap, MindMapNode } from "../../../types/map";
import {
  findNearestInsertionSlot,
  makeNodeRouteRect,
  routeEdgePoints,
  routeIntersectsRect,
  routeIntersectsRoute,
  routeSegmentRects,
  type RouteRect,
} from "../routing";
import { buildRelationshipDisplayColors, type RouteColorRef } from "../routeColors";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeNull(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => TestMatchers;

function makeNode({ id, ...overrides }: Partial<MindMapNode> & { id: string }): MindMapNode {
  return {
    id,
    parentId: null,
    title: id,
    x: 0,
    y: 0,
    children: [],
    ...overrides,
  };
}

function expectRouteEndpoints(route: EdgePoint[], from: EdgePoint, to: EdgePoint) {
  expect(route[0]).toEqual(from);
  expect(route[route.length - 1]).toEqual(to);
}

function expectRouteAvoids(route: EdgePoint[], obstacles: RouteRect[]) {
  for (const obstacle of obstacles) {
    expect(routeIntersectsRect(route, obstacle)).toBe(false);
  }
}

function expectPointInsideRect(rect: RouteRect, point: EdgePoint) {
  expect(rect.left).toBeLessThanOrEqual(point.x);
  expect(rect.right).toBeGreaterThanOrEqual(point.x);
  expect(rect.top).toBeLessThanOrEqual(point.y);
  expect(rect.bottom).toBeGreaterThanOrEqual(point.y);
}

function createInsertionMap(): MindMap {
  root = makeNode({
    id: "root",
    title: "Root",
    x: 0,
    y: 0,
    children: ["left", "right", "moving"],
  });
  left = makeNode({
    id: "left",
    parentId: "root",
    title: "Left",
    x: -230,
    y: -80,
  });
  right = makeNode({
    id: "right",
    parentId: "root",
    title: "Right",
    x: 230,
    y: 80,
  });
  moving = makeNode({
    id: "moving",
    parentId: "root",
    title: "Moving",
    x: 230,
    y: 200,
  });

  return {
    id: "map",
    title: "Map",
    rootId: "root",
    nodes: { root, left, right, moving },
    edges: [],
  };
}

let root: MindMapNode;
let left: MindMapNode;
let right: MindMapNode;
let moving: MindMapNode;
let map: MindMap;

describe("routeEdgePoints", () => {
  it("returns a direct path when there are no obstacles", () => {
    const from: EdgePoint = { x: 0, y: 0 };
    const to: EdgePoint = { x: 100, y: 40 };

    expect(routeEdgePoints(from, to, [], 0)).toEqual([from, to]);
  });

  it("returns a path that avoids one blocking obstacle", () => {
    const from: EdgePoint = { x: 0, y: 0 };
    const to: EdgePoint = { x: 100, y: 0 };
    const obstacle: RouteRect = { id: "block", left: 40, right: 60, top: -10, bottom: 10 };

    const route = routeEdgePoints(from, to, [obstacle], 4);

    expect(route.length > 2).toBe(true);
    expect(routeIntersectsRect(route, obstacle)).toBe(false);
    expectRouteEndpoints(route, from, to);
  });

  it("returns a wider detour around a long blocking edge corridor", () => {
    const from: EdgePoint = { x: 0, y: 0 };
    const to: EdgePoint = { x: 140, y: 0 };
    const obstacle: RouteRect = { id: "edge-wall", left: 30, right: 110, top: -500, bottom: 500 };

    const route = routeEdgePoints(from, to, [obstacle], 7);

    expect(route.length > 2).toBe(true);
    expect(routeIntersectsRect(route, obstacle)).toBe(false);
    expectRouteEndpoints(route, from, to);
  });

  it("routes around several edge corridors instead of crossing through them", () => {
    const from: EdgePoint = { x: 0, y: 0 };
    const to: EdgePoint = { x: 300, y: 0 };
    const obstacles: RouteRect[] = [
      { id: "edge-a", left: 58, right: 70, top: -120, bottom: 120 },
      { id: "edge-b", left: 136, right: 148, top: -180, bottom: 180 },
      { id: "edge-c", left: 214, right: 226, top: -140, bottom: 140 },
    ];

    const route = routeEdgePoints(from, to, obstacles, 2);

    expect(route.length > 2).toBe(true);
    expectRouteAvoids(route, obstacles);
    expectRouteEndpoints(route, from, to);
  });
});

describe("routeIntersectsRect", () => {
  it("detects collinear overlap with an obstacle boundary", () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const obstacle: RouteRect = { id: "edge-boundary", left: 40, right: 60, top: 0, bottom: 20 };

    expect(routeIntersectsRect(route, obstacle)).toBe(true);
  });
});

describe("routeIntersectsRoute", () => {
  it("detects collinear overlapping routes", () => {
    expect(
      routeIntersectsRoute(
        [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        [{ x: 40, y: 0 }, { x: 140, y: 0 }]
      )
    ).toBe(true);
  });

  it("does not treat a shared endpoint as a crossing", () => {
    expect(
      routeIntersectsRoute(
        [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        [{ x: 100, y: 0 }, { x: 140, y: 40 }]
      )
    ).toBe(false);
  });
});

describe("buildRelationshipDisplayColors", () => {
  it("assigns different display colors to intersecting relationship routes with the same base color", () => {
    const relationshipRoutes: RouteColorRef[] = [
      {
        id: "rel-a",
        color: "#94a3b8",
        points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      },
      {
        id: "rel-b",
        color: "#94a3b8",
        points: [{ x: 0, y: 100 }, { x: 100, y: 0 }],
      },
    ];

    const colors = buildRelationshipDisplayColors([], relationshipRoutes, [
      "#38bdf8",
      "#22c55e",
      "#a855f7",
      "#f97316",
      "#ef4444",
      "#facc15",
      "#94a3b8",
    ]);

    expect(colors["rel-a"]).not.toBe(undefined);
    expect(colors["rel-b"]).not.toBe(undefined);
    expect(colors["rel-a"]).not.toBe(colors["rel-b"]);
    expect(colors["rel-a"]).not.toBe("#94a3b8");
    expect(colors["rel-b"]).not.toBe("#94a3b8");
  });
});

describe("makeNodeRouteRect", () => {
  it("returns a padded rectangle that covers the node center", () => {
    const node = makeNode({
      id: "node",
      title: "A",
      x: 100,
      y: 50,
      size: 30,
    });

    const rect = makeNodeRouteRect(node, false, 10);

    expect(rect.id).toBe("node");
    expect(rect.right).toBeGreaterThan(rect.left);
    expect(rect.bottom).toBeGreaterThan(rect.top);
    expectPointInsideRect(rect, node);
    expect(rect.left).toBeLessThan(node.x - 10);
    expect(rect.right).toBeGreaterThan(node.x + 10);
    expect(rect.top).toBeLessThan(node.y - 10);
    expect(rect.bottom).toBeGreaterThan(node.y + 10);
  });

  it("gives longer titles more horizontal routing space", () => {
    const shortNode = makeNode({ id: "short", title: "A", size: 30 });
    const longNode = makeNode({ id: "long", title: "A much longer topic title", size: 30 });

    const shortRect = makeNodeRouteRect(shortNode, false, 10);
    const longRect = makeNodeRouteRect(longNode, false, 10);

    expect(longRect.right - longRect.left).toBeGreaterThan(shortRect.right - shortRect.left);
  });
});

describe("routeSegmentRects", () => {
  it("returns obstacle rectangles that cover the middle of each route segment", () => {
    const rects = routeSegmentRects(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      "edge",
      5
    );

    expect(rects).toHaveLength(2);
    expect(rects[0].id).toBe("edge:segment:0");
    expect(rects[1].id).toBe("edge:segment:1");
    expectPointInsideRect(rects[0], { x: 50, y: 0 });
    expectPointInsideRect(rects[1], { x: 100, y: 50 });
  });

  it("does not create an obstacle rectangle for a tiny segment", () => {
    const rects = routeSegmentRects([{ x: 0, y: 0 }, { x: 1, y: 0 }], "tiny", 5);

    expect(rects).toHaveLength(0);
  });
});

describe("findNearestInsertionSlot", () => {
  beforeEach(() => {
    map = createInsertionMap();
  });

  it("returns the nearest valid slot for a valid position", () => {
    const slot = findNearestInsertionSlot(map, "moving", 230, 192);

    expect(slot?.parentId).toBe("root");
    expect(slot?.side).toBe(1);
    expect(slot?.index).toBe(1);
  });

  it("returns null for a position outside the insertion range", () => {
    const slot = findNearestInsertionSlot(map, "moving", 2000, 2000);

    expect(slot).toBeNull();
  });

  it("ignores descendants to prevent cycles", () => {
    root.children = ["moving"];
    delete map.nodes.left;
    delete map.nodes.right;
    moving.children = ["descendant"];
    map.nodes.descendant = makeNode({
      id: "descendant",
      parentId: "moving",
      title: "Descendant",
      x: 460,
      y: 200,
    });

    const slot = findNearestInsertionSlot(map, "moving", 690, 200);

    expect(slot).toBeNull();
  });
});
