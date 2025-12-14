import React from "react";
import { Circle, Text as SvgText, G } from "react-native-svg";
import { MindMapNode } from "../types/map";

type Props = {
  node: MindMapNode;
  isRoot?: boolean;
  selected?: boolean;
  onSelect: (nodeId: string) => void;
};

export default function EditableNodeView({
  node,
  isRoot = false,
  selected = false,
  onSelect,
}: Props) {
  const radius = isRoot ? 26 : 20;
  const fill = isRoot ? "#38bdf8" : "#e5e7eb";

  return (
    <G>
      <Circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={fill}
        stroke={selected ? "#0ea5e9" : "transparent"}
        strokeWidth={selected ? 3 : 0}
        onPress={() => onSelect(node.id)}
      />
      <SvgText
        x={node.x}
        y={node.y + 4}
        fontSize={isRoot ? 14 : 12}
        fill="#111827"
        textAnchor="middle"
        onPress={() => onSelect(node.id)}
      >
        {node.title}
      </SvgText>
    </G>
  );
}