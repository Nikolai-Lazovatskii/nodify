/**
 * Súbor: src/import/__tests__/xmind.test.ts
 * Abstrakt: Overuje import máp zo súborov XMind vrátane vetiev, vzťahov a príloh.
 */
import JSZip from "jszip";

import { importFromXmind } from "../xmind";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeDefined(): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => TestMatchers;

type XMindTopicFixture = {
  id: string;
  title: string;
  branch?: string;
  labels?: string[];
  notes?: {
    plain?: {
      content?: string;
    };
  };
  children?: {
    attached?: XMindTopicFixture[];
    detached?: XMindTopicFixture[];
  };
  style?: {
    properties?: Record<string, string>;
  };
};

type XMindSheetFixture = {
  id: string;
  title: string;
  rootTopic: XMindTopicFixture;
  relationships?: {
    id: string;
    end1Id: string;
    end2Id: string;
    style?: {
      properties?: Record<string, string>;
    };
  }[];
};

let sheet: XMindSheetFixture;

async function createXmindZipBase64(content: unknown): Promise<string> {
  const zip = new JSZip();
  zip.file("content.json", JSON.stringify(content));
  zip.file("manifest.json", JSON.stringify({ "file-entries": {} }));
  zip.file("metadata.json", JSON.stringify({ creator: "test" }));
  return zip.generateAsync({ type: "base64" });
}

describe("importFromXmind", () => {
  beforeEach(() => {
    sheet = {
      id: "sheet-1",
      title: "Imported Sheet",
      rootTopic: {
        id: "root",
        title: "Root",
        children: {
          attached: [{ id: "child", title: "Child" }],
        },
      },
    };
  });

  it("imports a minimal valid XMind content.json structure", async () => {
    const map = await importFromXmind(await createXmindZipBase64([sheet]));

    expect(map.title).toBe("Imported Sheet");
    expect(map.rootId).toBe("root");
    expect(map.nodes.root.title).toBe("Root");
    expect(map.nodes.child.title).toBe("Child");
  });

  it("keeps parentId and children consistent", async () => {
    const map = await importFromXmind(await createXmindZipBase64([sheet]));

    expect(map.nodes.root.parentId).toBe(null);
    expect(map.nodes.root.children).toEqual(["child"]);
    expect(map.nodes.child.parentId).toBe("root");
  });

  it("imports labels, notes, and folded branch state", async () => {
    sheet.rootTopic.children = {
      attached: [
        {
          id: "branch",
          title: "Branch",
          branch: "folded",
          labels: ["tag-a", "tag-b"],
          notes: { plain: { content: "Remember this" } },
          children: { attached: [{ id: "leaf", title: "Leaf" }] },
        },
      ],
    };

    const map = await importFromXmind(await createXmindZipBase64({ sheets: [sheet] }));

    expect(map.nodes.branch.collapsed).toBe(true);
    expect(map.nodes.branch.tags).toEqual(["tag-a", "tag-b"]);
    expect(map.nodes.branch.note).toBe("Remember this");
    expect(map.nodes.branch.children).toEqual(["leaf"]);
  });

  it("imports free relationship edges", async () => {
    sheet.rootTopic.children = {
      attached: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    };
    sheet.relationships = [
      {
        id: "rel-1",
        end1Id: "a",
        end2Id: "b",
        style: { properties: { "line-pattern": "dash", "line-width": "3", "line-color": "#00ff00" } },
      },
    ];

    const map = await importFromXmind(await createXmindZipBase64([sheet]));

    expect(map.edges).toHaveLength(1);
    expect(map.edges[0].fromId).toBe("a");
    expect(map.edges[0].toId).toBe("b");
    expect(map.edges[0].style).toBe("dashed");
    expect(map.edges[0].width).toBe(3);
  });

  it("imports a map with only a root topic", async () => {
    sheet.rootTopic.children = undefined;

    const map = await importFromXmind(await createXmindZipBase64([sheet]));

    expect(map.rootId).toBe("root");
    expect(map.nodes.root.children).toEqual([]);
    expect(Object.keys(map.nodes)).toHaveLength(1);
  });
});
