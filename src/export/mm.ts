import { MindMap, MindMapNode } from "../types/map";

export function exportToMm(map: MindMap): string {
  if (!map.nodes[map.rootId]) {
    throw new Error("Root node not found");
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<map version="1.0.1">');

  lines.push(serializeNode(map, map.rootId, 1, new Set()));

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


function buildNodeAttrs(node: MindMapNode): string {
  const text = escapeXml(node.title ?? "");
  const id = escapeXml(node.id);

  const attrs: string[] = [];
  attrs.push(`TEXT="${text}"`);
  attrs.push(`ID="${id}"`);

  if (node.color) {
    const bg = normalizeToHex(node.color) ?? node.color;
    attrs.push(`BACKGROUND_COLOR="${escapeXml(bg)}"`);
    const textColor = pickTextColorForBg(bg);
    attrs.push(`COLOR="${escapeXml(textColor)}"`);
  }

  return attrs.join(" ");
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
  const attrs = buildNodeAttrs(node);

  const children = (node.children ?? []).filter((cid) => !!map.nodes[cid]);

  if (children.length === 0) {
    return `${indent}<node ${attrs} />`;
  }

  const lines: string[] = [];
  lines.push(`${indent}<node ${attrs}>`);

  for (const cid of children) {
    lines.push(serializeNode(map, cid, depth + 1, nextVisited));
  }

  lines.push(`${indent}</node>`);
  return lines.join("\n");
}