/**
 * Súbor: src/export/mm.ts
 * Abstrakt: Prevádza internú myšlienkovú mapu do XML formátu FreeMind.
 */
import { MindMap, MindMapNode } from "../types/map";
import { layoutStructuredMap } from "../screens/mapScreen/mapModel";

export function exportToMm(map: MindMap): string {
  const exportMap = layoutStructuredMap(map);
  if (!exportMap.nodes[exportMap.rootId]) {
    throw new Error("Root node not found");
  }

  const rawMapAttrs = exportMap.importedFormat?.vendor?.mm?.rawMapAttributes ?? {};
  const mapAttrs: Record<string, string> = { ...rawMapAttrs };
  if (!("version" in mapAttrs) && !("VERSION" in mapAttrs)) {
    mapAttrs.version = "1.0.1";
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<map ${serializeAttrs(mapAttrs)}>`);

  lines.push(serializeNode(exportMap, exportMap.rootId, 1, new Set()));

  lines.push("</map>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex2(n: number): string {
  return clampByte(n).toString(16).padStart(2, "0");
}

function parseColorToRgb(input: string): { r: number; g: number; b: number } | null {
  const s = (input || "").trim();

  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
      return null;
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
      return null;
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(2, 4), 16);
      const g = parseInt(hex.slice(4, 6), 16);
      const b = parseInt(hex.slice(6, 8), 16);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return { r, g, b };
      return null;
    }
    return null;
  }

  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    if ([r, g, b].every((v) => Number.isFinite(v))) return { r, g, b };
  }

  return null;
}

function normalizeToHex(color: string): string | null {
  const rgb = parseColorToRgb(color);
  if (!rgb) return null;
  return `#${toHex2(rgb.r)}${toHex2(rgb.g)}${toHex2(rgb.b)}`.toUpperCase();
}

function pickTextColorForBg(bgHex: string): string {
  const rgb = parseColorToRgb(bgHex);
  if (!rgb) return "#111827";
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  return L < 0.5 ? "#FFFFFF" : "#111827";
}

function serializeAttrs(attrs: Record<string, string | undefined>): string {
  return Object.entries(attrs)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `${key}="${escapeXml(value ?? "")}"`)
    .join(" ");
}

function hasImportedPositionChanged(node: MindMapNode): boolean {
  const importedPosition = node.vendor?.mm?.importedPosition;
  if (!importedPosition) {
    return true;
  }

  return Math.abs(node.x - importedPosition.x) > 0.5 || Math.abs(node.y - importedPosition.y) > 0.5;
}

function applyManagedFreeMindPosition(
  map: MindMap,
  node: MindMapNode,
  attrs: Record<string, string | undefined>
) {
  if (!node.parentId) {
    return;
  }

  const parent = map.nodes[node.parentId];
  if (!parent || !hasImportedPositionChanged(node)) {
    return;
  }

  const dx = node.x - parent.x;

  if (parent.id === map.rootId) {
    attrs.POSITION = dx < 0 ? "left" : "right";
  } else if (!node.vendor?.mm?.rawAttributes?.POSITION) {
    delete attrs.POSITION;
  }

  delete attrs.HGAP;
  delete attrs.VSHIFT;
}

function buildNodeAttrs(map: MindMap, node: MindMapNode): string {
  const rawAttrs = node.vendor?.mm?.rawAttributes ?? {};
  const primaryAttachment = node.attachments?.[0];
  const attrs: Record<string, string | undefined> = {
    ...rawAttrs,
    TEXT: node.title ?? "",
    ID: node.id,
  };

  if (primaryAttachment?.uri) {
    attrs.LINK = primaryAttachment.uri;
  } else if (!rawAttrs.LINK) {
    delete attrs.LINK;
  }

  applyManagedFreeMindPosition(map, node, attrs);

  if (node.collapsed === true) {
    attrs.FOLDED = "true";
  } else if (node.collapsed === false) {
    delete attrs.FOLDED;
  }

  if (typeof node.color !== "undefined") {
    const bg = normalizeToHex(node.color) ?? node.color;
    attrs.BACKGROUND_COLOR = bg;
    const textColor = pickTextColorForBg(bg);
    attrs.COLOR = textColor;
  }

  if (node.shape === "rounded") {
    attrs.STYLE = "bubble";
  } else if (node.shape === "capsule") {
    attrs.STYLE = "fork";
  } else if (!rawAttrs.STYLE) {
    delete attrs.STYLE;
  }

  return serializeAttrs(attrs);
}

