/**
 * Súbor: src/types/__tests__/map.test.ts
 * Abstrakt: Overuje správanie modelu myšlienkovej mapy a pomocných normalizačných funkcií.
 */
import type { MindMap, MindMapNode, RelationshipEdge } from "../map";
import {
  collectVisibleNodeIds,
  enforceRootConnectivity,
  hasRelationshipEdge,
  normalizeMap,
  prepareMapLayout,
} from "../../screens/mapScreen/mapModel";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeUndefined(): void;
};

declare const describe: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => TestMatchers;

function createRootOnlyMap(): MindMap {
  const root: MindMapNode = {
    id: "root",
    parentId: null,
    title: "Root",
    x: 0,
    y: 0,
    children: [],
  };

  return {
    id: "map",
    title: "Map",
    rootId: root.id,
    nodes: { [root.id]: root },
    edges: [],
  };
}

let rootOnlyMap: MindMap;

describe("MindMapNode model", () => {
  beforeEach(() => {
    rootOnlyMap = createRootOnlyMap();
  });

  it("creates a normalized default map when no source map is provided", () => {
    const map = normalizeMap(undefined, (key) => key);

    expect(map.rootId).toBe("root");
    expect(map.nodes.root.parentId).toBe(null);
    expect(map.nodes.root.children).toEqual(["c1", "c2", "c3"]);
    expect(map.edges).toEqual([]);
  });

  it("keeps explicit node defaults for a root-only map", () => {
    const map = normalizeMap(rootOnlyMap);
    const root = map.nodes.root;

    expect(root.id).toBe("root");
    expect(root.parentId).toBe(null);
    expect(root.children).toEqual([]);
    expect(root.collapsed).toBeUndefined();
  });

  it("creates relationship edges with stable endpoints", () => {
    const edge: RelationshipEdge = {
      id: "edge-1",
      fromId: "root",
      toId: "child",
      style: "dashed",
      width: 2,
      color: "#94a3b8",
    };

    expect(hasRelationshipEdge([edge], "root", "child")).toBe(true);
    expect(hasRelationshipEdge([edge], "child", "root")).toBe(true);
    expect(edge.id).toBe("edge-1");
  });

  it("repairs parentId and children consistency", () => {
    const map = rootOnlyMap;
    map.nodes.child = {
      id: "child",
      parentId: "root",
      title: "Child",
      x: 100,
      y: 0,
      children: [],
    };

    const nodes = enforceRootConnectivity(map.nodes, map.rootId);

    expect(nodes.root.children).toContain("child");
    expect(nodes.child.parentId).toBe("root");
  });

  it("hides descendants under collapsed branches", () => {
    const map = rootOnlyMap;
    map.nodes.root.children = ["branch"];
    map.nodes.branch = {
      id: "branch",
      parentId: "root",
      title: "Branch",
      x: 100,
      y: 0,
      children: ["leaf"],
      collapsed: true,
    };
    map.nodes.leaf = {
      id: "leaf",
      parentId: "branch",
      title: "Leaf",
      x: 200,
      y: 0,
      children: [],
    };

    const visibleIds = collectVisibleNodeIds(map);

    expect(visibleIds.has("root")).toBe(true);
    expect(visibleIds.has("branch")).toBe(true);
    expect(visibleIds.has("leaf")).toBe(false);
  });

  it("preserves coordinates for imported-layout maps", () => {
    const map = createRootOnlyMap();
    map.importedFormat = {
      sourceFormat: "xmind",
      importedAt: "2026-06-14T00:00:00.000Z",
    };
    map.nodes.root.children = ["child"];
    map.nodes.child = {
      id: "child",
      parentId: "root",
      title: "Child",
      x: 123,
      y: 456,
      children: [],
    };

    const prepared = prepareMapLayout(map);

    expect(prepared.layoutMode).toBe("imported");
    expect(prepared.nodes.child.x).toBe(123);
    expect(prepared.nodes.child.y).toBe(456);
  });

  it("keeps structured maps on the automatic tree layout", () => {
    const map = createRootOnlyMap();
    map.nodes.root.children = ["child"];
    map.nodes.child = {
      id: "child",
      parentId: "root",
      title: "Child",
      x: 10,
      y: 456,
      children: [],
    };

    const prepared = prepareMapLayout(map);

    expect(prepared.layoutMode).toBe("structured");
    expect(prepared.nodes.child.x).toBe(230);
    expect(prepared.nodes.child.y).toBe(0);
  });
});
