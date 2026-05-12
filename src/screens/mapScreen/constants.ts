import { RelationshipEdge } from "@/src/types/map";

export const DEFAULT_RELATIONSHIP_EDGE: Pick<RelationshipEdge, "style" | "width" | "color"> = {
  style: "dashed",
  width: 2,
  color: "#94a3b8",
};

export const EDGE_PALETTE = [
  "#38bdf8",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ef4444",
  "#facc15",
  "#94a3b8",
];

export const DOT_GRID_SMALL = 32;
export const DOT_GRID_LARGE = 128;
export const PROGRESSIVE_RENDER_NODE_LIMIT = 80;
export const INITIAL_RENDERED_NODES = 48;
export const RENDER_NODE_BATCH = 64;
export const LOCAL_ROUTE_OBSTACLE_LIMIT = 18;
export const FULL_MOVE_VALIDATION_NODE_LIMIT = PROGRESSIVE_RENDER_NODE_LIMIT;
export const MAX_RENDERED_EDGES_PER_FRAME = 90;
export const VIEWPORT_CULL_NODE_LIMIT = 700;
