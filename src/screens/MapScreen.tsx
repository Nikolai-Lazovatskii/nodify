import React, { useState } from "react";
import { Text, View } from "react-native";
import Svg from "react-native-svg";

import { MindMap, MindMapNode } from "../types/map";
import { styles } from "./MapScreen.styles";

import EdgeView from "../components/EdgeView";
import EditableNodeView from "../components/EditableNodeView";
import ZoomableCanvas from "../components/ZoomableCanvas";

export default function MapScreen() {
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

  const nodes = Object.values(map.nodes);
  const root = map.nodes[map.rootId] as MindMapNode;

  const updateTitle = (nodeId: string, newTitle: string) => {
    setMap((prev) => ({
      ...prev,
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], title: newTitle },
      },
    }));
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nodify — Mind Map</Text>
      <Text style={styles.text}>
        Pinch to zoom, drag to pan. Double-tap to reset.
      </Text>

      <View style={{ flex: 1, marginTop: 12, overflow: "hidden" }}>
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
                onUpdateTitle={updateTitle}
              />
            ))}
          </Svg>
        </ZoomableCanvas>
      </View>
    </View>
  );
}
