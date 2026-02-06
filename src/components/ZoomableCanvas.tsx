import React, { PropsWithChildren, useCallback, useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

type Props = PropsWithChildren<{
  enabled?: boolean;
  minScale?: number;
  maxScale?: number;
  onScaleChange?: (s: number) => void;
}>;

export default function ZoomableCanvas({
  children,
  enabled = true,
  minScale = 0.25,
  maxScale = 40,
  onScaleChange,
}: Props) {
  const [size, setSize] = useState({ w: 1, h: 1 });

  const prevSize = useRef<{ w: number; h: number } | null>(null);
  const didInitLayout = useRef(false);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);

  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startScale = useSharedValue(1);

  const setScaleJS = useCallback(
    (s: number) => onScaleChange?.(s),
    [onScaleChange]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;

    const next = { w: width, h: height };

    const prev = prevSize.current;
    prevSize.current = next;
    setSize(next);

    if (!didInitLayout.current) {
      didInitLayout.current = true;
      return;
    }

    if (!prev) return;

    const dx = (next.w - prev.w) / 2;
    const dy = (next.h - prev.h) / 2;

    tx.value = tx.value + dx;
    ty.value = ty.value + dy;
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .onBegin(() => {
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startTx.value + e.translationX;
      ty.value = startTy.value + e.translationY;
    });

  const pinch = Gesture.Pinch()
    .enabled(enabled)
    .onBegin(() => {
      startScale.value = scale.value;
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      let next = startScale.value * e.scale;
      if (next < minScale) next = minScale;
      if (next > maxScale) next = maxScale;

      const cx = size.w / 2;
      const cy = size.h / 2;

      const fx = e.focalX;
      const fy = e.focalY;

      const s0 = startScale.value;
      const s1 = next;

      tx.value = startTx.value + (1 - s1 / s0) * (fx - cx);
      ty.value = startTy.value + (1 - s1 / s0) * (fy - cy);

      scale.value = next;

      if (onScaleChange) runOnJS(setScaleJS)(next);
    })
    .onEnd(() => {
      if (onScaleChange) runOnJS(setScaleJS)(scale.value);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(enabled)
    .onEnd(() => {
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      scale.value = withTiming(1);
      if (onScaleChange) runOnJS(setScaleJS)(1);
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.container} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[styles.content, animatedStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});