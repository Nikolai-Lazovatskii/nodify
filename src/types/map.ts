export type NodeId = string;

export interface MindMapNode {
  id: NodeId;
  parentId: NodeId | null;
  title: string;
  x: number;
  y: number;
  children: NodeId[];
}

export interface MindMap {
  id: string;
  title: string;
  rootId: NodeId;
  nodes: Record<NodeId, MindMapNode>;
}