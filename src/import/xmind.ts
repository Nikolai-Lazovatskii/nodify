import JSZip from "jszip";

import { JsonValue, MindMap, MindMapNode, NodeShape, RelationshipEdge } from "../types/map";

type XMindTopic = {
  id?: string;
  title?: string;
  labels?: string[];
  branch?: string;
  notes?: {
    plain?: {
      content?: string;
    };
  };
  relationship?: unknown;
  children?: {
    attached?: XMindTopic | XMindTopic[];
    detached?: XMindTopic | XMindTopic[];
    [key: string]: unknown;
  };
  style?: {
    properties?: Record<string, string | undefined>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type XMindRelationship = {
  id?: string;
  end1Id?: string;
  end2Id?: string;
  style?: {
    properties?: Record<string, string | undefined>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type XMindSheet = {
  id?: string;
  title?: string;
  rootTopic?: XMindTopic;
  root?: XMindTopic;
  relationships?: XMindRelationship[];
  [key: string]: unknown;
};

type XMindChildrenBucket = XMindTopic | XMindTopic[] | { topics?: XMindTopic | XMindTopic[] } | undefined;
type StyleProperties = Record<string, string | undefined>;

function parseXmindShape(shapeClass: string | undefined): NodeShape | undefined {
  const value = (shapeClass ?? "").toLowerCase();
  if (value.includes("roundedrect")) {
    return "rounded";
  }
  if (value.includes("capsule")) {
    return "capsule";
  }
  if (value.includes("circle")) {
    return "circle";
  }
  return undefined;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function asTopics(value: XMindChildrenBucket): XMindTopic[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && "topics" in value) {
    const topics = (value as { topics?: XMindTopic | XMindTopic[] }).topics;
    return asArray(topics);
  }

  return [value as XMindTopic];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  if (typeof value === "undefined") {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function parseJsonFile(raw: string | undefined): JsonValue | undefined {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return undefined;
  }
}

function asStyleProperties(value: unknown): StyleProperties | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const out: StyleProperties = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      out[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = String(raw);
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function extractHexColor(value: string): string | undefined {
  const withHash = value.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  if (withHash?.[0]) {
    return withHash[0].toUpperCase();
  }

  const with0x = value.match(/\b0x(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  if (with0x?.[0]) {
    const hex = with0x[0].slice(2);
    const rgb = hex.length === 8 ? hex.slice(2) : hex;
    return `#${rgb.toUpperCase()}`;
  }

  const nakedHex = value.match(/\b(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/);
  if (nakedHex?.[0]) {
    const rgb = nakedHex[0].length === 8 ? nakedHex[0].slice(2) : nakedHex[0];
    return `#${rgb.toUpperCase()}`;
  }

  return undefined;
}

function looksLikeCssFunctionColor(value: string): boolean {
  return /^(?:rgb|rgba|hsl|hsla|lab|lch|oklab|oklch|color)\s*\(/i.test(value.trim());
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

  const hexColor = extractHexColor(trimmed);
  if (hexColor) {
    return hexColor;
  }

  if (looksLikeCssFunctionColor(trimmed)) {
    return trimmed;
  }

  if (/^[a-z]{3,20}$/i.test(trimmed)) {
    return trimmed;
  }

  return undefined;
}

function normalizeXmindColorValue(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    return normalizeXmindColor(raw);
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const normalized = raw >>> 0;
    const hex = `#${(normalized & 0xffffff).toString(16).padStart(6, "0")}`.toUpperCase();
    return normalizeXmindColor(hex);
  }

  return undefined;
}

function readColorFromProperties(
  properties: StyleProperties | undefined,
  candidates: string[]
): string | undefined {
  if (!properties) {
    return undefined;
  }

  for (const key of candidates) {
    const color = normalizeXmindColorValue(properties[key]);
    if (color) {
      return color;
    }
  }

  return undefined;
}

function readFillColorFromProperties(properties: StyleProperties | undefined): string | undefined {
  return readColorFromProperties(properties, ["svg:fill", "fill-color", "shape-fill", "fill"]);
}

function readLineColorFromProperties(properties: StyleProperties | undefined): string | undefined {
  return readColorFromProperties(properties, ["line-color", "border-line-color", "stroke", "fo:color"]);
}

function collectStyleLookup(root: unknown): Map<string, StyleProperties> {
  const lookup = new Map<string, StyleProperties>();
  const visited = new Set<object>();

  const walk = (value: unknown) => {
    if (!isRecord(value) || visited.has(value)) {
      return;
    }
    visited.add(value);

    const id = typeof value.id === "string" ? value.id.trim() : "";
    const properties = asStyleProperties(value.properties);
    if (id && properties) {
      lookup.set(id, properties);
    }

    for (const nested of Object.values(value)) {
      if (Array.isArray(nested)) {
        for (const item of nested) {
          walk(item);
        }
      } else if (isRecord(nested)) {
        walk(nested);
      }
    }
  };

  walk(root);
  return lookup;
}

function readFillColorFromNestedObject(root: unknown): string | undefined {
  const visited = new Set<object>();
  const orderedMatches: { score: number; color: string }[] = [];

  const visit = (value: unknown, path: string[]) => {
    if (!isRecord(value) || visited.has(value)) {
      return;
    }

    visited.add(value);

    for (const [key, raw] of Object.entries(value)) {
      const nextPath = [...path, key.toLowerCase()];
      const pathText = nextPath.join(".");
      const pathHasFill = nextPath.some((part) => part.includes("fill") || part.includes("background"));
      const pathHasColor = nextPath.some((part) => part.includes("color") || part.includes("stroke") || part.includes("border"));

      const maybeColors: string[] = [];
      if (typeof raw === "string") {
        const direct = normalizeXmindColor(raw);
        if (direct) {
          maybeColors.push(direct);
        } else {
          const hex = extractHexColor(raw);
          if (hex) {
            maybeColors.push(hex);
          }
        }
      } else {
        const fromUnknown = normalizeXmindColorValue(raw);
        if (fromUnknown) {
          maybeColors.push(fromUnknown);
        }
      }

      if (maybeColors.length > 0) {
        const keyLooksColor = key.toLowerCase().includes("fill") || key.toLowerCase().includes("background") || key.toLowerCase().includes("color") || key.toLowerCase().includes("stroke");

        for (const color of maybeColors) {
          let score = 0;
          if (pathText.endsWith("svg:fill")) {
            score = 130;
          } else if (pathHasFill && key.toLowerCase() === "value") {
            score = 120;
          } else if (pathHasFill) {
            score = 110;
          } else if (keyLooksColor && pathHasColor) {
            score = 95;
          } else if (keyLooksColor) {
            score = 80;
          } else if (pathHasColor) {
            score = 65;
          }

          if (score > 0) {
            orderedMatches.push({ score, color });
          }
        }
      }

      if (Array.isArray(raw)) {
        for (const item of raw) {
          visit(item, nextPath);
        }
      } else if (isRecord(raw)) {
        visit(raw, nextPath);
      }
    }
  };

  visit(root, []);

  orderedMatches.sort((a, b) => b.score - a.score);
  return orderedMatches[0]?.color;
}

function readLineColorFromNestedObject(root: unknown): string | undefined {
  const visited = new Set<object>();
  const orderedMatches: { score: number; color: string }[] = [];

  const visit = (value: unknown, path: string[]) => {
    if (!isRecord(value) || visited.has(value)) {
      return;
    }

    visited.add(value);

    for (const [key, raw] of Object.entries(value)) {
      const nextPath = [...path, key.toLowerCase()];
      const keyLower = key.toLowerCase();
      const pathText = nextPath.join(".");
      const pathHasLine = nextPath.some((part) => part.includes("line") || part.includes("border") || part.includes("stroke") || part.includes("color"));

      const maybeColors: string[] = [];
      if (typeof raw === "string") {
        const direct = normalizeXmindColor(raw);
        if (direct) {
          maybeColors.push(direct);
        } else {
          const hex = extractHexColor(raw);
          if (hex) {
            maybeColors.push(hex);
          }
        }
      } else {
        const fromUnknown = normalizeXmindColorValue(raw);
        if (fromUnknown) {
          maybeColors.push(fromUnknown);
        }
      }

      if (maybeColors.length > 0) {
        for (const color of maybeColors) {
          let score = 0;
          if (keyLower === "line-color" || pathText.endsWith("line-color")) {
            score = 130;
          } else if (keyLower === "border-line-color" || pathText.endsWith("border-line-color")) {
            score = 120;
          } else if (keyLower.includes("stroke")) {
            score = 110;
          } else if (pathHasLine) {
            score = 70;
          }

          if (score > 0) {
            orderedMatches.push({ score, color });
          }
        }
      }

      if (Array.isArray(raw)) {
        for (const item of raw) {
          visit(item, nextPath);
        }
      } else if (isRecord(raw)) {
        visit(raw, nextPath);
      }
    }
  };

  visit(root, []);

  orderedMatches.sort((a, b) => b.score - a.score);
  return orderedMatches[0]?.color;
}

function resolveTopicFillColor(topic: XMindTopic, styleLookup: Map<string, StyleProperties>): string | undefined {
  const topicStyle = isRecord(topic.style) ? topic.style : undefined;
  const directColor = readFillColorFromProperties(asStyleProperties(topicStyle?.properties));
  if (directColor) {
    return directColor;
  }

  const rawTopic = topic as Record<string, unknown>;
  const styleIdCandidates = [
    typeof topic.style === "string" ? topic.style : undefined,
    typeof topicStyle?.id === "string" ? topicStyle.id : undefined,
    typeof rawTopic.styleId === "string" ? (rawTopic.styleId as string) : undefined,
  ]
    .map((id) => (id ?? "").trim())
    .filter(Boolean);

  for (const styleId of styleIdCandidates) {
    const color = readFillColorFromProperties(styleLookup.get(styleId));
    if (color) {
      return color;
    }
  }

  const extensionColor = readFillColorFromNestedObject((topic as Record<string, unknown>).extensions);
  if (extensionColor) {
    return extensionColor;
  }

  const fallbackFromTopic = readFillColorFromNestedObject(topic);
  if (fallbackFromTopic) {
    return fallbackFromTopic;
  }

  return undefined;
}

function resolveTopicLineColor(topic: XMindTopic, styleLookup: Map<string, StyleProperties>): string | undefined {
  const topicStyle = isRecord(topic.style) ? topic.style : undefined;
  const directColor = readLineColorFromProperties(asStyleProperties(topicStyle?.properties));
  if (directColor) {
    return directColor;
  }

  const rawTopic = topic as Record<string, unknown>;
  const styleIdCandidates = [
    typeof topic.style === "string" ? topic.style : undefined,
    typeof topicStyle?.id === "string" ? topicStyle.id : undefined,
    typeof rawTopic.styleId === "string" ? (rawTopic.styleId as string) : undefined,
  ]
    .map((id) => (id ?? "").trim())
    .filter(Boolean);

  for (const styleId of styleIdCandidates) {
    const color = readLineColorFromProperties(styleLookup.get(styleId));
    if (color) {
      return color;
    }
  }

  const extensionLineColor = readLineColorFromNestedObject((topic as Record<string, unknown>).extensions);
  if (extensionLineColor) {
    return extensionLineColor;
  }

  const fallbackFromTopic = readLineColorFromNestedObject(topic);
  if (fallbackFromTopic) {
    return fallbackFromTopic;
  }

  return undefined;
}

function safeTitle(value: string | undefined, fallback: string) {
  const trimmed = (value ?? "").trim();
  return trimmed || fallback;
}

function nextImportedId(counter: { value: number }) {
  counter.value += 1;
  return `xmind_${counter.value}`;
}

function nextImportedRelationshipId(counter: { value: number }) {
  counter.value += 1;
  return `xmind_rel_${counter.value}`;
}

function resolveTopicId(
  topic: XMindTopic,
  usedIds: Set<string>,
  counter: { value: number }
): string {
  const sourceId = typeof topic.id === "string" ? topic.id.trim() : "";
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

function parseLinePattern(raw: string | undefined): "solid" | "dashed" {
  return String(raw ?? "").toLowerCase().includes("dash") ? "dashed" : "solid";
}

function parseLineWidth(raw: string | undefined, fallback = 2): number {
  const numeric = Number(String(raw ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, numeric);
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

function buildImportedNodes(
  topic: XMindTopic,
  parentId: string | null,
  counter: { value: number },
  usedIds: Set<string>,
  sourceTopicToNodeId: Record<string, string>,
  styleLookup: Map<string, StyleProperties>
): { rootId: string; nodes: Record<string, MindMapNode> } {
  const id = resolveTopicId(topic, usedIds, counter);
  const sourceTopicId = typeof topic.id === "string" && topic.id.trim() ? topic.id.trim() : undefined;
  if (sourceTopicId) {
    sourceTopicToNodeId[sourceTopicId] = id;
  }

  const linePattern = topic.style?.properties?.["line-pattern"];
  const lineWidth = topic.style?.properties?.["line-width"];
  const lineColor = topic.style?.properties?.["line-color"];
  const hasExplicitParentEdgeStyle =
    typeof linePattern === "string" || typeof lineWidth === "string" || typeof lineColor === "string";
  const fillColor = resolveTopicFillColor(topic, styleLookup);
  const displayColor = fillColor ?? resolveTopicLineColor(topic, styleLookup);

  const node: MindMapNode = {
    id,
    parentId,
    title: safeTitle(topic.title, parentId ? "Imported topic" : "Imported map"),
    note: topic.notes?.plain?.content?.trim() || undefined,
    tags: topic.labels?.filter(Boolean)?.length ? topic.labels.filter(Boolean) : undefined,
    x: 0,
    y: 0,
    children: [],
    collapsed: topic.branch === "folded" ? true : undefined,
    color: displayColor,
    size: parentId ? 30 : 42,
    shape: parseXmindShape(topic.style?.properties?.["shape-class"]),
    edgeToParent: parentId && hasExplicitParentEdgeStyle
      ? {
          style: parseLinePattern(linePattern),
          width: parseLineWidth(lineWidth, 2),
          color: lineColor || undefined,
        }
      : undefined,
    vendor: {
      xmind: {
        topicId: sourceTopicId ?? id,
        rawTopic: cloneJson(topic) as JsonValue,
        importedFillColor: fillColor,
        importedDisplayColor: displayColor,
      },
    },
  };

  const nodes: Record<string, MindMapNode> = {
    [id]: node,
  };

  for (const child of asTopics(topic.children?.attached as XMindChildrenBucket)) {
    const parsedChild = buildImportedNodes(child, id, counter, usedIds, sourceTopicToNodeId, styleLookup);
    node.children.push(parsedChild.rootId);
    Object.assign(nodes, parsedChild.nodes);
  }

  for (const floatingChild of asTopics(topic.children?.detached as XMindChildrenBucket)) {
    const parsedFloating = buildImportedNodes(
      floatingChild,
      null,
      counter,
      usedIds,
      sourceTopicToNodeId,
      styleLookup
    );
    Object.assign(nodes, parsedFloating.nodes);
  }

  return { rootId: id, nodes };
}

function importRelationships(
  sheet: XMindSheet,
  nodes: Record<string, MindMapNode>,
  sourceTopicToNodeId: Record<string, string>
): { edges: RelationshipEdge[]; unmappedRelationships: JsonValue[] } {
  const edges: RelationshipEdge[] = [];
  const unmappedRelationships: JsonValue[] = [];
  const usedIds = new Set<string>();
  const counter = { value: 0 };
  const relationships = Array.isArray(sheet.relationships) ? sheet.relationships : [];

  for (const relationship of relationships) {
    const end1Id = typeof relationship.end1Id === "string" ? relationship.end1Id.trim() : "";
    const end2Id = typeof relationship.end2Id === "string" ? relationship.end2Id.trim() : "";

    const fromId = sourceTopicToNodeId[end1Id] ?? (nodes[end1Id] ? end1Id : "");
    const toId = sourceTopicToNodeId[end2Id] ?? (nodes[end2Id] ? end2Id : "");

    if (!fromId || !toId || fromId === toId) {
      unmappedRelationships.push(cloneJson(relationship) as JsonValue);
      continue;
    }

    const sourceRelationshipId =
      typeof relationship.id === "string" && relationship.id.trim()
        ? relationship.id.trim()
        : undefined;
    let edgeId = sourceRelationshipId ?? nextImportedRelationshipId(counter);
    while (usedIds.has(edgeId)) {
      edgeId = nextImportedRelationshipId(counter);
    }
    usedIds.add(edgeId);

    const style = relationship.style?.properties ?? {};

    const linePattern = style["line-pattern"];
    const lineWidth = style["line-width"];
    const lineColor = style["line-color"];

    edges.push({
      id: edgeId,
      fromId,
      toId,
      style: typeof linePattern === "string" ? parseLinePattern(linePattern) : undefined,
      width: typeof lineWidth === "string" ? parseLineWidth(lineWidth, 2) : undefined,
      color: typeof lineColor === "string" ? lineColor : undefined,
      vendor: {
        xmind: {
          relationshipId: sourceRelationshipId,
          rawRelationship: cloneJson(relationship) as JsonValue,
        },
      },
    });
  }

  return { edges, unmappedRelationships };
}

export async function importFromXmind(
  zipBase64: string,
  fallbackTitle = "Imported XMind map"
): Promise<MindMap> {
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const contentFile = zip.file("content.json");
  if (!contentFile) {
    throw new Error("Invalid .xmind file: content.json not found.");
  }

  const rawContent = await contentFile.async("string");
  const manifestRaw = await zip.file("manifest.json")?.async("string");
  const metadataRaw = await zip.file("metadata.json")?.async("string");
  const parsed = JSON.parse(rawContent) as unknown;

  let sheet: XMindSheet | undefined;
  let sheetIndex = 0;
  if (Array.isArray(parsed)) {
    sheet = parsed[0] as XMindSheet | undefined;
    sheetIndex = 0;
  } else if (isRecord(parsed) && Array.isArray(parsed.sheets)) {
    sheet = parsed.sheets[0] as XMindSheet | undefined;
    sheetIndex = 0;
  } else if (isRecord(parsed)) {
    sheet = parsed as XMindSheet;
    sheetIndex = 0;
  }

  const rootTopic = sheet?.rootTopic ?? sheet?.root;

  if (!rootTopic) {
    throw new Error("Invalid .xmind file: root topic not found.");
  }
  const activeSheet: XMindSheet = sheet ?? { rootTopic };

  const counter = { value: 0 };
  const usedIds = new Set<string>();
  const sourceTopicToNodeId: Record<string, string> = {};
  const styleLookup = collectStyleLookup(parsed);
  const parsedRoot = buildImportedNodes(
    rootTopic,
    null,
    counter,
    usedIds,
    sourceTopicToNodeId,
    styleLookup
  );
  const importedRelationships = importRelationships(
    activeSheet,
    parsedRoot.nodes,
    sourceTopicToNodeId
  );

  return layoutImportedMap({
    id: "imported",
    title: safeTitle(activeSheet.title ?? rootTopic.title, fallbackTitle),
    rootId: parsedRoot.rootId,
    nodes: parsedRoot.nodes,
    edges: importedRelationships.edges,
    importedFormat: {
      sourceFormat: "xmind",
      importedAt: new Date().toISOString(),
      preferredExportFormat: "xmind",
      raw: {
        rawJson: cloneJson(parsed as JsonValue),
      },
      vendor: {
        xmind: {
          rawContent: cloneJson(parsed as JsonValue),
          rawSheet: cloneJson(activeSheet as JsonValue),
          rawSheetIndex: sheetIndex,
          rawManifest: parseJsonFile(manifestRaw),
          rawMetadata: parseJsonFile(metadataRaw),
          unmappedRelationships:
            importedRelationships.unmappedRelationships.length > 0
              ? importedRelationships.unmappedRelationships
              : undefined,
        },
      },
    },
  });
}
