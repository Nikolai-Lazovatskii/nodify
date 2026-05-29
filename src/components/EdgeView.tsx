/**
 * Súbor: src/components/EdgeView.tsx
 * Abstrakt: Vykresľuje vizuálnu hranu medzi uzlami myšlienkovej mapy.
 */
import React, { memo, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { G, Path, Polygon } from "react-native-svg";

import { EdgeStyle } from "../types/map";

export type EdgePoint = { x: number; y: number };

type Props = {
  from: EdgePoint;
  to: EdgePoint;
  points?: EdgePoint[];
  color?: string;
  width?: number;
  edgeStyle?: EdgeStyle;
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  hitSlopWidth?: number;
  endArrow?: boolean;
  endArrowTargetBounds?: { halfW: number; halfH: number };
};

function makePath(points: EdgePoint[]) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const cornerRadius = 18;
  const commands = [`M ${points[0].x} ${points[0].y}`];

  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const inDx = current.x - prev.x;
    const inDy = current.y - prev.y;
    const outDx = next.x - current.x;
    const outDy = next.y - current.y;
    const inLength = Math.hypot(inDx, inDy);
    const outLength = Math.hypot(outDx, outDy);
    const radius = Math.min(cornerRadius, inLength / 2, outLength / 2);

    if (radius <= 1 || (inDx !== 0 && inDy !== 0) || (outDx !== 0 && outDy !== 0)) {
      commands.push(`L ${current.x} ${current.y}`);
      continue;
    }

    const before = {
      x: current.x - (inDx / inLength) * radius,
      y: current.y - (inDy / inLength) * radius,
    };
    const after = {
      x: current.x + (outDx / outLength) * radius,
      y: current.y + (outDy / outLength) * radius,
    };

    commands.push(`L ${before.x} ${before.y}`);
    commands.push(`Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }

  const last = points[points.length - 1];
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

function makeArrowPoints(
  points: EdgePoint[],
  width: number,
  targetBounds?: { halfW: number; halfH: number }
) {
  if (points.length < 2) {
    return null;
  }

  const tip = points[points.length - 1];
  let base = points[points.length - 2];
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const candidate = points[index];
    if (candidate.x !== tip.x || candidate.y !== tip.y) {
      base = candidate;
      break;
    }
  }

  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const length = Math.hypot(dx, dy);
  if (length <= 0) {
    return null;
  }

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const targetInset = targetBounds
    ? 1 / Math.sqrt(
        (ux * ux) / Math.max(1, targetBounds.halfW * targetBounds.halfW) +
          (uy * uy) / Math.max(1, targetBounds.halfH * targetBounds.halfH)
      )
    : 0;
  const visibleTip = {
    x: tip.x - ux * (targetInset + 3),
    y: tip.y - uy * (targetInset + 3),
  };
  const arrowLength = Math.max(12, width * 5.5);
  const arrowWidth = Math.max(8, width * 3.8);
  const backX = visibleTip.x - ux * arrowLength;
  const backY = visibleTip.y - uy * arrowLength;

  return [
    visibleTip,
    { x: backX + px * (arrowWidth / 2), y: backY + py * (arrowWidth / 2) },
    { x: backX - px * (arrowWidth / 2), y: backY - py * (arrowWidth / 2) },
  ];
}

function pointsToPolygon(points: EdgePoint[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function EdgeView({
  from,
  to,
  points,
  color = "#9ca3af",
  width = 2,
  edgeStyle = "solid",
  selected = false,
  onPress,
  onLongPress,
  hitSlopWidth = 20,
  endArrow = false,
  endArrowTargetBounds,
}: Props) {
  const allowSvgTouch = Platform.OS !== "android";
  const stroke = selected ? "#0ea5e9" : color;
  const strokeWidth = selected ? width + 2 : width;
  const pathPoints = points && points.length >= 2 ? points : [from, to];
  const pathD = makePath(pathPoints);
  const arrowPoints = endArrow ? makeArrowPoints(pathPoints, strokeWidth, endArrowTargetBounds) : null;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const hasTouchHandlers = allowSvgTouch && (!!onPress || !!onLongPress);

  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  return (
    <G>
      {hasTouchHandlers && hitSlopWidth > 0 ? (
        <Path
          d={pathD}
          stroke="rgba(15,23,42,0.01)"
          strokeWidth={hitSlopWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          onPressIn={() => {
            longPressTriggeredRef.current = false;
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
            }
            if (onLongPress) {
              longPressTimer.current = setTimeout(() => {
                longPressTriggeredRef.current = true;
                onLongPress();
              }, 360);
            }
          }}
          onPressOut={() => {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }}
          onPress={(event) => {
            event.stopPropagation?.();
            if (!longPressTriggeredRef.current) {
              onPress?.();
            }
            longPressTriggeredRef.current = false;
          }}
        />
      ) : null}
      <Path
        d={pathD}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={edgeStyle === "dashed" ? "8 6" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        onPress={
          hasTouchHandlers
            ? (event) => {
                event.stopPropagation?.();
                onPress?.();
              }
            : undefined
        }
        onLongPress={hasTouchHandlers ? () => onLongPress?.() : undefined}
      />
      {arrowPoints ? (
        <Polygon
          points={pointsToPolygon(arrowPoints)}
          fill={stroke}
          stroke={stroke}
          strokeWidth={Math.max(1, strokeWidth * 0.45)}
          strokeLinejoin="round"
        />
      ) : null}
    </G>
  );
}

export default memo(EdgeView, (prev, next) => {
  return (
    prev.from.x === next.from.x &&
    prev.from.y === next.from.y &&
    prev.to.x === next.to.x &&
    prev.to.y === next.to.y &&
    pointsEqual(prev.points, next.points) &&
    prev.color === next.color &&
    prev.width === next.width &&
    prev.edgeStyle === next.edgeStyle &&
    prev.selected === next.selected &&
    prev.onPress === next.onPress &&
    prev.onLongPress === next.onLongPress &&
    prev.hitSlopWidth === next.hitSlopWidth &&
    prev.endArrow === next.endArrow &&
    prev.endArrowTargetBounds?.halfW === next.endArrowTargetBounds?.halfW &&
    prev.endArrowTargetBounds?.halfH === next.endArrowTargetBounds?.halfH
  );
});

function pointsEqual(a?: EdgePoint[], b?: EdgePoint[]) {
  if (a === b) {
    return true;
  }

  if (!a || !b || a.length !== b.length) {
    return false;
  }

  return a.every((point, index) => point.x === b[index].x && point.y === b[index].y);
}
