import React from "react";
import { Line } from "react-native-svg";

import { EdgeStyle } from "../types/map";

type Props = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  color?: string;
  width?: number;
  edgeStyle?: EdgeStyle;
};

export default function EdgeView({
  from,
  to,
  color = "#9ca3af",
  width = 2,
  edgeStyle = "solid",
}: Props) {
  return (
    <Line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={color}
      strokeWidth={width}
      strokeDasharray={edgeStyle === "dashed" ? "8 6" : undefined}
      strokeLinecap="round"
    />
  );
}