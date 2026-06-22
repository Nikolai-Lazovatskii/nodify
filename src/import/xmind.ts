/**
 * Súbor: src/import/xmind.ts
 * Abstrakt: Parsuje formát XMind a prevádza jeho obsah na internú myšlienkovú mapu.
 */
import JSZip from "jszip";

import { JsonValue, MindMap, MindMapNode, NodeAttachment, NodeShape, RelationshipEdge } from "../types/map";

type XMindTopic = {
  id?: string;
  title?: string;
  href?: string;
  hyperlink?: string;
  url?: string;
  link?: string;
  labels?: string[];
  branch?: string;
  styleId?: string;
  notes?: {
    plain?: {
      content?: string;
    };
  };
  relationship?: unknown;
  topics?: XMindTopic | XMindTopic[];
  children?: {
    attached?: XMindChildrenBucket;
    detached?: XMindChildrenBucket;
    [key: string]: unknown;
  };
  style?: {
    properties?: Record<string, string | undefined>;
    [key: string]: unknown;
  };
  extensions?: unknown;
  nodify?: unknown;
  position?: unknown;
  location?: unknown;
  offset?: unknown;
  coordinates?: unknown;
  x?: unknown;
  X?: unknown;
  left?: unknown;
  y?: unknown;
  Y?: unknown;
  top?: unknown;
  image?: unknown;
  images?: unknown;
  img?: unknown;
  "xhtml:img"?: unknown;
  "svg:image"?: unknown;
  "image-src"?: string;
  imageSrc?: string;
  imageUrl?: string;
  "image-url"?: string;
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

type XMindChildrenBucket = XMindTopic | XMindTopic[] | undefined;
type StyleProperties = Record<string, string | undefined>;

type XMindImageResolver = (topic: XMindTopic, nodeId: string) => Promise<NodeAttachment | undefined>;
type XMindHrefResolver = (topic: XMindTopic, nodeId: string) => Promise<NodeAttachment | undefined>;

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

  if (value.topics) {
    return asArray(value.topics);
  }

  return [value];
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
        const keyLooksColor =
          key.toLowerCase().includes("fill") ||
          key.toLowerCase().includes("background") ||
          key.toLowerCase().includes("color") ||
          key.toLowerCase().includes("stroke");

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
      const pathHasLine = nextPath.some(
        (part) =>
          part.includes("line") ||
          part.includes("border") ||
          part.includes("stroke") ||
          part.includes("color")
      );

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

  const styleIdCandidates = [
    typeof topic.style === "string" ? topic.style : undefined,
    typeof topicStyle?.id === "string" ? topicStyle.id : undefined,
    typeof topic.styleId === "string" ? topic.styleId : undefined,
  ]
    .map((id) => (id ?? "").trim())
    .filter(Boolean);

  for (const styleId of styleIdCandidates) {
    const color = readFillColorFromProperties(styleLookup.get(styleId));
    if (color) {
      return color;
    }
  }

  const extensionColor = readFillColorFromNestedObject(topic.extensions);
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

  const styleIdCandidates = [
    typeof topic.style === "string" ? topic.style : undefined,
    typeof topicStyle?.id === "string" ? topicStyle.id : undefined,
    typeof topic.styleId === "string" ? topic.styleId : undefined,
  ]
    .map((id) => (id ?? "").trim())
    .filter(Boolean);

  for (const styleId of styleIdCandidates) {
    const color = readLineColorFromProperties(styleLookup.get(styleId));
    if (color) {
      return color;
    }
  }

  const extensionLineColor = readLineColorFromNestedObject(topic.extensions);
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

function parsePositionNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const numeric = Number(raw.replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function readTopicPosition(topic: XMindTopic): { x: number; y: number } | undefined {
  const candidates = [
    topic.position,
    topic.location,
    topic.offset,
    topic.coordinates,
  ];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const x =
      parsePositionNumber(candidate.x) ??
      parsePositionNumber(candidate.X) ??
      parsePositionNumber(candidate.left);
    const y =
      parsePositionNumber(candidate.y) ??
      parsePositionNumber(candidate.Y) ??
      parsePositionNumber(candidate.top);

    if (typeof x === "number" && typeof y === "number") {
      return { x, y };
    }
  }

  const x =
    parsePositionNumber(topic.x) ??
    parsePositionNumber(topic.X) ??
    parsePositionNumber(topic.left);
  const y =
    parsePositionNumber(topic.y) ??
    parsePositionNumber(topic.Y) ??
    parsePositionNumber(topic.top);

  if (typeof x === "number" && typeof y === "number") {
    return { x, y };
  }

  return undefined;
}

function getFileNameFromPath(path: string) {
  const clean = path.split(/[?#]/)[0];
  const parts = clean.split("/");
  return decodeURIComponent(parts[parts.length - 1] || "image");
}

function mimeFromPath(path: string, fallback = "application/octet-stream") {
  const lower = path.toLowerCase().split(/[?#]/)[0];
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return fallback;
}

function mimeFromDataUri(uri: string) {
  const match = uri.match(/^data:([^;,]+)[;,]/i);
  return match?.[1];
}

function normalizeXmindResourcePath(src: string) {
  const trimmed = src.trim();
  if (!trimmed) {
    return "";
  }

  return decodeURIComponent(
    trimmed
      .replace(/^xap:/i, "")
      .replace(/^file:\/\//i, "")
      .replace(/^\/+/, "")
  );
}

function extractStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function readTopicImageSource(topic: XMindTopic): string | undefined {
  const candidates = [
    topic.image,
    topic.images,
    topic.img,
    topic["xhtml:img"],
    topic["svg:image"],
  ];

  for (const candidate of candidates) {
    const item = Array.isArray(candidate) ? candidate[0] : candidate;
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
    if (isRecord(item)) {
      const src = extractStringField(item, [
        "src",
        "href",
        "url",
        "path",
        "resource",
        "source",
        "xlink:href",
      ]);
      if (src) {
        return src;
      }
    }
  }

  const src = extractStringField(topic, [
    "image-src",
    "imageSrc",
    "imageUrl",
    "image-url",
  ]);
  return src;
}

function findZipResource(zip: JSZip, src: string) {
  const normalized = normalizeXmindResourcePath(src);
  if (!normalized) {
    return null;
  }

  const candidates = [
    normalized,
    normalized.replace(/^resources\//i, "Resources/"),
    normalized.replace(/^Resources\//, "resources/"),
    `resources/${normalized}`,
    `Resources/${normalized}`,
    `attachments/${normalized}`,
    `Attachments/${normalized}`,
  ];

  for (const candidate of candidates) {
    const file = zip.file(candidate);
    if (file) {
      return { file, path: candidate };
    }
  }

  const basename = getFileNameFromPath(normalized).toLowerCase();
  if (!basename) {
    return null;
  }

  const fallback = zip
    .file(/.*/)
    .find((file) => !file.dir && getFileNameFromPath(file.name).toLowerCase() === basename);
  return fallback ? { file: fallback, path: fallback.name } : null;
}

async function resolveZipAttachmentUri(zip: JSZip, uri: string) {
  if (/^data:/i.test(uri)) {
    return {
      uri,
      mimeType: mimeFromDataUri(uri) ?? mimeFromPath(uri),
      path: "",
    };
  }

  const resource = findZipResource(zip, uri);
  if (!resource) {
    return null;
  }

  const base64 = await resource.file.async("base64");
  const mimeType = mimeFromPath(resource.path);
  return {
    uri: `data:${mimeType};base64,${base64}`,
    mimeType,
    path: resource.path,
  };
}

function createXmindImageResolver(zip: JSZip): XMindImageResolver {
  return async (topic, nodeId) => {
    const src = readTopicImageSource(topic);
    if (!src) {
      return undefined;
    }

    if (/^https?:\/\//i.test(src) || /^data:image\//i.test(src)) {
      return {
        id: `xmind_image_${nodeId}`,
        name: getFileNameFromPath(src) || "XMind image",
        uri: src,
        mimeType: /^data:image\//i.test(src)
          ? mimeFromDataUri(src)
          : mimeFromPath(src, "image/png"),
      };
    }

    const resource = findZipResource(zip, src);
    if (!resource) {
      return undefined;
    }

    const base64 = await resource.file.async("base64");
    const mimeType = mimeFromPath(resource.path, "image/png");
    return {
      id: `xmind_image_${nodeId}`,
      name: getFileNameFromPath(resource.path) || "XMind image",
      uri: `data:${mimeType};base64,${base64}`,
      mimeType,
    };
  };
}

async function resolveImportedAttachment(zip: JSZip, attachment: NodeAttachment): Promise<NodeAttachment> {
  const uri = attachment.uri.trim();
  if (/^https?:\/\//i.test(uri)) {
    return attachment;
  }

  const resolved = await resolveZipAttachmentUri(zip, uri);
  if (!resolved) {
    return attachment;
  }

  return {
    ...attachment,
    uri: resolved.uri,
    mimeType: attachment.mimeType ?? resolved.mimeType,
  };
}

function normalizeImportedAttachment(value: unknown): NodeAttachment | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const uri = typeof value.uri === "string" ? value.uri.trim() : "";
  if (!id || !name || !uri) {
    return null;
  }

  return {
    id,
    name,
    uri,
    mimeType: typeof value.mimeType === "string" && value.mimeType.trim() ? value.mimeType.trim() : undefined,
    size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : undefined,
  };
}

function createXmindHrefResolver(zip: JSZip): XMindHrefResolver {
  return async (topic, nodeId) => {
    const href = extractStringField(topic, ["href", "hyperlink", "url", "link"]);
    if (!href) {
      return undefined;
    }

    if (/^https?:\/\//i.test(href)) {
      return {
        id: `xmind_href_${nodeId}`,
        name: getFileNameFromPath(href) || "XMind link",
        uri: href,
      };
    }

    const resolved = await resolveZipAttachmentUri(zip, href);
    if (resolved) {
      return {
        id: `xmind_href_${nodeId}`,
        name: getFileNameFromPath(resolved.path || href) || "XMind attachment",
        uri: resolved.uri,
        mimeType: resolved.mimeType,
      };
    }

    return {
      id: `xmind_href_${nodeId}`,
      name: getFileNameFromPath(href) || "XMind link",
      uri: href,
      mimeType: mimeFromPath(href),
    };
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

function readNodifyTopicExtension(topic: XMindTopic): {
  dueAt?: string;
  attachments?: NodeAttachment[];
} {
  const extensions = isRecord(topic.extensions) ? topic.extensions : undefined;
  const extension = isRecord(extensions?.nodify)
    ? extensions.nodify
    : isRecord(topic.nodify)
      ? topic.nodify
      : undefined;

  if (!extension) {
    return {};
  }

  const dueAt =
    typeof extension.dueAt === "string" && extension.dueAt.trim() && !Number.isNaN(Date.parse(extension.dueAt))
      ? extension.dueAt.trim()
      : undefined;
  const attachments = Array.isArray(extension.attachments)
    ? extension.attachments
        .map(normalizeImportedAttachment)
        .filter((attachment): attachment is NodeAttachment => !!attachment)
    : undefined;

  return {
    dueAt,
    attachments: attachments?.length ? attachments : undefined,
  };
}

type NodifyXmindMetadata = Record<string, {
  dueAt?: string;
  attachments?: NodeAttachment[];
}>;

const EXPORTED_DUE_LINE_PATTERN = /^Due:\s+\d{1,2}\.\d{1,2}\.\d{4}\s+\d{2}:\d{2}$/;

function stripExportedMetadataFromNote(note: string | undefined) {
  if (!note) {
    return undefined;
  }

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

  const nextNote = cleaned.join("\n").trim();
  return nextNote || undefined;
}

function parseNodifyXmindMetadata(raw: string | undefined): NodifyXmindMetadata {
  if (!raw) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const root = isRecord(parsed) ? parsed : undefined;
  const rawNodes = isRecord(root?.nodes) ? root.nodes : undefined;
  if (!rawNodes) {
    return {};
  }

  const metadata: NodifyXmindMetadata = {};
  for (const [sourceId, rawNode] of Object.entries(rawNodes)) {
    if (!sourceId.trim() || !isRecord(rawNode)) {
      continue;
    }

    const dueAt =
      typeof rawNode.dueAt === "string" && rawNode.dueAt.trim() && !Number.isNaN(Date.parse(rawNode.dueAt))
        ? rawNode.dueAt.trim()
        : undefined;
    const attachments = Array.isArray(rawNode.attachments)
      ? rawNode.attachments
          .map(normalizeImportedAttachment)
          .filter((attachment): attachment is NodeAttachment => !!attachment)
      : undefined;

    if (dueAt || attachments?.length) {
      metadata[sourceId.trim()] = {
        dueAt,
        attachments: attachments?.length ? attachments : undefined,
      };
    }
  }

  return metadata;
}

async function applyNodifyXmindMetadata(
  nodes: Record<string, MindMapNode>,
  sourceTopicToNodeId: Record<string, string>,
  metadata: NodifyXmindMetadata,
  zip: JSZip
): Promise<Record<string, MindMapNode>> {
  if (Object.keys(metadata).length === 0) {
    return nodes;
  }

  const nextNodes = { ...nodes };

  for (const [sourceId, nodeMetadata] of Object.entries(metadata)) {
    const nodeId = sourceTopicToNodeId[sourceId] ?? sourceId;
    const node = nextNodes[nodeId];
    if (!node) {
      continue;
    }

    const metadataAttachments = await Promise.all(
      (nodeMetadata.attachments ?? []).map((attachment) => resolveImportedAttachment(zip, attachment))
    );
    const attachments = mergeImportedAttachments([
      ...metadataAttachments,
      ...(node.attachments ?? []),
    ]);

    nextNodes[nodeId] = {
      ...node,
      note: nodeMetadata.dueAt || metadataAttachments.length > 0
        ? stripExportedMetadataFromNote(node.note)
        : node.note,
      dueAt: nodeMetadata.dueAt ?? node.dueAt,
      attachments: attachments.length > 0 ? attachments : node.attachments,
    };
  }

  return nextNodes;
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

  const rawTopic = node.vendor?.xmind?.rawTopic;
  if (isRecord(rawTopic)) {
    const importedPosition = readTopicPosition(rawTopic);
    if (importedPosition) {
      node.x = importedPosition.x;
      node.y = importedPosition.y;
      return estimateImportedSubtreeHeight(nodeId, nodes, heightCache);
    }
  }

  const branchHeight = estimateImportedSubtreeHeight(nodeId, nodes, heightCache);
  const xGap = Math.max(190, estimateImportedNodeWidth(node) + 76);
  node.x = parentX + sign * xGap;
  node.y = centerY;

  if (node.children.length === 0 || node.collapsed) {
    return branchHeight;
  }

  let cursorY = node.y - branchHeight / 2;
  for (const childId of node.children) {
    const childHeight = estimateImportedSubtreeHeight(childId, nodes, heightCache);
    layoutSubtree(childId, nodes, sign, depth + 1, cursorY + childHeight / 2, heightCache, node.x);
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
    if (index % 2 === 0) {
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
    const rawTopic = node.vendor?.xmind?.rawTopic;
    const importedPosition = isRecord(rawTopic) ? readTopicPosition(rawTopic) : undefined;
    if (importedPosition) {
      node.x = importedPosition.x;
      node.y = importedPosition.y;
      return;
    }

    node.x = (index - (floatingNodes.length - 1) / 2) * 260;
    node.y = -260;
  });

  return map;
}

function preserveImportedPositions(map: MindMap): MindMap {
  for (const node of Object.values(map.nodes)) {
    node.vendor = {
      ...node.vendor,
      xmind: {
        ...node.vendor?.xmind,
        importedPosition: {
          x: node.x,
          y: node.y,
        },
      },
    };
  }

  return map;
}

async function buildImportedNodes(
  topic: XMindTopic,
  parentId: string | null,
  counter: { value: number },
  usedIds: Set<string>,
  sourceTopicToNodeId: Record<string, string>,
  styleLookup: Map<string, StyleProperties>,
  resolveImageAttachment: XMindImageResolver,
  resolveHrefAttachment: XMindHrefResolver
): Promise<{ rootId: string; nodes: Record<string, MindMapNode> }> {
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
  const imageAttachment = await resolveImageAttachment(topic, id);
  const hrefAttachment = await resolveHrefAttachment(topic, id);
  const nodifyExtension = readNodifyTopicExtension(topic);
  const attachments = mergeImportedAttachments([
    ...(nodifyExtension.attachments ?? []),
    imageAttachment,
    hrefAttachment,
  ]);

  const node: MindMapNode = {
    id,
    parentId,
    title: safeTitle(topic.title, parentId ? "Imported topic" : "Imported map"),
    note: topic.notes?.plain?.content?.trim() || undefined,
    tags: topic.labels?.filter(Boolean)?.length ? topic.labels.filter(Boolean) : undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    dueAt: nodifyExtension.dueAt,
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
        importedPosition: readTopicPosition(topic),
      },
    },
  };

  const nodes: Record<string, MindMapNode> = {
    [id]: node,
  };

  for (const child of asTopics(topic.children?.attached)) {
    const parsedChild = await buildImportedNodes(
      child,
      id,
      counter,
      usedIds,
      sourceTopicToNodeId,
      styleLookup,
      resolveImageAttachment,
      resolveHrefAttachment
    );
    node.children.push(parsedChild.rootId);
    Object.assign(nodes, parsedChild.nodes);
  }

  for (const floatingChild of asTopics(topic.children?.detached)) {
    const parsedFloating = await buildImportedNodes(
      floatingChild,
      null,
      counter,
      usedIds,
      sourceTopicToNodeId,
      styleLookup,
      resolveImageAttachment,
      resolveHrefAttachment
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
  const nodifyMetadataRaw = await zip.file("nodify-metadata.json")?.async("string");
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
  const resolveImageAttachment = createXmindImageResolver(zip);
  const resolveHrefAttachment = createXmindHrefResolver(zip);
  const parsedRoot = await buildImportedNodes(
    rootTopic,
    null,
    counter,
    usedIds,
    sourceTopicToNodeId,
    styleLookup,
    resolveImageAttachment,
    resolveHrefAttachment
  );
  const importedRelationships = importRelationships(
    activeSheet,
    parsedRoot.nodes,
    sourceTopicToNodeId
  );
  const nodes = await applyNodifyXmindMetadata(
    parsedRoot.nodes,
    sourceTopicToNodeId,
    parseNodifyXmindMetadata(nodifyMetadataRaw),
    zip
  );

  return preserveImportedPositions(layoutImportedMap({
    id: "imported",
    title: safeTitle(activeSheet.title ?? rootTopic.title, fallbackTitle),
    rootId: parsedRoot.rootId,
    nodes,
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
  }));
}
