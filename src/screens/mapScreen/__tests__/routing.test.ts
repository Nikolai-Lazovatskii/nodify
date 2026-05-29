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
  routeSegmentRects,
  type RouteRect,
} from "../routing";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeNull(): void;
  toBeCloseTo(expected: number, precision?: number): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => TestMatchers;

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
    expect(route[0]).toEqual(from);
    expect(route[route.length - 1]).toEqual(to);
  });
});

describe("makeNodeRouteRect", () => {
  it("returns the expected padded bounding rectangle", () => {
    const node: MindMapNode = {
      id: "node",
      parentId: null,
      title: "A",
      x: 100,
      y: 50,
      children: [],
      size: 30,
    };

    const rect = makeNodeRouteRect(node, false, 10);

    expect(rect.id).toBe("node");
    expect(rect.left).toBeCloseTo(50.25, 2);
    expect(rect.right).toBeCloseTo(149.75, 2);
    expect(rect.top).toBeCloseTo(8.5, 2);
    expect(rect.bottom).toBeCloseTo(91.5, 2);
  });
});

describe("routeSegmentRects", () => {
  it("returns obstacle rectangles for each route segment", () => {
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
    expect(rects[0]).toEqual({ id: "edge:segment:0", left: 19, right: 81, top: -5, bottom: 5 });
    expect(rects[1]).toEqual({ id: "edge:segment:1", left: 95, right: 105, top: 19, bottom: 81 });
  });
});

describe("findNearestInsertionSlot", () => {
  beforeEach(() => {
    root = {
      id: "root",
      parentId: null,
      title: "Root",
      x: 0,
      y: 0,
      children: ["left", "right", "moving"],
    };
    left = {
      id: "left",
      parentId: "root",
      title: "Left",
      x: -230,
      y: -80,
      children: [],
    };
    right = {
      id: "right",
      parentId: "root",
      title: "Right",
      x: 230,
      y: 80,
      children: [],
    };
    moving = {
      id: "moving",
      parentId: "root",
      title: "Moving",
      x: 230,
      y: 200,
      children: [],
    };
    map = {
      id: "map",
      title: "Map",
      rootId: "root",
      nodes: { root, left, right, moving },
      edges: [],
    };
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
    map.nodes.descendant = {
      id: "descendant",
      parentId: "moving",
      title: "Descendant",
      x: 460,
      y: 200,
      children: [],
    };

    const slot = findNearestInsertionSlot(map, "moving", 690, 200);

    expect(slot).toBeNull();
  });
});
