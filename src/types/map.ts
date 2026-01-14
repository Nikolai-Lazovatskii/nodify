export type NodeId = string;

export type MindMapNode = {
  id: NodeId;
  parentId: string | null;
  title: string;
  x: number;
  y: number;
  children: string[];
  color?: string;
};

export type MindMap = {
  id: string;
  title: string;
  rootId: string;
  nodes: Record<string, MindMapNode>;
};