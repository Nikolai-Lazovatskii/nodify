import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Pressable, StyleSheet, Text, useWindowDimensions } from "react-native";
import Svg from "react-native-svg";

import { MindMap, MindMapNode, EdgeStyle, NodeShape } from "../types/map";
import { styles } from "./MapScreen.styles";

import EdgeView from "../components/EdgeView";
import EditableNodeView from "../components/EditableNodeView";
import NodeInspector from "../components/NodeInspector";
import ZoomableCanvas from "../components/ZoomableCanvas";

type Props = {
  initialMap?: MindMap;
  onMapChange?: (map: MindMap) => void;
};

export default function MapScreen({ initialMap, onMapChange }: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const isLandscape = screenW > screenH;

  const [canvasKey, setCanvasKey] = useState(0);
  const lastOrientation = useRef(isLandscape);
  const didMount = useRef(false);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      setCanvasKey((k) => k + 1);
      lastOrientation.current = isLandscape;
      return;
    }

    if (lastOrientation.current !== isLandscape) {
      lastOrientation.current = isLandscape;
      setCanvasKey((k) => k + 1);
    }
  }, [isLandscape]);

  const WORLD_W = isLandscape ? 1800 : 1200;
  const WORLD_H = isLandscape ? 1200 : 1800;
  const VIEWBOX = `${-WORLD_W / 2} ${-WORLD_H / 2} ${WORLD_W} ${WORLD_H}`;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorH, setInspectorH] = useState(0);
  const [draggingNode, setDraggingNode] = useState(false);
  const [canvasScale, setCanvasScale] = useState(1);

  const [map, setMap] = useState<MindMap>(() => {
    return (
      initialMap ?? {
        id: "map1",
        title: "Sample Map",
        rootId: "root",
        nodes: {
          root: {
            id: "root",
            parentId: null,
            title: "Root",
            x: 0,
            y: 0,
            children: ["c1", "c2", "c3"],
            shape: "circle",
          },
          c1: { id: "c1", parentId: "root", title: "Research", x: -140, y: 120, children: [], shape: "circle", edgeToParent: { style: "solid", width: 2, color: "#9ca3af" } },
          c2: { id: "c2", parentId: "root", title: "Design", x: 0, y: 140, children: [], shape: "circle", edgeToParent: { style: "solid", width: 2, color: "#9ca3af" } },
          c3: { id: "c3", parentId: "root", title: "Export", x: 140, y: 120, children: [], shape: "circle", edgeToParent: { style: "solid", width: 2, color: "#9ca3af" } },
        },
      }
    );
  });

  const applyMap = (updater: (prev: MindMap) => MindMap) => {
    setMap((prev) => {
      const next = updater(prev);
      onMapChange?.(next);
      return next;
    });
  };

  const nodes = useMemo(() => Object.values(map.nodes), [map.nodes]);
  const selectedNode = selectedId ? map.nodes[selectedId] ?? null : null;

  const bottomInset = !isLandscape && selectedNode ? Math.max(inspectorH, 220) : 0;
  const updateTitle = (nodeId: string, newTitle: string) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], title: newTitle },
      },
    }));
  };

  const updateColor = (nodeId: string, newColor: string | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], color: newColor },
      },
    }));
  };

  const updateShape = (nodeId: string, shape: NodeShape | undefined) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], shape },
      },
    }));
  };

  const updateEdge = (
    nodeId: string,
    patch: { style?: EdgeStyle; width?: number; color?: string }
  ) => {
    applyMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: {
          ...prev.nodes[nodeId],
          edgeToParent: {
            ...(prev.nodes[nodeId].edgeToParent ?? { style: "solid", width: 2, color: "#9ca3af" }),
            ...patch,
          },
        },
      },
    }));
  };

  const resolveCollisionPosition = (prev: MindMap, nodeId: string, x: number, y: number) => {
    const PAD = 6;
    const rOf = (id: string, rootId: string) => (id === rootId ? 26 : 20);

    const selfR = rOf(nodeId, prev.rootId);

    let nx = x;
    let ny = y;

    for (let pass = 0; pass < 4; pass++) {
      for (const [otherId, other] of Object.entries(prev.nodes)) {
        if (otherId === nodeId) continue;

        const otherR = rOf(otherId, prev.rootId);
        const minDist = selfR + otherR + PAD;

        const dx = nx - other.x;
        const dy = ny - other.y;
        const dist = Math.hypot(dx, dy);

        if (dist < minDist) {
          const safe = dist === 0 ? 1 : dist;
          const ux = dx / safe;
          const uy = dy / safe;

          nx = other.x + ux * minDist;
          ny = other.y + uy * minDist;
        }
      }
    }

    return { x: nx, y: ny };
  };

  const moveNodeTo = (nodeId: string, x: number, y: number) => {
    applyMap((prev) => {
      const { x: nx, y: ny } = resolveCollisionPosition(prev, nodeId, x, y);
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: { ...prev.nodes[nodeId], x: nx, y: ny },
        },
      };
    });
  };

  const addChildToSelected = () => {
    if (!selectedId) return;

    const newId = `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    applyMap((prev) => {
      const parent = prev.nodes[selectedId];
      if (!parent) return prev;

      const siblingsCount = parent.children?.length ?? 0;

      const R = 110;
      const angleStep = Math.PI / 4;
      const theta = -Math.PI / 2 + siblingsCount * angleStep;

      const rawX = parent.x + Math.cos(theta) * R;
      const rawY = parent.y + Math.sin(theta) * R;

      const placed = resolveCollisionPosition(prev, newId, rawX, rawY);

      const child: MindMapNode = {
        id: newId,
        parentId: parent.id,
        title: "New node",
        x: placed.x,
        y: placed.y,
        children: [],
        shape: "circle",
        edgeToParent: { style: "solid", width: 2, color: "#9ca3af" },
      };

      const nextParent: MindMapNode = {
        ...parent,
        children: [...(parent.children ?? []), newId],
      };

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [newId]: child,
          [parent.id]: nextParent,
        },
      };
    });

    setSelectedId(newId);
  };

  return (
    <View style={styles.container}>
      <View style={{ flex: 1, marginTop: 12, overflow: "hidden", flexDirection: isLandscape ? "row" : "column" }}>
        <View style={{ flex: 1, marginBottom: isLandscape ? 0 : bottomInset, alignItems: "center", justifyContent: "center" }}>
          <ZoomableCanvas
            key={`canvas:${map.id}:${canvasKey}`}
            enabled={!draggingNode}
            minScale={0.25}
            maxScale={40}
            onScaleChange={setCanvasScale}
          >
            <Svg width={WORLD_W} height={WORLD_H} viewBox={VIEWBOX}>
              {Object.values(map.nodes).flatMap((p) =>
                (p.children ?? []).map((cid) => {
                  const c = map.nodes[cid];
                  if (!c) return null;
                  return (
                    <EdgeView
                      key={`edge-${p.id}-${cid}`}
                      from={{ x: p.x, y: p.y }}
                      to={{ x: c.x, y: c.y }}
                      edgeStyle={(c.edgeToParent?.style ?? "solid")}
                      width={(c.edgeToParent?.width ?? 2)}
                      color={(c.edgeToParent?.color ?? "#9ca3af")}
                    />
                  );
                })
              )}

              {nodes.map((n) => (
                <EditableNodeView
                  key={n.id}
                  node={n}
                  isRoot={n.id === map.rootId}
                  selected={n.id === selectedId}
                  scale={canvasScale}
                  shape={n.shape}
                  onSelect={setSelectedId}
                  onMoveTo={moveNodeTo}
                  onDragStart={() => setDraggingNode(true)}
                  onDragEnd={() => setDraggingNode(false)}
                />
              ))}
            </Svg>
          </ZoomableCanvas>

          {selectedNode && (
            <Pressable
              onPress={addChildToSelected}
              style={({ pressed }) => [
                ui.addButton,
                isLandscape && ui.addButtonLandscape,
                pressed && ui.pressed,
              ]}
            >
              <Text style={ui.addButtonText}>＋</Text>
            </Pressable>
          )}
        </View>

        {selectedNode && (
          <NodeInspector
            mode={isLandscape ? "side" : "sheet"}
            sideWidth={340}
            node={selectedNode}
            nodes={map.nodes}
            onClose={() => setSelectedId(null)}
            onUpdateTitle={updateTitle}
            onUpdateColor={updateColor}
            onUpdateShape={updateShape}
            onUpdateEdge={updateEdge}
            onHeight={isLandscape ? (() => {}) : setInspectorH}
            onSelectNode={setSelectedId}
          />
        )}
      </View>
    </View>
  );
}

const ui = StyleSheet.create({
  addButton: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#0ea5e9",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  addButtonLandscape: {
    left: 12,
    right: undefined,
  },
  addButtonText: {
    color: "#ffffff",
    fontSize: 26,
    lineHeight: 26,
    fontWeight: "800",
    marginTop: -2,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});