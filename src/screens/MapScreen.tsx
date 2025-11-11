import React, { useState } from "react";
import { Text, View } from "react-native";
import { MindMapCanvas } from "../components/MindMapCanvas";
import { MindMap } from "../types/map";
import { styles } from "./MapScreen.styles";

export default function MapScreen() {
  const mockMap: MindMap = {
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
        children: ["child1", "child2"],
      },
      child1: {
        id: "child1",
        parentId: "root",
        title: "Child 1",
        x: -80,
        y: 80,
        children: [],
      },
      child2: {
        id: "child2",
        parentId: "root",
        title: "Child 2",
        x: 80,
        y: 80,
        children: [],
      },
    },
  };

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nodify – Mind Map</Text>
      <Text style={styles.text}>
        Jednoduchá vizualizácia mock mapy na základe dátovej štruktúry.
      </Text>
      <Text style={styles.text}>Mapa: {mockMap.title}</Text>

      <MindMapCanvas map={mockMap} />

      {selectedNodeId && (
        <Text style={styles.text}>Vybraný uzol: {selectedNodeId}</Text>
      )}
    </View>
  );
}
