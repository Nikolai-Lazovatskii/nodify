export type NodeId = string;

export type NodeShape = "circle" | "rounded" | "capsule";

export type EdgeStyle = "solid" | "dashed";

export type EdgeToParent = {
  style: EdgeStyle;
  width: number;
  color: string;
};

export type MindMapNode = {
  id: NodeId;
  parentId: string | null;
  title: string;
  x: number;
  y: number;
  children: string[];
  color?: string;
  shape?: NodeShape;
  edgeToParent?: EdgeToParent;
};

export type MindMap = {
  id: string;
  title: string;
  rootId: string;
  nodes: Record<string, MindMapNode>;
};