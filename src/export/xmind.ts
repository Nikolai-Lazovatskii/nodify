/**
 * Súbor: src/export/xmind.ts
 * Abstrakt: Prevádza internú myšlienkovú mapu do štruktúr a súborov formátu XMind.
 */
import { MindMap, MindMapNode, NodeAttachment, RelationshipEdge } from "../types/map";
import { layoutStructuredMap } from "../screens/mapScreen/mapModel";
import { makeNodeRouteRect, routeEdgePoints } from "../screens/mapScreen/routing";
import templateContent from "./templates/content.json";

function escapeText(s: string) {
  return (s ?? "").toString();
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeXmindColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (lower === "inherited" || lower === "none" || lower === "auto") {
    return undefined;
  }

  return trimmed;
}

function readRawTopicFillColor(rawTopic: unknown): string | undefined {
  const topic = asRecord(rawTopic);
  const style = asRecord(topic?.style);
  const properties = asRecord(style?.properties);
  if (!properties) {
    return undefined;
  }

  const candidates = [
    properties["svg:fill"],
    properties["fill-color"],
    properties["shape-fill"],
    properties.fill,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const color = normalizeXmindColor(candidate);
    if (color) {
      return color;
    }
  }

  return undefined;
}

function normalizeColorForCompare(value: string | undefined): string | undefined {
  const normalized = normalizeXmindColor(value);
  return normalized ? normalized.toLowerCase() : undefined;
}

function getManagedFillColor(node: MindMapNode): string | undefined {
  const currentColor = normalizeXmindColor(node.color);
  const importedColor =
    normalizeXmindColor(node.vendor?.xmind?.importedDisplayColor) ??
    normalizeXmindColor(node.vendor?.xmind?.importedFillColor) ??
    readRawTopicFillColor(node.vendor?.xmind?.rawTopic);

  if (node.vendor?.xmind?.rawTopic) {
    if (normalizeColorForCompare(currentColor) === normalizeColorForCompare(importedColor)) {
      return undefined;
    }
  }

  return currentColor;
}

function getManagedStyleProps(node: MindMapNode): Record<string, string | undefined> {
  return {
    "svg:fill": getManagedFillColor(node),
    "shape-class": node.shape ? getXmindShape(node) : undefined,
    "line-color": node.edgeToParent?.color || undefined,
    "line-pattern": node.edgeToParent ? getXmindLinePattern(node) : undefined,
    "line-width": node.edgeToParent ? getXmindLineWidth(node) : undefined,
  };
}

function applyManagedStyleProperties(
  targetTopic: Record<string, unknown>,
  managedProps: Record<string, string | undefined>
) {
  const baseStyle = asRecord(targetTopic.style) ?? {};
  const baseProps = asRecord(baseStyle.properties) ?? {};
  const nextProps: Record<string, unknown> = { ...baseProps };

  for (const [prop, value] of Object.entries(managedProps)) {
    if (typeof value !== "undefined") {
      nextProps[prop] = value;
    }
  }

  const hasProps = Object.keys(nextProps).length > 0;
  const hasStyleRest = Object.keys(baseStyle).some((key) => key !== "properties");

  if (hasProps || hasStyleRest) {
    targetTopic.style = hasProps ? { ...baseStyle, properties: nextProps } : { ...baseStyle };
    if (!hasProps && isRecord(targetTopic.style)) {
      delete (targetTopic.style as Record<string, unknown>).properties;
    }
  } else {
    delete targetTopic.style;
  }
}

const EXPORTED_DUE_LINE_PATTERN = /^Due:\s+\d{1,2}\.\d{1,2}\.\d{4}\s+\d{2}:\d{2}$/;

