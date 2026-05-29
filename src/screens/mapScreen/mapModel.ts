/**
 * Súbor: src/screens/mapScreen/mapModel.ts
 * Abstrakt: Obsahuje operácie nad dátovým modelom mapy, uzlami a vzťahmi.
 */
import { MindMap, MindMapNode, NodeAttachment, RelationshipEdge } from "@/src/types/map";
import { estimateNodeHalfBounds } from "./routing";

const STRUCTURED_LEVEL_GAP = 230;
const STRUCTURED_SIBLING_GAP = 34;
const STRUCTURED_ROOT_BRANCH_GAP = 48;

export function defaultTranslate(key: string) {
  const fallback: Record<string, string> = {
    "common.untitled": "Untitled",
    "map.sampleMap": "Sample Map",
    "map.root": "Root",
    "map.research": "Research",
    "map.design": "Design",
    "map.exportNode": "Export",
  };

  return fallback[key] ?? key;
}

export function normalizeMap(map?: MindMap, t: (key: string) => string = defaultTranslate): MindMap {
  if (!map) {
    return {
      id: "map1",
      title: t("map.sampleMap"),
      rootId: "root",
      edges: [],
      nodes: {
        root: {
          id: "root",
          parentId: null,
          title: t("map.root"),
          x: 0,
          y: 0,
          children: ["c1", "c2", "c3"],
          size: 42,
          shape: "circle",
        },
        c1: {
          id: "c1",
          parentId: "root",
          title: t("map.research"),
          x: -140,
          y: 120,
          children: [],
          size: 30,
          shape: "circle",
          edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
        },
        c2: {
          id: "c2",
          parentId: "root",
          title: t("map.design"),
          x: 0,
          y: 140,
          children: [],
          size: 30,
          shape: "circle",
          edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
        },
        c3: {
          id: "c3",
          parentId: "root",
          title: t("map.exportNode"),
          x: 140,
          y: 120,
          children: [],
          size: 30,
          shape: "circle",
          edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
        },
      },
    };
  }

  const rawNodes = map && typeof map.nodes === "object" && map.nodes ? map.nodes : {};
  const normalizedNodes: Record<string, MindMapNode> = {};

  for (const [nodeId, rawNode] of Object.entries(rawNodes)) {
    if (!rawNode || typeof rawNode !== "object") {
      continue;
    }

    const safeId = typeof rawNode.id === "string" && rawNode.id.trim() ? rawNode.id : nodeId;
    const safeChildren = Array.isArray(rawNode.children)
      ? rawNode.children.filter((childId): childId is string => typeof childId === "string" && childId !== safeId)
      : [];
    const safeTags = Array.isArray(rawNode.tags)
      ? rawNode.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
      : undefined;
    const safeAttachments = Array.isArray(rawNode.attachments)
      ? rawNode.attachments
          .filter(
            (attachment): attachment is NodeAttachment =>
              !!attachment &&
              typeof attachment === "object" &&
              typeof attachment.id === "string" &&
              typeof attachment.name === "string" &&
              typeof attachment.uri === "string" &&
              attachment.name.trim().length > 0 &&
              attachment.uri.trim().length > 0
          )
          .map((attachment) => ({
            id: attachment.id,
            name: attachment.name.trim(),
            uri: attachment.uri.trim(),
            mimeType:
              typeof attachment.mimeType === "string" && attachment.mimeType.trim()
                ? attachment.mimeType.trim()
                : undefined,
            size: Number.isFinite(attachment.size) ? attachment.size : undefined,
          }))
      : undefined;
    const safeX = Number.isFinite(rawNode.x) ? rawNode.x : 0;
    const safeY = Number.isFinite(rawNode.y) ? rawNode.y : 0;
    const safeSize = Number.isFinite(rawNode.size) ? rawNode.size : undefined;
    const safeVendor =
      rawNode.vendor && typeof rawNode.vendor === "object" ? rawNode.vendor : undefined;
    const safeShape =
      rawNode.shape === "circle" || rawNode.shape === "rounded" || rawNode.shape === "capsule"
        ? rawNode.shape
        : undefined;

    normalizedNodes[safeId] = {
      id: safeId,
      parentId: typeof rawNode.parentId === "string" ? rawNode.parentId : null,
      title: typeof rawNode.title === "string" && rawNode.title.trim() ? rawNode.title : t("common.untitled"),
      note: typeof rawNode.note === "string" && rawNode.note.trim() ? rawNode.note : undefined,
      tags: safeTags?.length ? safeTags : undefined,
      attachments: safeAttachments?.length ? safeAttachments : undefined,
      dueAt:
        typeof rawNode.dueAt === "string" && rawNode.dueAt.trim() && !Number.isNaN(Date.parse(rawNode.dueAt))
          ? rawNode.dueAt
          : undefined,
      x: safeX,
      y: safeY,
      children: safeChildren,
      collapsed: rawNode.collapsed ? true : undefined,
      color: typeof rawNode.color === "string" && rawNode.color.trim() ? rawNode.color : undefined,
      size: safeSize,
      shape: safeShape,
      vendor: safeVendor,
      edgeToParent: rawNode.edgeToParent
        ? {
            style: rawNode.edgeToParent.style === "dashed" ? "dashed" : "solid",
            width: Number.isFinite(rawNode.edgeToParent.width) ? rawNode.edgeToParent.width : 2,
            color:
              typeof rawNode.edgeToParent.color === "string" && rawNode.edgeToParent.color.trim()
                ? rawNode.edgeToParent.color
                : undefined,
          }
        : undefined,
    };
  }

  let rootId =
    typeof map.rootId === "string" && normalizedNodes[map.rootId]
      ? map.rootId
      : Object.values(normalizedNodes).find((node) => node.parentId === null)?.id ??
        Object.keys(normalizedNodes)[0] ??
        "root";

  if (!normalizedNodes[rootId]) {
    normalizedNodes[rootId] = {
      id: rootId,
      parentId: null,
      title: t("map.root"),
      x: 0,
      y: 0,
      children: [],
      size: 42,
      shape: "circle",
    };
  }

  const connectedNodes = enforceRootConnectivity(normalizedNodes, rootId);

  const normalizedEdges = Array.isArray(map.edges)
    ? map.edges.filter(
        (edge) =>
          !!edge &&
          typeof edge.id === "string" &&
          typeof edge.fromId === "string" &&
          typeof edge.toId === "string" &&
          edge.fromId !== edge.toId &&
          !!connectedNodes[edge.fromId] &&
          !!connectedNodes[edge.toId]
      )
    : [];

  return {
    ...map,
    rootId,
    nodes: connectedNodes,
    edges: normalizedEdges,
  };
}

