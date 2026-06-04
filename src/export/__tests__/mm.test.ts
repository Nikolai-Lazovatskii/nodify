/**
 * Súbor: src/export/__tests__/mm.test.ts
 * Abstrakt: Overuje export myšlienkových máp do formátu FreeMind.
 */
import { importFromMm } from "../../import/mm";
import type { MindMap, MindMapNode } from "../../types/map";
import { exportToMm } from "../mm";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toMatch(expected: RegExp): void;
  toThrow(expected?: string): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => TestMatchers;

let rootNode: MindMapNode;
let childNode: MindMapNode;
let map: MindMap;

describe("exportToMm", () => {
  beforeEach(() => {
    rootNode = {
      id: "root",
      parentId: null,
      title: "Root",
      x: 0,
      y: 0,
      children: ["child"],
    };
    childNode = {
      id: "child",
      parentId: "root",
      title: "Child",
      note: "Child note",
      tags: ["planning"],
      x: 180,
      y: 0,
      children: [],
    };
    map = {
      id: "map",
      title: "Map",
      rootId: "root",
      nodes: {
        root: rootNode,
        child: childNode,
      },
      edges: [],
    };
  });

  it("exports a minimal MindMap as valid .mm XML text", () => {
    const xml = exportToMm(map);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<map version="1.0.1">');
    expect(xml).toContain('TEXT="Root"');
    expect(xml).toContain('TEXT="Child"');
  });

  it("exports a root-only map", () => {
    map.nodes.root.children = [];
    delete map.nodes.child;

    const xml = exportToMm(map);

    expect(xml).toContain('ID="root"');
    expect(xml).toMatch(/<node[^>]+TEXT="Root"[^>]*\/>/);
  });

  it("exports notes, tags, and collapsed branches", () => {
    map.nodes.child.collapsed = true;

    const xml = exportToMm(map);

    expect(xml).toContain('FOLDED="true"');
    expect(xml).toContain('<richcontent TYPE="NOTE">');
    expect(xml).toContain('<attribute NAME="tag" VALUE="planning" />');
  });

  it("exports free relationship edges as arrowlink elements", () => {
    map.nodes.other = {
      id: "other",
      parentId: "root",
      title: "Other",
      x: -180,
      y: 0,
      children: [],
    };
    map.nodes.root.children.push("other");
    map.edges = [
      {
        id: "rel-1",
        fromId: "child",
        toId: "other",
        style: "dashed",
        width: 3,
        color: "#ff0000",
      },
    ];

    const xml = exportToMm(map);

    expect(xml).toContain('<arrowlink');
    expect(xml).toContain('ID="rel-1"');
    expect(xml).toContain('DESTINATION="other"');
  });

  it("preserves key properties in an .mm round trip", async () => {
    map.nodes.child.collapsed = true;
    map.nodes.child.edgeToParent = { style: "dashed", width: 4, color: "#00ff00" };
    map.nodes.other = {
      id: "other",
      parentId: "root",
      title: "Other",
      x: -180,
      y: 0,
      children: [],
    };
    map.nodes.root.children.push("other");
    map.edges = [{ id: "rel-1", fromId: "child", toId: "other", style: "dashed" }];

    const imported = await importFromMm(exportToMm(map));

    expect(imported.nodes.child.title).toBe("Child");
    expect(imported.nodes.child.note).toBe("Child note");
    expect(imported.nodes.child.tags).toEqual(["planning"]);
    expect(imported.nodes.child.collapsed).toBe(true);
    expect(imported.nodes.child.edgeToParent).toEqual({
      style: "dashed",
      width: 4,
      color: "#00FF00",
    });
    expect(imported.edges).toHaveLength(1);
  });

  it("round-trips note text with literal angle brackets", async () => {
    map.nodes.child.note = "Use <tag> & keep it\nNext line";

    const imported = await importFromMm(exportToMm(map));

    expect(imported.nodes.child.note).toBe("Use <tag> & keep it\nNext line");
  });

  it("throws for an empty map without a root node", () => {
    const emptyMap: MindMap = {
      id: "empty",
      title: "Empty",
      rootId: "root",
      nodes: {},
      edges: [],
    };

    expect(() => exportToMm(emptyMap)).toThrow("Root node not found");
  });
});
