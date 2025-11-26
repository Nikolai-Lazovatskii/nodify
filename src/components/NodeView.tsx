import React from 'react';
import { Circle, Text as SvgText } from 'react-native-svg';
import { MindMapNode } from '../types/map';

type Props = {
  node: MindMapNode;
  radius?: number;
  isRoot?: boolean;
};

export default function NodeView({ node, radius = 22, isRoot = false }: Props) {
  const fill = isRoot ? '#38bdf8' : '#e5e7eb';
  const textY = isRoot ? node.y + 5 : node.y + 4;

  return (
    <>
      <Circle cx={node.x} cy={node.y} r={isRoot ? radius + 6 : radius} fill={fill} />
      <SvgText
        x={node.x}
        y={textY}
        fontSize={isRoot ? 12 : 10}
        fill="#111827"
        textAnchor="middle"
      >
        {node.title}
      </SvgText>
    </>
  );
}