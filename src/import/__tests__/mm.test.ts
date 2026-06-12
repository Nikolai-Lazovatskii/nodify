/**
 * Súbor: src/import/__tests__/mm.test.ts
 * Abstrakt: Overuje import máp zo súborov FreeMind vrátane štruktúry a metadát.
 */
import { importFromMm } from "../mm";

type TestMatchers = {
  not: TestMatchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toBeDefined(): void;
};

declare const beforeEach: (fn: () => void) => void;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const expect: (actual: unknown) => TestMatchers;

let minimalMm: string;

describe("importFromMm", () => {
  beforeEach(() => {
    minimalMm = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <node ID="root" TEXT="Root">
    <node ID="child" TEXT="Child" />
  </node>
</map>`;
  });

  it("imports a minimal valid .mm XML string", async () => {
    const map = await importFromMm(minimalMm);

    expect(map.title).toBe("Root");
    expect(map.rootId).toBe("root");
    expect(map.nodes.root.title).toBe("Root");
    expect(map.nodes.child.title).toBe("Child");
  });

  it("imports XML attributes wrapped in single quotes", async () => {
    const xml = `<?xml version='1.0'?>
<map version='1.0.1'>
  <node ID='root' TEXT='Root &amp; stuff'>
    <node ID='child' TEXT='Child node' />
  </node>
</map>`;

    const map = await importFromMm(xml);

    expect(map.rootId).toBe("root");
    expect(map.nodes.root.title).toBe("Root & stuff");
    expect(map.nodes.child.parentId).toBe("root");
  });

  it("keeps parentId and children consistent", async () => {
    const map = await importFromMm(minimalMm);

    expect(map.nodes.root.parentId).toBe(null);
    expect(map.nodes.root.children).toEqual(["child"]);
    expect(map.nodes.child.parentId).toBe("root");
  });

  it("imports tags and notes from node children", async () => {
    const xml = `<?xml version="1.0"?>
<map version="1.0.1">
  <node ID="root" TEXT="Root">
    <node ID="child" TEXT="Child">
      <richcontent TYPE="NOTE"><html><body>Line one&lt;br/&gt;Line two</body></html></richcontent>
      <attribute NAME="tag" VALUE="planning" />
      <attribute NAME="tag" VALUE="planning" />
      <attribute NAME="tag" VALUE="mobile" />
    </node>
  </node>
</map>`;

    const map = await importFromMm(xml);

    expect(map.nodes.child.note).toBe("Line one\nLine two");
    expect(map.nodes.child.tags).toEqual(["planning", "mobile"]);
  });

  it("imports node richcontent images without parsing embedded HTML as map nodes", async () => {
    const xml = `<?xml version="1.0"?>
<map version="1.0.1">
  <node ID="root" TEXT="Root">
    <node ID="image-node">
      <richcontent TYPE="NODE"><html><body><img src="picture.jpeg" /><node ID="fake" TEXT="Fake" /></body></html></richcontent>
    </node>
  </node>
</map>`;

    const map = await importFromMm(xml);

    expect(Object.keys(map.nodes)).toHaveLength(2);
    expect(map.nodes["image-node"].title).toBe("picture.jpeg");
    expect(map.nodes["image-node"].attachments?.[0].uri).toBe("picture.jpeg");
  });

  it("keeps literal angle brackets in notes instead of treating them as HTML", async () => {
    const xml = `<?xml version="1.0"?>
<map version="1.0.1">
  <node ID="root" TEXT="Root">
    <node ID="child" TEXT="Child">
      <richcontent TYPE="NOTE"><html><body>Use &lt;tag&gt; &amp; keep text</body></html></richcontent>
    </node>
  </node>
</map>`;

    const map = await importFromMm(xml);

    expect(map.nodes.child.note).toBe("Use <tag> & keep text");
  });

  it("imports collapsed state from folded branches", async () => {
    const xml = `<?xml version="1.0"?>
<map version="1.0.1">
  <node ID="root" TEXT="Root">
    <node ID="branch" TEXT="Branch" FOLDED="true">
      <node ID="leaf" TEXT="Leaf" />
    </node>
  </node>
</map>`;

    const map = await importFromMm(xml);

    expect(map.nodes.branch.collapsed).toBe(true);
    expect(map.nodes.branch.children).toEqual(["leaf"]);
    expect(map.nodes.leaf.parentId).toBe("branch");
  });

  it("imports free relationship edges from arrowlink elements", async () => {
    const xml = `<?xml version="1.0"?>
<map version="1.0.1">
  <node ID="root" TEXT="Root">
    <node ID="a" TEXT="A">
      <arrowlink ID="rel-1" DESTINATION="b" STYLE="bezier" WIDTH="3" COLOR="#ff0000" />
    </node>
    <node ID="b" TEXT="B" />
  </node>
</map>`;

    const map = await importFromMm(xml);

    expect(map.edges).toHaveLength(1);
    expect(map.edges[0].id).toBe("rel-1");
    expect(map.edges[0].fromId).toBe("a");
    expect(map.edges[0].toId).toBe("b");
    expect(map.edges[0].style).toBe("dashed");
  });

  it("imports a map with only a root node", async () => {
    const xml = `<?xml version="1.0"?><map version="1.0.1"><node ID="root" TEXT="Root only" /></map>`;

    const map = await importFromMm(xml);

    expect(map.rootId).toBe("root");
    expect(map.nodes.root.children).toEqual([]);
    expect(Object.keys(map.nodes)).toHaveLength(1);
  });
});
