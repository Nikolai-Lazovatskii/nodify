import { View, Text } from "react-native";
import React from "react";
import Svg, { Line, Circle, Text as SvgText } from "react-native-svg";
import { MindMap, MindMapNode } from "../types/map";
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

  const width = 400;
  const height = 400;
  const centerX = width / 2;
  const centerY = 150;

  const positionedNodes: Record<string, { node: MindMapNode; x: number; y: number }> =
    Object.fromEntries(
      Object.values(mockMap.nodes).map((node) => {
        if (node.parentId === null) {
          return [node.id, { node, x: centerX, y: centerY }];
        }

        return [
          node.id,
          {
            node,
            x: centerX + node.x,
            y: centerY + node.y,
          },
        ];
      })
    );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nodify – Mind Map</Text>
      <Text style={styles.text}>
        Jednoduchá vizualizácia mock mapy na základe dátovej štruktúry.
      </Text>
      <Text style={styles.text}>Mapa: {mockMap.title}</Text>

      <View style={{ flex: 1, marginTop: 16 }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
          {/* Линии: от родителя к ребёнку */}
          {Object.values(positionedNodes).map(({ node, x, y }) => {
            if (!node.parentId) return null;
            const parentPos = positionedNodes[node.parentId];
            if (!parentPos) return null;

            return (
              <Line
                key={`line-${node.id}`}
                x1={parentPos.x}
                y1={parentPos.y}
                x2={x}
                y2={y}
                stroke="#9ca3af"
                strokeWidth={2}
              />
            );
          })}

          {/* Узлы */}
          {Object.values(positionedNodes).map(({ node, x, y }) => {
            const isRoot = node.parentId === null;
            const radius = isRoot ? 26 : 20;
            const fill = isRoot ? "#38bdf8" : "#e5e7eb";

            return (
              <React.Fragment key={`node-${node.id}`}>
                <Circle cx={x} cy={y} r={radius} fill={fill} />
                <SvgText
                  x={x}
                  y={y + 4}
                  fontSize={isRoot ? 12 : 10}
                  fill="#111827"
                  textAnchor="middle"
                >
                  {node.title}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
    </View>
  );
}