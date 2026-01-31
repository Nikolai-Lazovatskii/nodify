import { MindMap } from "../types/map";
import templateContent from "./templates/content.json";

function escapeText(s: string) {
  return (s ?? "").toString();
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function getTemplateSheet(content: any) {
  if (Array.isArray(content) && content.length > 0) return content[0];
  if (content && Array.isArray(content.sheets) && content.sheets.length > 0) return content.sheets[0];
  throw new Error("Unsupported template content.json structure");
}

function getTemplateRootTopic(sheet: any) {
  if (sheet?.rootTopic) return sheet.rootTopic;
  if (sheet?.root) return sheet.root;
  throw new Error("Template sheet has no rootTopic");
}

function buildTopic(map: MindMap, nodeId: string, visited: Set<string>): any {
  const node = map.nodes[nodeId];
  if (!node) return null;
  if (visited.has(nodeId)) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  const childrenIds = (node.children ?? []).filter((cid) => !!map.nodes[cid]);
  const attached = childrenIds
    .map((cid) => buildTopic(map, cid, nextVisited))
    .filter(Boolean);

  const topic: any = {
    id: node.id,
    title: escapeText(node.title),
  };

  if (attached.length > 0) {
    topic.children = { attached };
  }

  return topic;
}

export function exportToXmindZenContentJson(map: MindMap): string {
  if (!map.nodes[map.rootId]) throw new Error("Root node not found");

  const content = clone(templateContent);
  const sheet = getTemplateSheet(content);
  const templateRoot = getTemplateRootTopic(sheet);

  const rootTopic = buildTopic(map, map.rootId, new Set());
  if (!rootTopic) throw new Error("Failed to build root topic");

  sheet.title = escapeText(map.title || "Untitled");
  // сохраняем поля из templateRoot (class, titleUnedited, theme/extensions и т.д.)
  sheet.rootTopic = { ...clone(templateRoot), ...rootTopic };

  return JSON.stringify(content, null, 2);
}