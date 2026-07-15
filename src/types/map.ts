/**
 * Súbor: src/types/map.ts
 * Abstrakt: Definuje typy dátového modelu myšlienkových máp, uzlov, hrán a metadát.
 */
export type NodeId = string;

export type NodeShape = "circle" | "rounded" | "capsule";

export type EdgeStyle = "solid" | "dashed";

export type MapLayoutMode = "structured" | "imported" | "manual";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type RawPreservedData = {
  rawJson?: JsonValue;
  rawXml?: string;
  unknownAttributes?: Record<string, string>;
  unknownElements?: string[];
};

export type VendorSpecificNodeData = {
  xmind?: {
    topicId?: string;
    rawTopic?: JsonValue;
    importedFillColor?: string;
    importedDisplayColor?: string;
    importedPosition?: {
      x: number;
      y: number;
    };
  };
  mm?: {
    sourceNodeId?: string;
    importedPosition?: {
      x: number;
      y: number;
    };
    rawAttributes?: Record<string, string>;
    rawEdgeAttributes?: Record<string, string>;
    rawChildElements?: string[];
  };
};

export type VendorSpecificEdgeData = {
  xmind?: {
    relationshipId?: string;
    rawRelationship?: JsonValue;
  };
  mm?: {
    rawArrowlinkAttributes?: Record<string, string>;
  };
};

export type VendorSpecificMapData = {
  xmind?: {
    rawContent?: JsonValue;
    rawSheet?: JsonValue;
    rawSheetIndex?: number;
    rawManifest?: JsonValue;
    rawMetadata?: JsonValue;
    unmappedRelationships?: JsonValue[];
  };
  mm?: {
    rawXml?: string;
    rawMapAttributes?: Record<string, string>;
    unknownMapChildren?: string[];
  };
};

export type ImportedFormatMetadata = {
  sourceFormat: "xmind" | "mm" | "nodify";
  importedAt: string;
  preferredExportFormat?: "xmind" | "mm";
  raw?: RawPreservedData;
  vendor?: VendorSpecificMapData;
};

export type RelationshipEdge = {
  id: string;
  fromId: NodeId;
  toId: NodeId;
  style?: EdgeStyle;
  width?: number;
  color?: string;
  vendor?: VendorSpecificEdgeData;
};

export type EdgeToParent = {
  style: EdgeStyle;
  width: number;
  color?: string;
};

export type NodeAttachment = {
  id: string;
  name: string;
  uri: string;
  mimeType?: string;
  size?: number;
};

export type MindMapNode = {
  id: NodeId;
  parentId: string | null;
  title: string;
  note?: string;
  tags?: string[];
  attachments?: NodeAttachment[];
  dueAt?: string;
  x: number;
  y: number;
  children: string[];
  collapsed?: boolean;
  color?: string;
  size?: number;
  shape?: NodeShape;
  edgeToParent?: EdgeToParent;
  vendor?: VendorSpecificNodeData;
};

export type MindMap = {
  id: string;
  title: string;
  rootId: string;
  layoutMode?: MapLayoutMode;
  nodes: Record<string, MindMapNode>;
  edges: RelationshipEdge[];
  importedFormat?: ImportedFormatMetadata;
};

export type MapMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  storage?: "cloud" | "local";
  pendingSyncAt: number | null;
  lastSyncedAt: number | null;
};
