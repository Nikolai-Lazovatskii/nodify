/**
 * Súbor: src/import/mm.ts
 * Abstrakt: Parsuje XML formát FreeMind a prevádza ho na internú myšlienkovú mapu.
 */
import { MindMap, MindMapNode, NodeAttachment, NodeShape, RelationshipEdge } from "../types/map";

type ParsedXmlNode = {
  attrs: Record<string, string>;
  children: ParsedXmlNode[];
  richContentNode?: {
    imageSrc?: string;
    text?: string;
  };
  note?: string;
  tags?: string[];
  dueAt?: string;
  attachmentAttributes?: string[];
  edgeAttrs?: Record<string, string>;
  arrowLinks?: { attrs: Record<string, string> }[];
};

const EXPORTED_DUE_LINE_PATTERN = /^Due:\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{2}):(\d{2})$/;

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

function parseMmNumber(value: string | undefined): number | undefined {
  const numeric = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getAttachmentNameFromLink(link: string, fallback: string): string {
  const withoutQuery = link.split(/[?#]/)[0] ?? link;
  const normalized = withoutQuery.replace(/\\/g, "/").replace(/\/+$/g, "");
  const lastSegment = normalized.split("/").filter(Boolean).pop();

  if (!lastSegment) {
    return fallback;
  }

  try {
    return decodeURIComponent(lastSegment).trim() || fallback;
  } catch {
    return lastSegment.trim() || fallback;
  }
}

function buildMmLinkAttachment(nodeId: string, attrs: Record<string, string>, fallbackName: string): NodeAttachment | undefined {
  const link = attrs.LINK?.trim();
  if (!link) {
    return undefined;
  }

  return {
    id: `mm_link_${nodeId}`,
    name: getAttachmentNameFromLink(link, fallbackName),
    uri: link,
  };
}

function buildMmRichContentImageAttachment(
  nodeId: string,
  richContentNode: ParsedXmlNode["richContentNode"],
  fallbackName: string
): NodeAttachment | undefined {
  const imageSrc = richContentNode?.imageSrc?.trim();
  if (!imageSrc) {
    return undefined;
  }

  return {
    id: `mm_image_${nodeId}`,
    name: getAttachmentNameFromLink(imageSrc, fallbackName),
    uri: imageSrc,
  };
}

function normalizeNodifyAttachmentValue(
  nodeId: string,
  rawValue: string,
  index: number
): NodeAttachment | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      id: `mm_attachment_${nodeId}_${index + 1}`,
      name: getAttachmentNameFromLink(trimmed, "Attachment"),
      uri: trimmed,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const value = parsed as Record<string, unknown>;
  const uri = typeof value.uri === "string" ? value.uri.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!uri) {
    return undefined;
  }

  return {
    id: id || `mm_attachment_${nodeId}_${index + 1}`,
    name: name || getAttachmentNameFromLink(uri, "Attachment"),
    uri,
    mimeType: typeof value.mimeType === "string" && value.mimeType.trim() ? value.mimeType.trim() : undefined,
    size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : undefined,
  };
}

function mergeImportedAttachments(attachments: (NodeAttachment | undefined)[]) {
  const merged: NodeAttachment[] = [];
  const seen = new Set<string>();

  for (const attachment of attachments) {
    if (!attachment) {
      continue;
    }

    const key = attachment.uri.trim() || attachment.id.trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(attachment);
  }

  return merged;
}

function parseVisibleDueAt(line: string) {
  const match = EXPORTED_DUE_LINE_PATTERN.exec(line.trim());
  if (!match) {
    return undefined;
  }

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(year, month, day, hour, minute);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return undefined;
  }

  return date.toISOString();
}

function parseVisibleAttachmentLine(nodeId: string, line: string, index: number): NodeAttachment | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) {
    return undefined;
  }

  const body = trimmed.slice(2).trim();
  const delimiterIndex = body.indexOf(": ");
  const rawName = delimiterIndex > 0 ? body.slice(0, delimiterIndex).trim() : "";
  const uri = delimiterIndex > 0 ? body.slice(delimiterIndex + 2).trim() : body;
  if (!uri) {
    return undefined;
  }

  return {
    id: `mm_note_attachment_${nodeId}_${index + 1}`,
    name: rawName || getAttachmentNameFromLink(uri, "Attachment"),
    uri,
  };
}

