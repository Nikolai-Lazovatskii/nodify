import { MindMap, MindMapNode, NodeShape, RelationshipEdge } from "../types/map";

type ParsedXmlNode = {
  attrs: Record<string, string>;
  children: ParsedXmlNode[];
  note?: string;
  tags?: string[];
  edgeAttrs?: Record<string, string>;
  arrowLinks?: { attrs: Record<string, string> }[];
};

function decodeXmlText(value: string | undefined): string {
  return (value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function safeNodeTitle(value: string | undefined, fallback: string): string {
  const trimmed = decodeXmlText(value).trim();
  return trimmed || fallback;
}

function parseMmShape(attrs: Record<string, string>, hasColor: boolean): NodeShape | undefined {
  const style = (attrs.STYLE ?? "").toLowerCase();
  if (style === "bubble") {
    return "rounded";
  }
  if (style === "fork") {
    return "capsule";
  }
  return hasColor ? "rounded" : undefined;
}

function parseMmLineStyle(value: string | undefined): "solid" | "dashed" {
  const source = String(value ?? "").toLowerCase();
  if (source.includes("dash") || source.includes("bezier")) {
    return "dashed";
  }
  return "solid";
}

function parseMmLineWidth(value: string | undefined, fallback = 2): number {
  const numeric = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.max(1, numeric);
}

function decodeHtmlToText(value: string): string {
  return decodeXmlText(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null = null;

  while ((match = attrRegex.exec(input))) {
    attrs[match[1]] = decodeXmlText(match[2]);
  }

  return attrs;
}

function cloneObject<T extends Record<string, string>>(value: T | undefined): T | undefined {
  if (!value) {
    return undefined;
  }
  return { ...value };
}

function omitKeys(
  value: Record<string, string> | undefined,
  keys: string[]
): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const denied = new Set(keys.map((key) => key.toUpperCase()));
  const out: Record<string, string> = {};

  for (const [key, attrValue] of Object.entries(value)) {
    if (denied.has(key.toUpperCase())) {
      continue;
    }
    out[key] = attrValue;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function parseMapAttributes(xml: string): Record<string, string> {
  const match = xml.match(/<\s*map\b([^>]*)>/i);
  if (!match) {
    return {};
  }

  return parseAttributes(match[1] ?? "");
}

function parseMmTree(xml: string): ParsedXmlNode {
  const tagRegex = /<\s*(\/?)(node|richcontent|attribute|edge|arrowlink)\b([^>]*?)(\/?)\s*>/gi;
  const stack: ParsedXmlNode[] = [];
  let root: ParsedXmlNode | null = null;
  let match: RegExpExecArray | null = null;

  while ((match = tagRegex.exec(xml))) {
    const isClosing = match[1] === "/";
    const tagName = (match[2] ?? "").toLowerCase();
    const rawAttrs = match[3] ?? "";
    const selfClosing = (match[4] ?? "") === "/";

    if (tagName === "richcontent" && !isClosing) {
      const attrs = parseAttributes(rawAttrs);
      const closeTag = "</richcontent>";
      const closeIndex = xml.toLowerCase().indexOf(closeTag, tagRegex.lastIndex);

      if (closeIndex !== -1 && stack.length > 0 && (attrs.TYPE ?? "").toUpperCase() === "NOTE") {
        const inner = xml.slice(tagRegex.lastIndex, closeIndex);
        const note = decodeHtmlToText(inner);
        if (note) {
          stack[stack.length - 1].note = note;
        }
        tagRegex.lastIndex = closeIndex + closeTag.length;
      }

      continue;
    }

    if (tagName === "attribute" && !isClosing) {
      if (stack.length > 0) {
        const attrs = parseAttributes(rawAttrs);
        if ((attrs.NAME ?? "").trim().toLowerCase() === "tag" && attrs.VALUE?.trim()) {
          const node = stack[stack.length - 1];
          node.tags = [...(node.tags ?? []), attrs.VALUE.trim()];
        }
      }
      continue;
    }

    if (tagName === "edge" && !isClosing) {
      if (stack.length > 0) {
        stack[stack.length - 1].edgeAttrs = parseAttributes(rawAttrs);
      }
      continue;
    }

    if (tagName === "arrowlink" && !isClosing) {
      if (stack.length > 0) {
        const current = stack[stack.length - 1];
        current.arrowLinks = [...(current.arrowLinks ?? []), { attrs: parseAttributes(rawAttrs) }];
      }
      continue;
    }

    if (tagName !== "node") {
      continue;
    }

    if (isClosing) {
      stack.pop();
      continue;
    }

    const node: ParsedXmlNode = {
      attrs: parseAttributes(rawAttrs),
      children: [],
    };

    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else if (!root) {
      root = node;
    }

    if (!selfClosing) {
      stack.push(node);
    }
  }

  if (!root) {
    throw new Error("Invalid .mm file: root node not found.");
  }

  return root;
}

function nextImportedId(counter: { value: number }) {
  counter.value += 1;
  return `imp_${counter.value}`;
}

function nextImportedArrowId(counter: { value: number }) {
  counter.value += 1;
  return `mm_arrow_${counter.value}`;
}

function resolveImportedNodeId(
  source: ParsedXmlNode,
  usedIds: Set<string>,
  counter: { value: number }
): string {
  const sourceId = (source.attrs.ID ?? "").trim();
  if (sourceId && !usedIds.has(sourceId)) {
    usedIds.add(sourceId);
    return sourceId;
  }

  let generated = nextImportedId(counter);
  while (usedIds.has(generated)) {
    generated = nextImportedId(counter);
  }
  usedIds.add(generated);
  return generated;
}

function buildImportedNodes(
  source: ParsedXmlNode,
  parentId: string | null,
  counter: { value: number },
  usedIds: Set<string>,
  sourceNodeToNodeId: Record<string, string>
): { rootId: string; nodes: Record<string, MindMapNode> } {
  const id = resolveImportedNodeId(source, usedIds, counter);
  const sourceNodeId = source.attrs.ID?.trim() || undefined;
  if (sourceNodeId) {
    sourceNodeToNodeId[sourceNodeId] = id;
  }

  const edgeAttrs = source.edgeAttrs ?? {};
  const lineStyleSource = edgeAttrs.STYLE ?? source.attrs.LINKSTYLE;
  const lineWidthSource = edgeAttrs.WIDTH ?? source.attrs.WIDTH;
  const lineColorSource = edgeAttrs.COLOR ?? source.attrs.EDGECOLOR;
  const hasExplicitParentEdgeStyle =
    typeof lineStyleSource === "string" ||
    typeof lineWidthSource === "string" ||
    typeof lineColorSource === "string";

  const node: MindMapNode = {
    id,
    parentId,
    title: safeNodeTitle(source.attrs.TEXT, parentId ? "Imported node" : "Imported map"),
    note: source.note?.trim() || undefined,
    tags: source.tags?.filter(Boolean)?.length ? Array.from(new Set(source.tags.filter(Boolean))) : undefined,
    x: 0,
    y: 0,
    children: [],
    collapsed: String(source.attrs.FOLDED ?? "").toLowerCase() === "true" ? true : undefined,
    color: source.attrs.BACKGROUND_COLOR?.trim() || undefined,
    size: parentId ? 30 : 42,
    shape: parseMmShape(source.attrs, !!source.attrs.BACKGROUND_COLOR),
    edgeToParent: parentId && hasExplicitParentEdgeStyle
      ? {
          style: parseMmLineStyle(lineStyleSource),
          width: parseMmLineWidth(lineWidthSource, 2),
          color: lineColorSource?.trim() || undefined,
        }
      : undefined,
    vendor: {
      mm: {
        sourceNodeId: sourceNodeId ?? id,
        rawAttributes: omitKeys(source.attrs, ["TEXT", "ID"]),
        rawEdgeAttributes: omitKeys(source.edgeAttrs, []),
      },
    },
  };

  const nodes: Record<string, MindMapNode> = {
    [id]: node,
  };

  for (const child of source.children) {
    const parsedChild = buildImportedNodes(child, id, counter, usedIds, sourceNodeToNodeId);
    node.children.push(parsedChild.rootId);
    Object.assign(nodes, parsedChild.nodes);
  }

  return { rootId: id, nodes };
}

function importArrowLinks(
  source: ParsedXmlNode,
  sourceNodeToNodeId: Record<string, string>,
  nodes: Record<string, MindMapNode>
): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];
  const usedIds = new Set<string>();
  const counter = { value: 0 };

  const walk = (node: ParsedXmlNode) => {
    const sourceFromId = node.attrs.ID?.trim() || "";
    const fromId = sourceNodeToNodeId[sourceFromId] ?? (nodes[sourceFromId] ? sourceFromId : "");

    for (const link of node.arrowLinks ?? []) {
      const destinationSourceId = link.attrs.DESTINATION?.trim() || "";
      const toId =
        sourceNodeToNodeId[destinationSourceId] ??
        (nodes[destinationSourceId] ? destinationSourceId : "");

      if (!fromId || !toId || fromId === toId) {
        continue;
      }

      let edgeId = (link.attrs.ID ?? "").trim() || nextImportedArrowId(counter);
      while (usedIds.has(edgeId)) {
        edgeId = nextImportedArrowId(counter);
      }
      usedIds.add(edgeId);

      edges.push({
        id: edgeId,
        fromId,
        toId,
        style: parseMmLineStyle(link.attrs.LINKSTYLE ?? link.attrs.STYLE),
        width: parseMmLineWidth(link.attrs.WIDTH, 2),
        color: link.attrs.COLOR?.trim() || undefined,
        vendor: {
          mm: {
            rawArrowlinkAttributes: cloneObject(link.attrs),
          },
        },
      });
    }

    for (const child of node.children) {
      walk(child);
    }
  };

  walk(source);
  return edges;
}

function countLeaves(nodeId: string, nodes: Record<string, MindMapNode>): number {
  const node = nodes[nodeId];
  if (!node || node.children.length === 0) {
    return 1;
  }

  return node.children.reduce((sum, childId) => sum + countLeaves(childId, nodes), 0);
}

function layoutSubtree(
  nodeId: string,
  nodes: Record<string, MindMapNode>,
  sign: -1 | 1,
  depth: number,
  startY: number
): number {
  const node = nodes[nodeId];
  if (!node) {
    return startY;
  }

  const xGap = 180;
  const yGap = 110;

  if (node.children.length === 0) {
    node.x = sign * depth * xGap;
    node.y = startY;
    return startY + yGap;
  }

  let cursorY = startY;
  for (const childId of node.children) {
    cursorY = layoutSubtree(childId, nodes, sign, depth + 1, cursorY);
  }

  const firstChild = nodes[node.children[0]];
  const lastChild = nodes[node.children[node.children.length - 1]];
  node.x = sign * depth * xGap;
  node.y = firstChild && lastChild ? (firstChild.y + lastChild.y) / 2 : startY;
  return cursorY;
}

function layoutImportedMap(map: MindMap): MindMap {
  const root = map.nodes[map.rootId];
  if (!root) {
    return map;
  }

  root.x = 0;
  root.y = 0;

  const rootChildren = [...root.children];
  if (rootChildren.length === 0) {
    return map;
  }

  const rightSide: string[] = [];
  const leftSide: string[] = [];

  rootChildren.forEach((childId, index) => {
    if (index % 2 === 0) {
      rightSide.push(childId);
    } else {
      leftSide.push(childId);
    }
  });

  const totalLeftLeaves = leftSide.reduce((sum, childId) => sum + countLeaves(childId, map.nodes), 0);
  const totalRightLeaves = rightSide.reduce((sum, childId) => sum + countLeaves(childId, map.nodes), 0);
  const yGap = 110;

  let leftCursor = -(Math.max(totalLeftLeaves - 1, 0) * yGap) / 2;
  let rightCursor = -(Math.max(totalRightLeaves - 1, 0) * yGap) / 2;

  for (const childId of leftSide) {
    leftCursor = layoutSubtree(childId, map.nodes, -1, 1, leftCursor);
  }

  for (const childId of rightSide) {
    rightCursor = layoutSubtree(childId, map.nodes, 1, 1, rightCursor);
  }

  const floatingNodes = Object.values(map.nodes).filter(
    (node) => node.parentId === null && node.id !== map.rootId
  );

  floatingNodes.forEach((node, index) => {
    node.x = (index - (floatingNodes.length - 1) / 2) * 220;
    node.y = -220;
  });

  return map;
}

export async function importFromMm(xml: string, fallbackTitle = "Imported mind map"): Promise<MindMap> {
  const rootSource = parseMmTree(xml);
  const counter = { value: 0 };
  const usedIds = new Set<string>();
  const sourceNodeToNodeId: Record<string, string> = {};
  const parsedRoot = buildImportedNodes(rootSource, null, counter, usedIds, sourceNodeToNodeId);
  const relationshipEdges = importArrowLinks(rootSource, sourceNodeToNodeId, parsedRoot.nodes);
  const rawMapAttributes = parseMapAttributes(xml);

  return layoutImportedMap({
    id: "imported",
    title: safeNodeTitle(rootSource.attrs.TEXT, fallbackTitle),
    rootId: parsedRoot.rootId,
    nodes: parsedRoot.nodes,
    edges: relationshipEdges,
    importedFormat: {
      sourceFormat: "mm",
      importedAt: new Date().toISOString(),
      preferredExportFormat: "mm",
      raw: {
        rawXml: xml,
      },
      vendor: {
        mm: {
          rawXml: xml,
          rawMapAttributes: Object.keys(rawMapAttributes).length > 0 ? rawMapAttributes : undefined,
        },
      },
    },
  });
}
