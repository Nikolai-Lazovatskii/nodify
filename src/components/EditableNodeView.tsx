import React, { useEffect, useRef, useState } from "react";
import { PanResponder } from "react-native";
import { Circle, Text as SvgText, G } from "react-native-svg";
import { MindMapNode } from "../types/map";

type Props = {
  node: MindMapNode;
  isRoot?: boolean;
  selected?: boolean;
  scale?: number;
  onSelect: (nodeId: string) => void;
  onMoveTo: (nodeId: string, x: number, y: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export default function EditableNodeView({
  node,
  isRoot = false,
  selected = false,
  scale = 1,
  onSelect,
  onMoveTo,
  onDragStart,
  onDragEnd,
}: Props) {
  const nodeRef = useRef(node);
  const scaleRef = useRef(scale);

  useEffect(() => {
    nodeRef.current = node;
  }, [node]);

  useEffect(() => {
    scaleRef.current = scale || 1;
  }, [scale]);

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const radius = isRoot ? 26 : 20;
  const fill = isRoot ? "#38bdf8" : "#e5e7eb";

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        dragging.current || Math.abs(g.dx) + Math.abs(g.dy) > 2,

      onPanResponderGrant: () => {
        dragging.current = false;

        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = setTimeout(() => {
          const n = nodeRef.current;
          dragging.current = true;
          startPos.current = { x: n.x, y: n.y };
          onSelect(n.id);
          onDragStart?.();
        }, 180);
      },

      onPanResponderMove: (_, g) => {
        if (!dragging.current) return;

        const n = nodeRef.current;
        const k = scaleRef.current || 1;

        onMoveTo(n.id, startPos.current.x + g.dx / k, startPos.current.y + g.dy / k);
      },

      onPanResponderRelease: () => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = null;

        if (!dragging.current) {
          onSelect(nodeRef.current.id);
        } else {
          onDragEnd?.();
        }

        dragging.current = false;
      },

      onPanResponderTerminate: () => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = null;

        if (dragging.current) onDragEnd?.();
        dragging.current = false;
      },
    })
  ).current;

  return (
    <G {...panResponder.panHandlers}>
      <Circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={fill}
        stroke={selected ? "#0ea5e9" : "transparent"}
        strokeWidth={selected ? 3 : 0}
      />
      <SvgText
        x={node.x}
        y={node.y + 4}
        fontSize={isRoot ? 14 : 12}
        fill="#111827"
        textAnchor="middle"
      >
        {node.title}
      </SvgText>
    </G>
  );
}