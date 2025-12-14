import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import Svg from "react-native-svg";

import { MindMap, MindMapNode } from "../types/map";
import { styles } from "./MapScreen.styles";

import EdgeView from "../components/EdgeView";
import EditableNodeView from "../components/EditableNodeView";
import NodeInspector from "../components/NodeInspector";
import ZoomableCanvas from "../components/ZoomableCanvas";

export default function MapScreen() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inspectorH, setInspectorH] = useState(0);

  const [map, setMap] = useState<MindMap>({
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
      c1: {
        id: "c1",
        parentId: "root",
        title: "Research",
        x: -140,
        y: 120,
        children: [],
      },
      c2: {
        id: "c2",
        parentId: "root",
        title: "Design",
        x: 0,
        y: 140,
        children: [],
      },
      c3: {
        id: "c3",
        parentId: "root",
        title: "Export",
        x: 140,
        y: 120,
        children: [],
      },
    },
  });

  const nodes = useMemo(() => Object.values(map.nodes), [map.nodes]);
  const root = map.nodes[map.rootId] as MindMapNode;

  const selectedNode = selectedId ? map.nodes[selectedId] ?? null : null;
  const bottomInset = selectedNode ? Math.max(inspectorH, 220) : 0;

  const updateTitle = (nodeId: string, newTitle: string) => {
    setMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], title: newTitle },
      },
    }));
  };

  const moveNodeTo = (nodeId: string, x: number, y: number) => {
    const PAD = 6;
    const rOf = (id: string, rootId: string) => (id === rootId ? 26 : 20);

    setMap((prev) => {
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

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: { ...prev.nodes[nodeId], x: nx, y: ny },
        },
      };
    });
  };

  return (
    <View style={styles.container}>

      <View style={{ flex: 1, marginTop: 12, overflow: "hidden" }}>
        <View style={{ flex: 1, marginBottom: bottomInset }}>
          <ZoomableCanvas>
            <Svg width="100%" height="100%" viewBox="-200 -200 400 400">
              {root.children.map((cid) => {
                const child = map.nodes[cid]!;
                return (
                  <EdgeView
                    key={`edge-${cid}`}
                    from={{ x: root.x, y: root.y }}
                    to={{ x: child.x, y: child.y }}
                  />
                );
              })}

              {nodes.map((n) => (
                <EditableNodeView
                  key={n.id}
                  node={n}
                  isRoot={n.id === root.id}
                  selected={n.id === selectedId}
                  onSelect={setSelectedId}
                  onMoveTo={moveNodeTo}
                  onDragStart={() => setSelectedId(null)}
                  onDragEnd={() => {}}
                />
              ))}
            </Svg>
          </ZoomableCanvas>
        </View>

        <NodeInspector
          node={selectedNode}
          nodes={map.nodes}
          onClose={() => setSelectedId(null)}
          onUpdateTitle={updateTitle}
          onHeight={setInspectorH}
          onSelectNode={setSelectedId}
        />
      </View>
    </View>
  );
}
