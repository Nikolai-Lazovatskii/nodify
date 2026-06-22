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
  image?: { preview?: string; src?: string } | string;
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
const mockFileBase64 = "UEZERGF0YQ==";
const mockReadFiles = new Map<string, string>();
const mockUnreadableUris = new Set<string>();

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "cache/",
  documentDirectory: "documents/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  readAsStringAsync: (uri: string): Promise<string> => {
    if (mockUnreadableUris.has(uri)) {
      return Promise.reject(new Error("File is not readable"));
    }

    return Promise.resolve(mockReadFiles.get(uri) ?? mockFileBase64);
  },
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
    mockReadFiles.clear();
    mockUnreadableUris.clear();
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
    expect(child?.notes?.plain?.content).toContain("Child note");
    expect(child?.notes?.plain?.content).toContain("Due:");
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

  it("packages local image attachments into the .xmind ZIP", async () => {
    const imageBase64 = "UE5HREFUQQ==";
    mockReadFiles.set("/local/photo.png", imageBase64);
    map.nodes.child.attachments = [
      {
        id: "image-1",
        name: "photo.png",
        uri: "/local/photo.png",
        mimeType: "image/png",
        size: 4096,
      },
    ];

    await exportXmind(map, "Save test");

    const zip = await JSZip.loadAsync(mockWrittenFiles[0].value, { base64: true });
    const contentRaw = await zip.file("content.json")?.async("string");
    const manifestRaw = await zip.file("manifest.json")?.async("string");
    const attachmentBase64 = await zip.file("attachments/photo.png")?.async("base64");
    const child = parseFirstSheet(contentRaw ?? "").rootTopic?.children?.attached?.find(
      (topic) => topic.id === "child"
    );
    const image = child?.image;
    const imageSrc = typeof image === "string" ? image : image?.src;
    const imagePreview = typeof image === "string" ? image : image?.preview;
    const manifest = JSON.parse(manifestRaw ?? "{}") as { "file-entries"?: Record<string, unknown> };

    expect(zip.file("attachments/photo.png")).toBeDefined();
    expect(attachmentBase64).toBe(imageBase64);
    expect(imageSrc).toBe("xap:attachments/photo.png");
    expect(imagePreview).toBe("xap:attachments/photo.png");
    expect(manifest["file-entries"]?.["attachments/photo.png"]).toBeDefined();

    const imported = await importFromXmind(mockWrittenFiles[0].value);
    expect(imported.nodes.child.attachments?.[0].name).toBe("photo.png");
    expect(imported.nodes.child.attachments?.[0].uri).toBe(`data:image/png;base64,${imageBase64}`);
  });

  it("packages local file attachments into the .xmind ZIP as href links", async () => {
    mockReadFiles.set("/local/brief.pdf", mockFileBase64);
    map.nodes.child.attachments = [
      {
        id: "attachment-1",
        name: "brief.pdf",
        uri: "/local/brief.pdf",
        mimeType: "application/pdf",
      },
    ];

    await exportXmind(map, "Save test");

    const zip = await JSZip.loadAsync(mockWrittenFiles[0].value, { base64: true });
    const contentRaw = await zip.file("content.json")?.async("string");
    const attachmentBase64 = await zip.file("attachments/brief.pdf")?.async("base64");
    const child = parseFirstSheet(contentRaw ?? "").rootTopic?.children?.attached?.find(
      (topic) => topic.id === "child"
    );

    expect(zip.file("attachments/brief.pdf")).toBeDefined();
    expect(attachmentBase64).toBe(mockFileBase64);
    expect(child?.href).toBe("xap:attachments/brief.pdf");

    const imported = await importFromXmind(mockWrittenFiles[0].value);
    expect(imported.nodes.child.attachments?.[0].name).toBe("brief.pdf");
    expect(imported.nodes.child.attachments?.[0].uri).toBe(`data:application/pdf;base64,${mockFileBase64}`);
  });

  it("fails clearly when an old temporary XMind attachment is no longer readable", async () => {
    const unreadableUri = "file:///tmp/host.exp.Exponent-Inbox/screenshot.png";
    mockUnreadableUris.add(unreadableUri);
    map.nodes.child.attachments = [
      {
        id: "image-1",
        name: "screenshot.png",
        uri: unreadableUri,
        mimeType: "image/png",
      },
    ];

    let message = "";
    try {
      await exportXmind(map, "Save test");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("no longer readable");
    expect(message).toContain("screenshot.png");
    expect(mockWrittenFiles).toHaveLength(0);
    expect(mockSharedFiles).toHaveLength(0);
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