function parseExportedMetadataFromNote(note: string | undefined, nodeId: string) {
  const empty = {
    note: note?.trim() || undefined,
    dueAt: undefined as string | undefined,
    attachments: [] as NodeAttachment[],
  };

  if (!note) {
    return empty;
  }

  const lines = note.split(/\r?\n/);
  const cleaned: string[] = [];
  let dueAt: string | undefined;
  const attachments: NodeAttachment[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const visibleDueAt = parseVisibleDueAt(trimmed);
    if (visibleDueAt) {
      dueAt = visibleDueAt;
      continue;
    }

    if (trimmed === "Attachments:") {
      while (index + 1 < lines.length && lines[index + 1].trim().startsWith("- ")) {
        index += 1;
        const attachment = parseVisibleAttachmentLine(nodeId, lines[index], attachments.length);
        if (attachment) {
          attachments.push(attachment);
        }
      }
      continue;
    }

    cleaned.push(lines[index]);
  }

  const result = cleaned.join("\n").trim();
  return {
    note: result || undefined,
    dueAt,
    attachments,
  };
}

function decodeHtmlToText(value: string): string {
  return decodeXmlText(value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/&lt;\/p&gt;\s*&lt;p&gt;/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
  )
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

function extractFirstImageSrc(value: string): string | undefined {
  const match = value.match(/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
  const src = decodeXmlText(match?.[1] ?? match?.[2]).trim();
  return src || undefined;
}

function parseAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = null;

  while ((match = attrRegex.exec(input))) {
    attrs[match[1]] = decodeXmlText(match[2] ?? match[3]);
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

      if (closeIndex !== -1 && stack.length > 0) {
        const inner = xml.slice(tagRegex.lastIndex, closeIndex);
        const type = (attrs.TYPE ?? "").toUpperCase();

        if (type === "NOTE") {
          const note = decodeHtmlToText(inner);
          if (note) {
            stack[stack.length - 1].note = note;
          }
        } else if (type === "NODE") {
          const imageSrc = extractFirstImageSrc(inner);
          const text = decodeHtmlToText(inner);
          if (imageSrc || text) {
            stack[stack.length - 1].richContentNode = {
              ...(imageSrc ? { imageSrc } : {}),
              ...(text ? { text } : {}),
            };
          }
        }

        tagRegex.lastIndex = closeIndex + closeTag.length;
      }

      continue;
    }

    if (tagName === "attribute" && !isClosing) {
      if (stack.length > 0) {
        const attrs = parseAttributes(rawAttrs);
        const name = (attrs.NAME ?? "").trim();
        const lowerName = name.toLowerCase();
        const value = attrs.VALUE?.trim();
        const node = stack[stack.length - 1];
        if (lowerName === "tag" && value) {
          node.tags = [...(node.tags ?? []), value];
        } else if (lowerName === "nodify.dueat" && value && !Number.isNaN(Date.parse(value))) {
          node.dueAt = value;
        } else if (lowerName === "nodify.attachment" && value) {
          node.attachmentAttributes = [...(node.attachmentAttributes ?? []), value];
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

  const title = safeNodeTitle(
    source.attrs.TEXT ?? source.richContentNode?.text,
    source.richContentNode?.imageSrc
      ? getAttachmentNameFromLink(source.richContentNode.imageSrc, "Image")
      : parentId ? "Imported node" : "Imported map"
  );
  const linkAttachment = buildMmLinkAttachment(id, source.attrs, title);
  const imageAttachment = buildMmRichContentImageAttachment(id, source.richContentNode, title);
  const attributeAttachments = (source.attachmentAttributes ?? []).map((value, index) =>
    normalizeNodifyAttachmentValue(id, value, index)
  );
  const noteMetadata = parseExportedMetadataFromNote(source.note, id);
  const attachments = mergeImportedAttachments([
    ...attributeAttachments,
    ...noteMetadata.attachments,
    linkAttachment,
    imageAttachment,
  ]);
  const dueAt = source.dueAt ?? noteMetadata.dueAt;

  const node: MindMapNode = {
    id,
    parentId,
    title,
    note: noteMetadata.note,
    tags: source.tags?.filter(Boolean)?.length ? Array.from(new Set(source.tags.filter(Boolean))) : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    dueAt,
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

function mmNodeAttrs(node: MindMapNode): Record<string, string> {
  return node.vendor?.mm?.rawAttributes ?? {};
}

function mmNodeSide(node: MindMapNode): "left" | "right" | undefined {
  const position = (mmNodeAttrs(node).POSITION ?? "").toLowerCase();
  if (position === "left") {
    return "left";
  }
  if (position === "right") {
    return "right";
  }
  return undefined;
}

function estimateImportedNodeWidth(node: MindMapNode): number {
  const titleWidth = Math.max(110, node.title.length * 8 + 52);
  return Math.min(320, titleWidth);
}

function estimateImportedSubtreeHeight(
  nodeId: string,
  nodes: Record<string, MindMapNode>,
  cache: Map<string, number>
): number {
  const cached = cache.get(nodeId);
  if (cached != null) {
    return cached;
  }

  const node = nodes[nodeId];
  if (!node || node.children.length === 0 || node.collapsed) {
    cache.set(nodeId, 96);
    return 96;
  }

  const childrenHeight = node.children.reduce(
    (sum, childId) => sum + estimateImportedSubtreeHeight(childId, nodes, cache),
    0
  );
  const height = Math.max(112, childrenHeight);
  cache.set(nodeId, height);
  return height;
}

function layoutSubtree(
  nodeId: string,
  nodes: Record<string, MindMapNode>,
  sign: -1 | 1,
  depth: number,
  centerY: number,
  heightCache: Map<string, number>,
  parentX = 0
): number {
  const node = nodes[nodeId];
  if (!node) {
    return 0;
  }

  const attrs = mmNodeAttrs(node);
  const hGap = parseMmNumber(attrs.HGAP);
  const vShift = parseMmNumber(attrs.VSHIFT) ?? 0;
  const branchHeight = estimateImportedSubtreeHeight(nodeId, nodes, heightCache);
  const xGap = Math.max(190, estimateImportedNodeWidth(node) + 76, hGap ? hGap + 130 : 0);
  node.x = parentX + sign * xGap;
  node.y = centerY + vShift;

  if (node.children.length === 0 || node.collapsed) {
    return branchHeight;
  }

  let cursorY = node.y - branchHeight / 2;
  for (const childId of node.children) {
    const childHeight = estimateImportedSubtreeHeight(childId, nodes, heightCache);
    const childCenterY = cursorY + childHeight / 2;
    layoutSubtree(childId, nodes, sign, depth + 1, childCenterY, heightCache, node.x);
    cursorY += childHeight;
  }

  return branchHeight;
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

  const heightCache = new Map<string, number>();
  const rightSide: string[] = [];
  const leftSide: string[] = [];

  rootChildren.forEach((childId, index) => {
    const child = map.nodes[childId];
    const side = child ? mmNodeSide(child) : undefined;
    if (side === "left") {
      leftSide.push(childId);
      return;
    }
    if (side === "right") {
      rightSide.push(childId);
      return;
    }

    if (rightSide.length <= leftSide.length) {
      rightSide.push(childId);
    } else {
      leftSide.push(childId);
    }
  });

  const totalLeftHeight = leftSide.reduce((sum, childId) => sum + estimateImportedSubtreeHeight(childId, map.nodes, heightCache), 0);
  const totalRightHeight = rightSide.reduce((sum, childId) => sum + estimateImportedSubtreeHeight(childId, map.nodes, heightCache), 0);

  let leftCursor = -totalLeftHeight / 2;
  let rightCursor = -totalRightHeight / 2;

  for (const childId of leftSide) {
    const height = estimateImportedSubtreeHeight(childId, map.nodes, heightCache);
    layoutSubtree(childId, map.nodes, -1, 1, leftCursor + height / 2, heightCache, root.x);
    leftCursor += height;
  }

  for (const childId of rightSide) {
    const height = estimateImportedSubtreeHeight(childId, map.nodes, heightCache);
    layoutSubtree(childId, map.nodes, 1, 1, rightCursor + height / 2, heightCache, root.x);
    rightCursor += height;
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

function preserveImportedPositions(map: MindMap): MindMap {
  for (const node of Object.values(map.nodes)) {
    node.vendor = {
      ...node.vendor,
      mm: {
        ...node.vendor?.mm,
        importedPosition: {
          x: node.x,
          y: node.y,
        },
      },
    };
  }

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

  return preserveImportedPositions(layoutImportedMap({
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
  }));
}
