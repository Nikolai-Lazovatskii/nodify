import React, { useEffect, useRef, useState } from "react";
import { PanResponder } from "react-native";
import { Circle, Rect, Text as SvgText, G } from "react-native-svg";
import { MindMapNode, NodeShape } from "../types/map";
import * as Haptics from "expo-haptics";

type Props = {
  node: MindMapNode;
  isRoot?: boolean;
  selected?: boolean;
  scale?: number;
  shape?: NodeShape;
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
  shape = "circle",
  onSelect,
  onMoveTo,
  onDragStart,
  onDragEnd,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const nodeIdRef = useRef(node.id);
  const scaleRef = useRef(scale || 1);
  const startPos = useRef({ x: node.x, y: node.y });

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    nodeIdRef.current = node.id;
  }, [node.id]);

  useEffect(() => {
    scaleRef.current = scale || 1;
  }, [scale]);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const LONG_PRESS_MS = 220;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) =>
        draggingRef.current || Math.abs(g.dx) + Math.abs(g.dy) > 2,

      onPanResponderGrant: () => {
        draggingRef.current = false;

        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = setTimeout(() => {
          draggingRef.current = true;
          startPos.current = { x: node.x, y: node.y };

          setIsDragging(true);
          onDragStart?.();

          Promise.resolve(
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          ).catch(() => {});
        }, LONG_PRESS_MS);
      },

      onPanResponderMove: (_, g) => {
        if (!draggingRef.current) return;

        const k = scaleRef.current || 1;
        onMoveTo(
          nodeIdRef.current,
          startPos.current.x + g.dx / k,
          startPos.current.y + g.dy / k
        );
      },

      onPanResponderRelease: () => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = null;

        if (draggingRef.current) {
          setIsDragging(false);
          onDragEnd?.();
        } else {
          onSelect(nodeIdRef.current);
        }

        draggingRef.current = false;
      },

      onPanResponderTerminate: () => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = null;

        if (draggingRef.current) {
          setIsDragging(false);
          onDragEnd?.();
        }

        draggingRef.current = false;
      },
    })
  ).current;

  const baseR = isRoot ? 26 : 20;
  const r = isDragging ? baseR * 1.4 : baseR;

  const fillDefault = isRoot ? "#38bdf8" : "#e5e7eb";
  const fill = node.color ?? fillDefault;

  const textPaddingX = 10;
  const fontSize = isRoot ? 14 : 12;
  const approxCharW = fontSize * 0.6;
  const textW = Math.max(24, (node.title ?? "").length * approxCharW);

  const wBase = Math.max(baseR * 2, textW + textPaddingX * 2);
  const hBase = baseR * 2;

  const w = isDragging ? wBase * 1.4 : wBase;
  const h = isDragging ? hBase * 1.4 : hBase;

  const x0 = node.x - w / 2;
  const y0 = node.y - h / 2;

  const rx = shape === "capsule" ? h / 2 : 14;
  const ry = rx;

  return (
    <G {...panResponder.panHandlers}>
      {shape === "circle" ? (
        <Circle
          cx={node.x}
          cy={node.y}
          r={r}
          fill={fill}
          stroke={selected ? "#0ea5e9" : "transparent"}
          strokeWidth={selected ? 8 : 0}
        />
      ) : (
        <Rect
          x={x0}
          y={y0}
          width={w}
          height={h}
          rx={rx}
          ry={ry}
          fill={fill}
          stroke={selected ? "#0ea5e9" : "transparent"}
          strokeWidth={selected ? 8 : 0}
        />
      )}
      <SvgText
        x={node.x}
        y={node.y + 4}
        fontSize={fontSize}
        fill="#111827"
        textAnchor="middle"
      >
        {node.title}
      </SvgText>
    </G>
  );
}