function nodeRenderHeight(node: MindMapNode | undefined, isRoot: boolean) {
  const { halfH } = estimateNodeHalfBounds(node, isRoot);
  return halfH * 2;
}

function splitRootChildren(nodes: Record<string, MindMapNode>, root: MindMapNode) {
  const left: string[] = [];
  const right: string[] = [];

  root.children.forEach((childId, index) => {
    const child = nodes[childId];
    if (!child) {
      return;
    }

    if (child.x < root.x) {
      left.push(childId);
    } else if (child.x > root.x) {
      right.push(childId);
    } else if (index % 2 === 0) {
      right.push(childId);
    } else {
      left.push(childId);
    }
  });

  if (left.length === 0 && right.length > 1) {
    left.push(...right.splice(0, Math.floor(right.length / 2)));
  } else if (right.length === 0 && left.length > 1) {
    right.push(...left.splice(Math.ceil(left.length / 2)));
  }

  return { left, right };
}

function makeSubtreeMeasurer(nodes: Record<string, MindMapNode>, rootId: string) {
  const cache = new Map<string, number>();

  const measure = (nodeId: string): number => {
    const cached = cache.get(nodeId);
    if (cached != null) {
      return cached;
    }

    const node = nodes[nodeId];
    if (!node) {
      return 0;
    }

    const ownHeight = nodeRenderHeight(node, node.id === rootId);
    const visibleChildren = node.collapsed ? [] : node.children.filter((childId) => !!nodes[childId]);
    if (visibleChildren.length === 0) {
      cache.set(nodeId, ownHeight);
      return ownHeight;
    }

    const childrenHeight =
      visibleChildren.reduce((sum, childId) => sum + measure(childId), 0) +
      Math.max(0, visibleChildren.length - 1) * STRUCTURED_SIBLING_GAP;
    const height = Math.max(ownHeight, childrenHeight);
    cache.set(nodeId, height);
    return height;
  };

  return measure;
}

