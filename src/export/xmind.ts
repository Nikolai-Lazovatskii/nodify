/**
 * Súbor: src/export/xmind.ts
 * Abstrakt: Prevádza internú myšlienkovú mapu do štruktúr a súborov formátu XMind.
 */
import { MindMap, MindMapNode, RelationshipEdge } from "../types/map";
import { layoutStructuredMap } from "../screens/mapScreen/mapModel";
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

function applyManagedNote(targetTopic: Record<string, unknown>, note: string | undefined) {
  if (typeof note === "undefined") {
    return;
  }

  const trimmed = note?.trim();
  const baseNotes = asRecord(targetTopic.notes) ?? {};
  const basePlain = asRecord(baseNotes.plain) ?? {};

  if (trimmed) {
    targetTopic.notes = {
      ...baseNotes,
      plain: {
        ...basePlain,
        content: trimmed,
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
  const attached = childrenIds
    .map((cid) => buildTopic(map, cid, nextVisited, detachedTopicsByParent))
    .filter(Boolean);

  const topic = getBaseTopic(node);
  topic.id = node.id;
  topic.title = escapeText(node.title);
  applyManagedTopicPosition(topic, node);
  applyManagedNote(topic, node.note);
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

  for (const edge of map.edges) {
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
  const floatingTopics = Object.values(exportMap.nodes)
    .filter((node) => node.parentId === null && node.id !== exportMap.rootId)
    .map((node) => buildTopic(exportMap, node.id, new Set([exportMap.rootId]), detachedTopicsByParent))
    .filter(Boolean) as Record<string, unknown>[];
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