function buildParentEdgeAttrs(node: MindMapNode): string | null {
  if (!node.parentId) {
    return null;
  }

  const rawEdgeAttrs = node.vendor?.mm?.rawEdgeAttributes ?? {};
  const attrs: Record<string, string | undefined> = {
    ...rawEdgeAttrs,
  };

  if (node.edgeToParent) {
    attrs.STYLE = node.edgeToParent.style === "dashed" ? "bezier" : "linear";
    attrs.WIDTH = `${Math.max(1, node.edgeToParent.width ?? 2)}`;
    if (typeof node.edgeToParent.color !== "undefined") {
      attrs.COLOR = normalizeToHex(node.edgeToParent.color) ?? node.edgeToParent.color;
    }
  }

  const serialized = serializeAttrs(attrs);
  return serialized ? serialized : null;
}

function buildArrowLinkAttrs(
  map: MindMap,
  node: MindMapNode
): Record<string, string | undefined>[] {
  const outgoing = map.edges.filter(
    (edge) => edge.fromId === node.id && edge.toId !== node.id && !!map.nodes[edge.toId]
  );

  return outgoing.map((edge) => {
    const rawArrowAttrs = edge.vendor?.mm?.rawArrowlinkAttributes ?? {};
    const attrs: Record<string, string | undefined> = {
      ...rawArrowAttrs,
      ID: rawArrowAttrs.ID || edge.id,
      DESTINATION: edge.toId,
    };

    if (edge.style) {
      attrs.STYLE = edge.style === "dashed" ? "bezier" : "linear";
    } else if (!rawArrowAttrs.STYLE) {
      delete attrs.STYLE;
    }

    if (edge.width && Number.isFinite(edge.width)) {
      attrs.WIDTH = `${Math.max(1, edge.width)}`;
    } else if (!rawArrowAttrs.WIDTH) {
      delete attrs.WIDTH;
    }

    if (edge.color) {
      attrs.COLOR = normalizeToHex(edge.color) ?? edge.color;
    } else if (!rawArrowAttrs.COLOR) {
      delete attrs.COLOR;
    }

    return attrs;
  });
}

function serializeRichContent(indent: string, note: string): string {
  const escaped = escapeXml(note).replace(/\n/g, "<br/>");
  return [
    `${indent}<richcontent TYPE="NOTE">`,
    `${indent}  <html>`,
    `${indent}    <body>${escaped}</body>`,
    `${indent}  </html>`,
    `${indent}</richcontent>`,
  ].join("\n");
}

function serializeAttributes(indent: string, tags: string[]): string[] {
  if (tags.length === 0) {
    return [];
  }

  return tags.map((tag) => `${indent}<attribute NAME="tag" VALUE="${escapeXml(tag)}" />`);
}

function serializeNode(
  map: MindMap,
  nodeId: string,
  depth: number,
  visited: Set<string>
): string {
  const node = map.nodes[nodeId];
  if (!node) return "";

  if (visited.has(nodeId)) return "";
  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  const indent = "  ".repeat(depth);
  const attrs = buildNodeAttrs(map, node);
  const parentEdgeAttrs = buildParentEdgeAttrs(node);
  const arrowLinks = buildArrowLinkAttrs(map, node);
  const rawChildElements = node.vendor?.mm?.rawChildElements ?? [];

  const detachedFromRoot =
    node.id === map.rootId
      ? Object.values(map.nodes)
          .filter((candidate) => candidate.parentId === null && candidate.id !== map.rootId)
          .map((candidate) => candidate.id)
      : [];
  const children = [...(node.children ?? []), ...detachedFromRoot]
    .filter((cid, index, arr) => arr.indexOf(cid) === index)
    .filter((cid) => !!map.nodes[cid]);
  const hasNote = !!node.note?.trim();
  const tags = node.tags?.filter(Boolean) ?? [];
  const hasExtraContent =
    hasNote ||
    tags.length > 0 ||
    !!parentEdgeAttrs ||
    arrowLinks.length > 0 ||
    rawChildElements.length > 0;

  if (children.length === 0 && !hasExtraContent) {
    return `${indent}<node ${attrs} />`;
  }

  const lines: string[] = [];
  lines.push(`${indent}<node ${attrs}>`);

  if (parentEdgeAttrs) {
    lines.push(`${indent}  <edge ${parentEdgeAttrs} />`);
  }

  if (hasNote) {
    lines.push(serializeRichContent(`${indent}  `, node.note!.trim()));
  }

  lines.push(...serializeAttributes(`${indent}  `, tags));
  lines.push(
    ...arrowLinks.map((arrowAttrs) => `${indent}  <arrowlink ${serializeAttrs(arrowAttrs)} />`)
  );
  lines.push(...rawChildElements.map((rawXml) => `${indent}  ${rawXml}`));

  for (const cid of children) {
    lines.push(serializeNode(map, cid, depth + 1, nextVisited));
  }

  lines.push(`${indent}</node>`);
  return lines.join("\n");
}
