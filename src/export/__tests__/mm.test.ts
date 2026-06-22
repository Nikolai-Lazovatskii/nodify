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

  it("exports visible due date and attachments for FreeMind", () => {
    map.nodes.child.dueAt = "2026-06-10T08:30:00.000Z";
    map.nodes.child.attachments = [
      {
        id: "attachment-1",
        name: "brief.pdf",
        uri: "file:///brief.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
      {
        id: "attachment-2",
        name: "spec.txt",
        uri: "file:///spec.txt",
      },
    ];

    const xml = exportToMm(map);

    expect(xml).toContain('LINK="file:///brief.pdf"');
    expect(xml).toContain("Due:");
    expect(xml).toContain("Attachments:");
    expect(xml).toContain("brief.pdf");
    expect(xml).toContain("file:///spec.txt");
    expect(xml).not.toContain("nodify.dueAt");
    expect(xml).not.toContain("nodify.attachment");
  });

  it("exports image attachments as visible node rich content", async () => {
    map.nodes.child.attachments = [
      {
        id: "image-1",
        name: "photo.png",
        uri: "attachments/photo.png",
        mimeType: "image/png",
      },
    ];

    const xml = exportToMm(map);
    const imported = await importFromMm(xml);

    expect(xml).toContain('<richcontent TYPE="NODE">');
    expect(xml).toContain('<p>Child</p>');
    expect(xml).toContain('<img src="attachments/photo.png" width="240" />');
    expect(xml).not.toContain('TEXT="Child"');
    expect(imported.nodes.child.title).toBe("Child");
    expect(imported.nodes.child.attachments?.[0].uri).toBe("attachments/photo.png");
  });

  it("normalizes imported old FreeMind map versions on export", () => {
    map.importedFormat = {
      sourceFormat: "mm",
      importedAt: "2026-06-14T00:00:00.000Z",
      preferredExportFormat: "mm",
      vendor: {
        mm: {
          rawMapAttributes: {
            version: "0.9.0",
          },
        },
      },
    };

    const xml = exportToMm(map);

    expect(xml).toContain('<map version="1.0.1">');
    expect(xml).not.toContain('version="0.9.0"');
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
    map.nodes.child.dueAt = "2026-06-10T08:30:00.000Z";
    map.nodes.child.attachments = [
      {
        id: "attachment-1",
        name: "brief.pdf",
        uri: "file:///brief.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
    ];
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
    expect(imported.nodes.child.dueAt).toBe("2026-06-10T08:30:00.000Z");
    expect(imported.nodes.child.attachments).toEqual([
      {
        id: "mm_note_attachment_child_1",
        name: "brief.pdf",
        uri: "file:///brief.pdf",
      },
    ]);
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
