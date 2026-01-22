import React, { useMemo, useState } from "react";
import { View, Pressable, StyleSheet, Text } from "react-native";
import Svg from "react-native-svg";

import { MindMap, MindMapNode } from "../types/map";
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
          },
          c1: { id: "c1", parentId: "root", title: "Research", x: -140, y: 120, children: [] },
          c2: { id: "c2", parentId: "root", title: "Design", x: 0, y: 140, children: [] },
          c3: { id: "c3", parentId: "root", title: "Export", x: 140, y: 120, children: [] },
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

  const bottomInset = selectedNode ? Math.max(inspectorH, 220) : 0;

  const WORLD_W = 1200;
  const WORLD_H = 1800;
  const VIEWBOX = `${-WORLD_W / 2} ${-WORLD_H / 2} ${WORLD_W} ${WORLD_H}`;

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
      <View style={{ flex: 1, marginTop: 12, overflow: "hidden" }}>
        <View style={{ flex: 1, marginBottom: bottomInset }}>
          <ZoomableCanvas
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
              style={({ pressed }) => [ui.addButton, pressed && ui.pressed]}
            >
              <Text style={ui.addButtonText}>＋</Text>
            </Pressable>
          )}
        </View>

        <NodeInspector
          node={selectedNode}
          nodes={map.nodes}
          onClose={() => setSelectedId(null)}
          onUpdateTitle={updateTitle}
          onUpdateColor={updateColor}
          onHeight={setInspectorH}
          onSelectNode={setSelectedId}
        />
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