function isImageAttachment(attachment: NodeAttachment | undefined) {
  if (!attachment) {
    return false;
  }

  const mime = attachment.mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) {
    return true;
  }

  const source = `${attachment.name ?? ""} ${attachment.uri ?? ""}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)(?:$|[?#\s])/i.test(source);
}

function isXmindVisibleAttachmentUri(uri: string | undefined) {
  const value = uri?.trim();
  return !!value && (/^xap:/i.test(value) || /^https?:\/\//i.test(value) || /^data:/i.test(value));
}

function formatVisibleDueAt(dueAt: string | undefined) {
  const value = dueAt?.trim();
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  const day = `${date.getDate()}`.padStart(2, "0");
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const year = `${date.getFullYear()}`;
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `Due: ${day}.${month}.${year} ${hour}:${minute}`;
}

function stripVisibleExportMetadata(note: string) {
  const lines = note.split(/\r?\n/);
  const cleaned: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (EXPORTED_DUE_LINE_PATTERN.test(trimmed)) {
      continue;
    }

    if (trimmed === "Attachments:") {
      while (index + 1 < lines.length && lines[index + 1].trim().startsWith("- ")) {
        index += 1;
      }
      continue;
    }

    cleaned.push(lines[index]);
  }

  return cleaned.join("\n").trim();
}

function visibleAttachmentLine(attachment: NodeAttachment) {
  const name = attachment.name?.trim() || "Attachment";
  const uri = attachment.uri?.trim() || "";
  return uri ? `- ${name}: ${uri}` : `- ${name}`;
}

function buildVisibleNoteContent(
  note: string | undefined,
  dueAt: string | undefined,
  attachments: NodeAttachment[] | undefined
) {
  const visibleDueAt = formatVisibleDueAt(dueAt);
  const visibleAttachments = (attachments ?? []).filter(
    (attachment) => !isImageAttachment(attachment) && isXmindVisibleAttachmentUri(attachment.uri)
  );
  const metadataLines: string[] = [];
  const trimmedNote =
    visibleDueAt || visibleAttachments.length > 0
      ? stripVisibleExportMetadata(note ?? "")
      : note?.trim() ?? "";

  if (visibleDueAt) {
    metadataLines.push(visibleDueAt);
  }

  if (visibleAttachments.length > 0) {
    metadataLines.push("Attachments:");
    metadataLines.push(...visibleAttachments.map(visibleAttachmentLine));
  }

  if (trimmedNote && metadataLines.length > 0) {
    return `${trimmedNote}\n\n${metadataLines.join("\n")}`;
  }

  return trimmedNote || metadataLines.join("\n");
}

function applyManagedNote(
  targetTopic: Record<string, unknown>,
  note: string | undefined,
  dueAt: string | undefined,
  attachments: NodeAttachment[] | undefined
) {
  const visibleDueAt = formatVisibleDueAt(dueAt);
  const visibleAttachments = (attachments ?? []).some(
    (attachment) => !isImageAttachment(attachment) && isXmindVisibleAttachmentUri(attachment.uri)
  );
  if (typeof note === "undefined" && !visibleDueAt && !visibleAttachments) {
    return;
  }

  const baseNotes = asRecord(targetTopic.notes) ?? {};
  const basePlain = asRecord(baseNotes.plain) ?? {};
  const sourceNote =
    typeof note === "undefined"
      ? typeof basePlain.content === "string"
        ? basePlain.content
        : undefined
      : note;
  const nextContent = buildVisibleNoteContent(sourceNote, dueAt, attachments);

  if (nextContent) {
    targetTopic.notes = {
      ...baseNotes,
      plain: {
        ...basePlain,
        content: nextContent,
      },
    };
    return;
  }

  const nextNotes: Record<string, unknown> = { ...baseNotes };
  if (isRecord(nextNotes.plain)) {
    const plain = { ...(nextNotes.plain as Record<string, unknown>) };
    delete plain.content;
    if (Object.keys(plain).length > 0) {
      nextNotes.plain = plain;
    } else {
      delete nextNotes.plain;
    }
  }

  if (Object.keys(nextNotes).length > 0) {
    targetTopic.notes = nextNotes;
  } else {
    delete targetTopic.notes;
  }
}

function clearManagedAttachmentFields(targetTopic: Record<string, unknown>) {
  delete targetTopic.image;
  delete targetTopic.images;
  delete targetTopic.img;
  delete targetTopic["xhtml:img"];
  delete targetTopic["svg:image"];
  delete targetTopic["image-src"];
  delete targetTopic.imageSrc;
  delete targetTopic.imageUrl;
  delete targetTopic["image-url"];
  delete targetTopic.href;
  delete targetTopic.hyperlink;
  delete targetTopic.url;
  delete targetTopic.link;
}

function applyManagedAttachments(targetTopic: Record<string, unknown>, node: MindMapNode) {
  if (typeof node.attachments === "undefined") {
    return;
  }

  const visibleAttachments = node.attachments.filter((attachment) => isXmindVisibleAttachmentUri(attachment.uri));
  clearManagedAttachmentFields(targetTopic);

  const imageAttachment = visibleAttachments.find(isImageAttachment);
  if (imageAttachment?.uri) {
    targetTopic.image = {
      src: imageAttachment.uri,
      preview: imageAttachment.uri,
    };
  }

  const linkAttachment = visibleAttachments.find((attachment) => !isImageAttachment(attachment));
  if (linkAttachment?.uri) {
    targetTopic.href = linkAttachment.uri;
  }
}

function getTemplateSheet(content: unknown): Record<string, unknown> {
  if (Array.isArray(content) && isRecord(content[0])) return content[0];
  if (isRecord(content) && Array.isArray(content.sheets) && isRecord(content.sheets[0])) {
    return content.sheets[0];
  }
  throw new Error("Unsupported template content.json structure");
}

function getTemplateRootTopic(sheet: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(sheet.rootTopic)) return sheet.rootTopic;
  if (isRecord(sheet.root)) return sheet.root;
  throw new Error("Template sheet has no rootTopic");
}

function getXmindShape(node: MindMapNode): string {
  switch (node.shape) {
    case "capsule":
      return "org.xmind.topicShape.roundedRect";
    case "rounded":
      return "org.xmind.topicShape.roundedRect";
    case "circle":
    default:
      return "org.xmind.topicShape.roundedRect";
  }
}

function getXmindLinePattern(node: MindMapNode): string {
  return node.edgeToParent?.style === "dashed" ? "dash" : "solid";
}

function getXmindLineWidth(node: MindMapNode): string {
  return `${node.edgeToParent?.width ?? 2}pt`;
}

function getBaseTopic(node: MindMapNode): Record<string, unknown> {
  const rawTopic = node.vendor?.xmind?.rawTopic;
  const rawTopicRecord = asRecord(rawTopic);
  return rawTopicRecord ? clone(rawTopicRecord) : {};
}

function applyManagedLabels(targetTopic: Record<string, unknown>, node: MindMapNode) {
  if (typeof node.tags === "undefined") {
    return;
  }

  if (node.tags.length > 0) {
    targetTopic.labels = node.tags.filter(Boolean);
    return;
  }

  const existingLabels = asArray(targetTopic.labels);
  const hasNonStringLabels = existingLabels.some((value) => typeof value !== "string");
  if (!hasNonStringLabels) {
    delete targetTopic.labels;
  }
}

function normalizeAttachmentForExport(attachment: NodeAttachment): Record<string, unknown> | null {
  const id = attachment.id?.trim();
  const name = attachment.name?.trim();
  const uri = attachment.uri?.trim();
  if (!id || !name || !uri) {
    return null;
  }

  return {
    id,
    name,
    uri,
    mimeType: attachment.mimeType?.trim() || undefined,
    size: Number.isFinite(attachment.size) ? attachment.size : undefined,
  };
}

function buildNodifyNodeMetadata(node: MindMapNode): Record<string, unknown> | null {
  const attachments = (node.attachments ?? [])
    .map(normalizeAttachmentForExport)
    .filter((attachment): attachment is Record<string, unknown> => !!attachment);
  const dueAt = typeof node.dueAt === "string" && node.dueAt.trim() ? node.dueAt.trim() : undefined;
  const nodifyData: Record<string, unknown> = {};

  if (dueAt) {
    nodifyData.dueAt = dueAt;
  }

  if (attachments.length > 0) {
    nodifyData.attachments = attachments;
  }

  return Object.keys(nodifyData).length > 0 ? nodifyData : null;
}

export function exportToNodifyXmindMetadataJson(map: MindMap): string | null {
  const nodes: Record<string, unknown> = {};

  for (const node of Object.values(map.nodes)) {
    const metadata = buildNodifyNodeMetadata(node);
    if (metadata) {
      nodes[node.id] = metadata;
    }
  }

  if (Object.keys(nodes).length === 0) {
    return null;
  }

  return JSON.stringify({ version: 1, nodes }, null, 2);
}

function applyManagedTopicPosition(targetTopic: Record<string, unknown>, node: MindMapNode) {
  const rawPosition = asRecord(targetTopic.position);
  targetTopic.position = {
    ...(rawPosition ?? {}),
    x: node.x,
    y: node.y,
  };
}

function setTopicsBucket(
  nextChildren: Record<string, unknown>,
  key: "attached" | "detached",
  topics: unknown[]
) {
  const existingBucket = nextChildren[key];
  if (isRecord(existingBucket) && "topics" in existingBucket) {
    nextChildren[key] = { ...existingBucket, topics };
    return;
  }

  nextChildren[key] = topics;
}

function buildTopic(
  map: MindMap,
  nodeId: string,
  visited: Set<string>,
  detachedTopicsByParent: Map<string, unknown[]>
): Record<string, unknown> | null {
  const node = map.nodes[nodeId];
  if (!node) return null;
  if (visited.has(nodeId)) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  const childrenIds = (node.children ?? []).filter((cid) => !!map.nodes[cid]);
  const attached: Record<string, unknown>[] = [];
  for (const cid of childrenIds) {
    const childTopic = buildTopic(map, cid, nextVisited, detachedTopicsByParent);
    if (childTopic) {
      attached.push(childTopic);
    }
  }

  const topic = getBaseTopic(node);
  topic.id = node.id;
  topic.title = escapeText(node.title);
  applyManagedTopicPosition(topic, node);
  applyManagedAttachments(topic, node);
  applyManagedNote(topic, node.note, node.dueAt, node.attachments);
  applyManagedLabels(topic, node);

  if (node.collapsed === true) {
    topic.branch = "folded";
  } else if (node.collapsed === false && String(topic.branch ?? "").toLowerCase() === "folded") {
    delete topic.branch;
  }

  applyManagedStyleProperties(topic, getManagedStyleProps(node));

  const existingChildren = asRecord(topic.children) ?? {};
  const nextChildren: Record<string, unknown> = { ...existingChildren };

  if (attached.length > 0) {
    setTopicsBucket(nextChildren, "attached", attached);
  } else {
    delete nextChildren.attached;
  }

  const detachedTopics = detachedTopicsByParent.get(nodeId) ?? [];
  if (detachedTopics.length > 0) {
    setTopicsBucket(nextChildren, "detached", detachedTopics);
  } else if (node.parentId === null) {
    delete nextChildren.detached;
  }

  if (Object.keys(nextChildren).length > 0) {
    topic.children = nextChildren;
  } else {
    delete topic.children;
  }

  return topic;
}

function getOrCreateSheet(content: unknown, preferredIndex = 0): { sheet: Record<string, unknown>; contentRoot: unknown } {
  if (Array.isArray(content)) {
    if (!content[preferredIndex] || !isRecord(content[preferredIndex])) {
      content[preferredIndex] = {};
    }
    return { sheet: content[preferredIndex] as Record<string, unknown>, contentRoot: content };
  }

  if (isRecord(content) && Array.isArray(content.sheets)) {
    const sheets = content.sheets as unknown[];
    if (!sheets[preferredIndex] || !isRecord(sheets[preferredIndex])) {
      sheets[preferredIndex] = {};
    }
    return { sheet: sheets[preferredIndex] as Record<string, unknown>, contentRoot: content };
  }

  if (isRecord(content)) {
    return { sheet: content, contentRoot: content };
  }

  const fallback = clone(templateContent) as unknown;
  const sheet = getTemplateSheet(fallback) as Record<string, unknown>;
  return { sheet, contentRoot: fallback };
}

function getRootTopicKey(sheet: Record<string, unknown>): "rootTopic" | "root" {
  if ("root" in sheet && !("rootTopic" in sheet)) {
    return "root";
  }
  return "rootTopic";
}

function applyManagedRelationshipStyle(
  relationship: Record<string, unknown>,
  edge: RelationshipEdge
) {
  const style = asRecord(relationship.style) ?? {};
  const properties = asRecord(style.properties) ?? {};
  const nextProperties: Record<string, unknown> = { ...properties };

  if (typeof edge.color !== "undefined") {
    nextProperties["line-color"] = edge.color;
  }

  if (typeof edge.style !== "undefined") {
    nextProperties["line-pattern"] = edge.style === "solid" ? "solid" : "dash";
  }

  if (typeof edge.width !== "undefined") {
    nextProperties["line-width"] = `${Math.max(1, edge.width)}`;
  }

  relationship.style = { ...style, properties: nextProperties };
}

function routeMidpoint(points: { x: number; y: number }[]) {
  if (points.length <= 2) {
    return null;
  }

  const totalLength = points.slice(0, -1).reduce((sum, point, index) => {
    const next = points[index + 1];
    return sum + Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
  }, 0);

  if (totalLength <= 0) {
    return null;
  }

  let travelled = 0;
  const halfway = totalLength / 2;

  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const segmentLength = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);

    if (travelled + segmentLength >= halfway) {
      const ratio = segmentLength === 0 ? 0 : (halfway - travelled) / segmentLength;
      return {
        x: point.x + (next.x - point.x) * ratio,
        y: point.y + (next.y - point.y) * ratio,
      };
    }

    travelled += segmentLength;
  }

  return points[Math.floor(points.length / 2)] ?? null;
}

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function buildRelationshipControlPoints(map: MindMap, edge: RelationshipEdge, routeSeed: number) {
  const fromNode = map.nodes[edge.fromId];
  const toNode = map.nodes[edge.toId];
  if (!fromNode || !toNode) {
    return null;
  }

  const excludedIds = new Set([edge.fromId, edge.toId]);
  const obstacles = Object.values(map.nodes)
    .filter((node) => !excludedIds.has(node.id))
    .map((node) => makeNodeRouteRect(node, node.id === map.rootId, 24));
  const route = routeEdgePoints(fromNode, toNode, obstacles, routeSeed);
  const midpoint = routeMidpoint(route);

  if (!midpoint) {
    return null;
  }

  return {
    "0": {
      x: roundCoordinate(midpoint.x),
      y: roundCoordinate(midpoint.y),
    },
    "1": {
      angle: 0,
      amount: 0.5,
    },
  };
}

function buildRelationships(
  map: MindMap,
  sheet: Record<string, unknown>
): Record<string, unknown>[] {
  const sourceById = new Map<string, Record<string, unknown>>();
  const sourceRelationships = asArray(sheet.relationships).filter(isRecord);

  for (const relationship of sourceRelationships) {
    const id = relationship.id;
    if (typeof id === "string" && id.trim()) {
      sourceById.set(id.trim(), relationship);
    }
  }

  const built: Record<string, unknown>[] = [];
  const usedIds = new Set<string>();

  for (const [edgeIndex, edge] of map.edges.entries()) {
    if (!map.nodes[edge.fromId] || !map.nodes[edge.toId] || edge.fromId === edge.toId) {
      continue;
    }

    const baseId =
      edge.vendor?.xmind?.relationshipId?.trim() ||
      edge.id.trim() ||
      `xmind_rel_${built.length + 1}`;
    let relationshipId = baseId;
    let duplicate = 1;
    while (usedIds.has(relationshipId)) {
      relationshipId = `${baseId}_${duplicate++}`;
    }
    usedIds.add(relationshipId);

    const vendorRaw = asRecord(edge.vendor?.xmind?.rawRelationship);
    const sourceRaw = sourceById.get(baseId);
    const relationship = clone(vendorRaw ?? sourceRaw ?? {});

    relationship.id = relationshipId;
    relationship.end1Id = edge.fromId;
    relationship.end2Id = edge.toId;
    applyManagedRelationshipStyle(relationship, edge);
    const controlPoints = buildRelationshipControlPoints(map, edge, edgeIndex + 97);
    if (controlPoints) {
      relationship.controlPoints = controlPoints;
    }

    built.push(relationship);
  }

  const unmappedRelationships = map.importedFormat?.vendor?.xmind?.unmappedRelationships ?? [];
  for (const raw of unmappedRelationships) {
    const rawRecord = asRecord(raw);
    if (!rawRecord) {
      continue;
    }
    built.push(clone(rawRecord));
  }

  return built;
}

export function exportToXmindZenContentJson(map: MindMap): string {
  const exportMap = layoutStructuredMap(map);
  if (!exportMap.nodes[exportMap.rootId]) throw new Error("Root node not found");

  const importedRawContent = exportMap.importedFormat?.vendor?.xmind?.rawContent;
  const baseContent =
    typeof importedRawContent === "undefined" ? clone(templateContent) : clone(importedRawContent);
  const preferredIndex = exportMap.importedFormat?.vendor?.xmind?.rawSheetIndex ?? 0;
  const { sheet, contentRoot } = getOrCreateSheet(baseContent, preferredIndex);
  const rootKey = getRootTopicKey(sheet);
  const existingRoot = asRecord(sheet[rootKey]) ?? asRecord(sheet.rootTopic) ?? asRecord(sheet.root) ?? {};
  const templateRoot = Object.keys(existingRoot).length > 0 ? existingRoot : getTemplateRootTopic(sheet);

  const detachedTopicsByParent = new Map<string, unknown[]>();
  const floatingTopics: Record<string, unknown>[] = [];
  for (const node of Object.values(exportMap.nodes)) {
    if (node.parentId !== null || node.id === exportMap.rootId) {
      continue;
    }

    const topic = buildTopic(exportMap, node.id, new Set([exportMap.rootId]), detachedTopicsByParent);
    if (topic) {
      floatingTopics.push(topic);
    }
  }
  detachedTopicsByParent.set(exportMap.rootId, floatingTopics);

  const rootTopic = buildTopic(exportMap, exportMap.rootId, new Set(), detachedTopicsByParent);
  if (!rootTopic) throw new Error("Failed to build root topic");

  sheet.title = escapeText(exportMap.title || "Untitled");

  const nextRootTopic = { ...clone(templateRoot), ...rootTopic };
  if (!("children" in rootTopic)) {
    delete nextRootTopic.children;
  }
  sheet[rootKey] = nextRootTopic;
  if (rootKey === "rootTopic") {
    delete sheet.root;
  } else {
    delete sheet.rootTopic;
  }

  const relationships = buildRelationships(exportMap, sheet);
  if (relationships.length > 0) {
    sheet.relationships = relationships;
  } else {
    delete sheet.relationships;
  }

  return JSON.stringify(contentRoot, null, 2);
}