export function layoutStructuredMap(map: MindMap): MindMap {
  const connectedNodes = enforceRootConnectivity(map.nodes, map.rootId);
  const root = connectedNodes[map.rootId];
  if (!root) {
    return { ...map, nodes: connectedNodes };
  }

  const nodes: Record<string, MindMapNode> = {};
  for (const [nodeId, node] of Object.entries(connectedNodes)) {
    nodes[nodeId] = { ...node };
  }

  const measureSubtree = makeSubtreeMeasurer(nodes, map.rootId);

  const placeSubtree = (nodeId: string, side: -1 | 1, depth: number, centerY: number) => {
    const node = nodes[nodeId];
    if (!node) {
      return;
    }

    nodes[nodeId] = {
      ...node,
      x: side * STRUCTURED_LEVEL_GAP * depth,
      y: centerY,
    };

    if (node.collapsed) {
      return;
    }

    const children = node.children.filter((childId) => !!nodes[childId]);
    const totalHeight =
      children.reduce((sum, childId) => sum + measureSubtree(childId), 0) +
      Math.max(0, children.length - 1) * STRUCTURED_SIBLING_GAP;
    let cursorY = centerY - totalHeight / 2;

    for (const childId of children) {
      const childHeight = measureSubtree(childId);
      placeSubtree(childId, side, depth + 1, cursorY + childHeight / 2);
      cursorY += childHeight + STRUCTURED_SIBLING_GAP;
    }
  };

  nodes[map.rootId] = {
    ...root,
    x: 0,
    y: 0,
  };

  const { left, right } = splitRootChildren(nodes, root);
  const placeRootSide = (children: string[], side: -1 | 1) => {
    const totalHeight =
      children.reduce((sum, childId) => sum + measureSubtree(childId), 0) +
      Math.max(0, children.length - 1) * STRUCTURED_ROOT_BRANCH_GAP;
    let cursorY = -totalHeight / 2;

    for (const childId of children) {
      const childHeight = measureSubtree(childId);
      placeSubtree(childId, side, 1, cursorY + childHeight / 2);
      cursorY += childHeight + STRUCTURED_ROOT_BRANCH_GAP;
    }
  };

  placeRootSide(left, -1);
  placeRootSide(right, 1);

  return {
    ...map,
    nodes,
  };
}

export function hasRelationshipEdge(edges: RelationshipEdge[], fromId: string, toId: string) {
  return edges.some(
    (edge) =>
      (edge.fromId === fromId && edge.toId === toId) ||
      (edge.fromId === toId && edge.toId === fromId)
  );
}

export function removeRelationshipEdge(edges: RelationshipEdge[], fromId: string, toId: string) {
  return edges.filter(
    (edge) =>
      !(
        (edge.fromId === fromId && edge.toId === toId) ||
        (edge.fromId === toId && edge.toId === fromId)
      )
  );
}

export function enforceRootConnectivity(nodes: Record<string, MindMapNode>, rootId: string): Record<string, MindMapNode> {
  const nextNodes: Record<string, MindMapNode> = {};

  for (const [nodeId, node] of Object.entries(nodes)) {
    nextNodes[nodeId] = {
      ...node,
      parentId: nodeId === rootId ? null : node.parentId,
      children: node.children.filter((childId) => childId !== nodeId && !!nodes[childId]),
    };
  }

  for (const node of Object.values(nextNodes)) {
    if (node.id === rootId) {
      node.parentId = null;
      continue;
    }

    if (!node.parentId || !nextNodes[node.parentId]) {
      node.parentId = rootId;
    }
  }

  const reachesRoot = (nodeId: string) => {
    const seen = new Set<string>();
    let cursor: string | null = nodeId;

    while (cursor) {
      if (cursor === rootId) {
        return true;
      }

      if (seen.has(cursor)) {
        return false;
      }

      seen.add(cursor);
      cursor = nextNodes[cursor]?.parentId ?? null;
    }

    return false;
  };

  for (const node of Object.values(nextNodes)) {
    if (node.id !== rootId && !reachesRoot(node.id)) {
      node.parentId = rootId;
    }
  }

  const childBuckets: Record<string, string[]> = Object.fromEntries(
    Object.keys(nextNodes).map((nodeId) => [nodeId, []])
  );
  const pushChild = (parentId: string, childId: string) => {
    if (!childBuckets[parentId]?.includes(childId)) {
      childBuckets[parentId]?.push(childId);
    }
  };

  for (const node of Object.values(nextNodes)) {
    for (const childId of node.children) {
      if (nextNodes[childId]?.parentId === node.id) {
        pushChild(node.id, childId);
      }
    }
  }

  for (const node of Object.values(nextNodes)) {
    if (node.id !== rootId && node.parentId) {
      pushChild(node.parentId, node.id);
    }
  }

  for (const node of Object.values(nextNodes)) {
    node.children = childBuckets[node.id] ?? [];
  }

  return nextNodes;
}

export function collectVisibleNodeIds(map: MindMap): Set<string> {
  const visible = new Set<string>();

  const visit = (nodeId: string) => {
    const node = map.nodes[nodeId];
    if (!node || visible.has(nodeId)) {
      return;
    }

    visible.add(nodeId);

    if (node.collapsed) {
      return;
    }

    for (const childId of node.children) {
      visit(childId);
    }
  };

  visit(map.rootId);

  return visible;
}

export function normalizeSearchValue(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
