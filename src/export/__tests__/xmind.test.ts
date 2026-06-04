/**
 * Súbor: src/export/__tests__/xmind.test.ts
 * Abstrakt: Overuje export myšlienkových máp do formátu XMind a zachovanie dát.
 */
import JSZip from "jszip";

import { importFromXmind } from "../../import/xmind";
import type { MindMap, MindMapNode } from "../../types/map";
import { exportXmind } from "../doExportXmind";
import { exportToNodifyXmindMetadataJson, exportToXmindZenContentJson } from "../xmind";

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
  href?: string;
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
  extensions?: {
    nodify?: {
      dueAt?: string;
      attachments?: {
        id?: string;
        name?: string;
        uri?: string;
        mimeType?: string;
        size?: number;
      }[];
    };
  };
};

type XMindSheetOutput = {
  title?: string;
  rootTopic?: XMindTopicOutput;
  relationships?: {
    id?: string;
    end1Id?: string;
    end2Id?: string;
    controlPoints?: {
      "0"?: {
        x?: number;
        y?: number;
      };
      "1"?: {
        angle?: number;
        amount?: number;
      };
    };
    style?: {
      properties?: Record<string, string>;
    };
  }[];
};

type NodifyMetadataOutput = {
  version?: number;
  nodes?: Record<string, {
    dueAt?: string;
    attachments?: {
      id?: string;
      name?: string;
      uri?: string;
      mimeType?: string;
      size?: number;
    }[];
  }>;
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

async function createZipFromContentJson(contentJson: string, nodifyMetadataJson?: string | null): Promise<string> {
  const zip = new JSZip();
  zip.file("content.json", contentJson);
  zip.file("manifest.json", JSON.stringify({ "file-entries": {} }));
  zip.file("metadata.json", JSON.stringify({ creator: "test" }));
  if (nodifyMetadataJson) {
    zip.file("nodify-metadata.json", nodifyMetadataJson);
  }
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

  it("keeps content.json XMind-compatible and writes Nodify metadata separately", () => {
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

    const sheet = parseFirstSheet(exportToXmindZenContentJson(map));
    const child = sheet.rootTopic?.children?.attached?.find((topic) => topic.id === "child");
    const metadata = JSON.parse(exportToNodifyXmindMetadataJson(map) ?? "{}") as NodifyMetadataOutput;

    expect(child?.extensions?.nodify).toBe(undefined);
    expect(child?.href).toBe(undefined);
    expect(metadata.nodes?.child?.dueAt).toBe("2026-06-10T08:30:00.000Z");
    expect(metadata.nodes?.child?.attachments).toEqual([
      {
        id: "attachment-1",
        name: "brief.pdf",
        uri: "file:///brief.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
    ]);
  });

  it("adds XMind relationship control points when a direct link crosses another topic", () => {
    map.nodes.other = {
      id: "other",
      parentId: "root",
      title: "Other",
      x: 180,
      y: 0,
      children: [],
    };
    map.nodes.root.children.push("other");
    map.edges = [{ id: "rel-1", fromId: "child", toId: "other", style: "dashed" }];

    const sheet = parseFirstSheet(exportToXmindZenContentJson(map));
    const controlPoint = sheet.relationships?.[0].controlPoints?.["0"];

    expect(controlPoint).toBeDefined();
    expect(Math.abs(controlPoint?.y ?? 0) > 1).toBe(true);
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

  it("writes Nodify metadata as a sidecar file in the .xmind ZIP", async () => {
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

    await exportXmind(map, "Save test");

    const zip = await JSZip.loadAsync(mockWrittenFiles[0].value, { base64: true });
    const nodifyMetadataRaw = await zip.file("nodify-metadata.json")?.async("string");
    const manifestRaw = await zip.file("manifest.json")?.async("string");
    const nodifyMetadata = JSON.parse(nodifyMetadataRaw ?? "{}") as NodifyMetadataOutput;
    const manifest = JSON.parse(manifestRaw ?? "{}") as { "file-entries"?: Record<string, unknown> };

    expect(manifest["file-entries"]?.["nodify-metadata.json"]).toBeDefined();
    expect(nodifyMetadata.nodes?.child?.dueAt).toBe("2026-06-10T08:30:00.000Z");
    expect(nodifyMetadata.nodes?.child?.attachments).toHaveLength(1);
  });

  it("preserves key properties in an XMind round trip", async () => {
    map.nodes.child.collapsed = true;
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

    const zipBase64 = await createZipFromContentJson(
      exportToXmindZenContentJson(map),
      exportToNodifyXmindMetadataJson(map)
    );
    const imported = await importFromXmind(zipBase64);

    expect(imported.nodes.child.title).toBe("Child");
    expect(imported.nodes.child.note).toBe("Child note");
    expect(imported.nodes.child.tags).toEqual(["planning"]);
    expect(imported.nodes.child.dueAt).toBe("2026-06-10T08:30:00.000Z");
    expect(imported.nodes.child.attachments).toEqual([
      {
        id: "attachment-1",
        name: "brief.pdf",
        uri: "file:///brief.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
    ]);
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
