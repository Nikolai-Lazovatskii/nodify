/**
 * Súbor: src/export/__tests__/doExportMm.test.ts
 * Abstrakt: Overuje vytváranie prenosného FreeMind ZIP exportu s prílohami.
 */
import JSZip from "jszip";

import type { MindMap, MindMapNode } from "../../types/map";
import { exportMm } from "../doExportMm";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeDefined(): void;
};

type JestGlobal = {
  mock(moduleName: string, factory: () => unknown): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => TestMatchers;
declare const jest: JestGlobal;

const mockWrittenFiles: { uri: string; value: string; options: unknown }[] = [];
const mockSharedFiles: { uri: string; options: unknown }[] = [];
const mockFileBase64 = "UEZERGF0YQ==";
const mockUnreadableUris = new Set<string>();

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "cache/",
  documentDirectory: "documents/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  readAsStringAsync: (uri: string): Promise<string> => {
    if (mockUnreadableUris.has(uri)) {
      return Promise.reject(new Error("File is not readable"));
    }

    return Promise.resolve(mockFileBase64);
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

describe("exportMm", () => {
  beforeEach(() => {
    mockWrittenFiles.length = 0;
    mockSharedFiles.length = 0;
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

  it("writes a portable ZIP when the map has local attachments", async () => {
    map.nodes.child.attachments = [
      {
        id: "attachment-1",
        name: "brief.pdf",
        uri: "/local/brief.pdf",
        mimeType: "application/pdf",
      },
    ];

    await exportMm(map, "Save FreeMind");

    expect(mockWrittenFiles).toHaveLength(1);
    expect(mockSharedFiles).toHaveLength(1);
    expect(mockWrittenFiles[0].uri).toContain("-freemind.zip");

    const zip = await JSZip.loadAsync(mockWrittenFiles[0].value, { base64: true });
    const mmFile = zip.file("Map-map.mm");
    const attachmentFile = zip.file("attachments/brief.pdf");
    const xml = await mmFile?.async("string");
    const attachmentBase64 = await attachmentFile?.async("base64");

    expect(mmFile).toBeDefined();
    expect(attachmentFile).toBeDefined();
    expect(xml).toContain('LINK="attachments/brief.pdf"');
    expect(xml).toContain("attachments/brief.pdf");
    expect(attachmentBase64).toBe(mockFileBase64);
  });

  it("writes a plain .mm when there are no local attachments", async () => {
    await exportMm(map, "Save FreeMind");

    expect(mockWrittenFiles).toHaveLength(1);
    expect(mockSharedFiles).toHaveLength(1);
    expect(mockWrittenFiles[0].uri).toContain(".mm");
    expect(mockWrittenFiles[0].uri).not.toContain(".zip");
    expect(mockWrittenFiles[0].value).toContain("<map");
  });

  it("fails clearly when an old temporary attachment is no longer readable", async () => {
    const unreadableUri = "file:///tmp/host.exp.Exponent-Inbox/screenshot.png";
    mockUnreadableUris.add(unreadableUri);
    map.nodes.child.attachments = [
      {
        id: "attachment-1",
        name: "screenshot.png",
        uri: unreadableUri,
        mimeType: "image/png",
      },
    ];

    let message = "";
    try {
      await exportMm(map, "Save FreeMind");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("no longer readable");
    expect(message).toContain("screenshot.png");
    expect(mockWrittenFiles).toHaveLength(0);
    expect(mockSharedFiles).toHaveLength(0);
  });
});
