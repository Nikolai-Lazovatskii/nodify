/**
 * Súbor: src/export/__tests__/xmind.test.ts
 * Abstrakt: Overuje export myšlienkových máp do formátu XMind a zachovanie dát.
 */
import JSZip from "jszip";

import { importFromXmind } from "../../import/xmind";
import type { MindMap, MindMapNode } from "../../types/map";
import { exportXmind } from "../doExportXmind";
import { exportToXmindZenContentJson } from "../xmind";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeDefined(): void;
  toThrow(expected?: string): void;
};

type JestGlobal = {
  mock(moduleName: string, factory: () => unknown): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => TestMatchers;
declare const jest: JestGlobal;

type XMindTopicOutput = {
  id?: string;
  title?: string;
  branch?: string;
  labels?: string[];
  notes?: {
    plain?: {
      content?: string;
    };
  };
  children?: {
    attached?: XMindTopicOutput[];
    detached?: XMindTopicOutput[];
  };
};

type XMindSheetOutput = {
  title?: string;
  rootTopic?: XMindTopicOutput;
  relationships?: {
    id?: string;
    end1Id?: string;
    end2Id?: string;
    style?: {
      properties?: Record<string, string>;
    };
  }[];
};

const mockWrittenFiles: { uri: string; value: string; options: unknown }[] = [];
const mockSharedFiles: { uri: string; options: unknown }[] = [];

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "cache/",
  documentDirectory: "documents/",
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: (uri: string, value: string, options: unknown): Promise<void> => {
    mockWrittenFiles.push({ uri, value, options });
    return Promise.resolve();
  },
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: (): Promise<boolean> => Promise.resolve(true),
  shareAsync: (uri: string, options: unknown): Promise<void> => {
    mockSharedFiles.push({ uri, options });
    return Promise.resolve();
  },
}));

let rootNode: MindMapNode;
let childNode: MindMapNode;
let map: MindMap;

function parseFirstSheet(json: string): XMindSheetOutput {
  const content = JSON.parse(json) as XMindSheetOutput[] | { sheets?: XMindSheetOutput[] };
  return Array.isArray(content) ? content[0] : content.sheets?.[0] ?? {};
}

async function createZipFromContentJson(contentJson: string): Promise<string> {
  const zip = new JSZip();
  zip.file("content.json", contentJson);
  zip.file("manifest.json", JSON.stringify({ "file-entries": {} }));
  zip.file("metadata.json", JSON.stringify({ creator: "test" }));
  return zip.generateAsync({ type: "base64" });
}

describe("exportToXmindZenContentJson", () => {
  beforeEach(() => {
    mockWrittenFiles.length = 0;
    mockSharedFiles.length = 0;
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

  it("exports a minimal MindMap into content.json", () => {
    const sheet = parseFirstSheet(exportToXmindZenContentJson(map));

    expect(sheet.title).toBe("Map");
    expect(sheet.rootTopic?.id).toBe("root");
    expect(sheet.rootTopic?.title).toBe("Root");
    expect(sheet.rootTopic?.children?.attached?.[0].title).toBe("Child");
  });

  it("exports a root-only map without attached topics", () => {
    map.nodes.root.children = [];
    delete map.nodes.child;

    const sheet = parseFirstSheet(exportToXmindZenContentJson(map));

    expect(sheet.rootTopic?.id).toBe("root");
    expect(sheet.rootTopic?.children?.attached).toBe(undefined);
  });

  it("exports notes, labels, collapsed state, and relationships", () => {
    map.nodes.child.collapsed = true;
    map.nodes.other = {
      id: "other",
      parentId: "root",
      title: "Other",
      x: -180,
      y: 0,
      children: [],
    };
    map.nodes.root.children.push("other");
    map.edges = [{ id: "rel-1", fromId: "child", toId: "other", style: "dashed", width: 3 }];

    const sheet = parseFirstSheet(exportToXmindZenContentJson(map));
    const child = sheet.rootTopic?.children?.attached?.find((topic) => topic.id === "child");

    expect(child?.notes?.plain?.content).toBe("Child note");
    expect(child?.labels).toEqual(["planning"]);
    expect(child?.branch).toBe("folded");
    expect(sheet.relationships).toHaveLength(1);
    expect(sheet.relationships?.[0].end1Id).toBe("child");
  });

  it("writes a valid .xmind ZIP structure", async () => {
    await exportXmind(map, "Save test");

    expect(mockWrittenFiles).toHaveLength(1);
    expect(mockSharedFiles).toHaveLength(1);

    const zip = await JSZip.loadAsync(mockWrittenFiles[0].value, { base64: true });

    expect(zip.file("content.json")).toBeDefined();
    expect(zip.file("manifest.json")).toBeDefined();
    expect(zip.file("metadata.json")).toBeDefined();
  });

  it("preserves key properties in an XMind round trip", async () => {
    map.nodes.child.collapsed = true;
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

    const zipBase64 = await createZipFromContentJson(exportToXmindZenContentJson(map));
    const imported = await importFromXmind(zipBase64);

    expect(imported.nodes.child.title).toBe("Child");
    expect(imported.nodes.child.note).toBe("Child note");
    expect(imported.nodes.child.tags).toEqual(["planning"]);
    expect(imported.nodes.child.collapsed).toBe(true);
    expect(imported.edges).toHaveLength(1);
  });

  it("throws for an empty map without a root node", () => {
    const emptyMap: MindMap = {
      id: "empty",
      title: "Empty",
      rootId: "root",
      nodes: {},
      edges: [],
    };

    expect(() => exportToXmindZenContentJson(emptyMap)).toThrow("Root node not found");
  });
});
