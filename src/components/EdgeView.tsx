import React from 'react';
import { Line } from 'react-native-svg';

type Props = {
  from: { x: number; y: number };
  to: { x: number; y: number };
};

export default function EdgeView({ from, to }: Props) {
  return (
    <Line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke="#9ca3af"
      strokeWidth={2}
    />
  );
}