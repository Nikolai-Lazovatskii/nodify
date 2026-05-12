import React, {
  forwardRef,
  PropsWithChildren,
  useEffect,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
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
  onDoubleTap?: () => void;
  onTapPoint?: (x: number, y: number) => void;
  tapEnabled?: boolean;
  onZoomGestureStart?: () => void;
  onZoomGestureEnd?: () => void;
  onTransformChange?: (transform: CanvasTransform) => void;
  notifyTransformDuringGesture?: boolean;
  transformNotifyIntervalMs?: number;
  notifyScaleDuringGesture?: boolean;
  scaleNotifyIntervalMs?: number;
  contentWidth?: number;
  contentHeight?: number;
}>;

export type CanvasTransform = {
  tx: number;
  ty: number;
  scale: number;
  width: number;
  height: number;
};

export type ZoomableCanvasHandle = {
  centerOn: (
    x: number,
    y: number,
    nextScale?: number,
    screenOffsetX?: number,
    screenOffsetY?: number
  ) => void;
  reset: () => void;
  localToWorld: (localX: number, localY: number) => { x: number; y: number };
};

const ZoomableCanvas = forwardRef<ZoomableCanvasHandle, Props>(function ZoomableCanvas({
  children,
  enabled = true,
  minScale = 0.25,
  maxScale = 40,
  onScaleChange,
  onDoubleTap,
  onTapPoint,
  tapEnabled = false,
  onZoomGestureStart,
  onZoomGestureEnd,
  onTransformChange,
  notifyTransformDuringGesture = true,
  transformNotifyIntervalMs = 80,
  notifyScaleDuringGesture = true,
  scaleNotifyIntervalMs = 100,
  contentWidth,
  contentHeight,
}, ref) {
  const [size, setSize] = useState({ w: 1, h: 1 });
  const sizeRef = useRef({ w: 1, h: 1 });
  const transformRef = useRef({ tx: 0, ty: 0, scale: 1 });
  const lastTransformNotifyRef = useRef(0);
  const lastScaleNotifyRef = useRef(0);

  const sizeW = useSharedValue(1);
  const sizeH = useSharedValue(1);
  const contentW = useSharedValue(contentWidth ?? 1);
  const contentH = useSharedValue(contentHeight ?? 1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);

  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const startScale = useSharedValue(1);

  const setScaleJS = useCallback(
    (s: number, forceNotify = false) => {
      if (!onScaleChange) {
        return;
      }

      const now = Date.now();
      if (!forceNotify && (!notifyScaleDuringGesture || now - lastScaleNotifyRef.current < scaleNotifyIntervalMs)) {
        return;
      }

      lastScaleNotifyRef.current = now;
      onScaleChange(s);
    },
    [notifyScaleDuringGesture, onScaleChange, scaleNotifyIntervalMs]
  );

  const setTransformJS = useCallback((nextTx: number, nextTy: number, nextScale: number, forceNotify = false) => {
    transformRef.current = { tx: nextTx, ty: nextTy, scale: nextScale };
    if (!onTransformChange) {
      return;
    }

    const now = Date.now();
    if (!forceNotify && (!notifyTransformDuringGesture || now - lastTransformNotifyRef.current < transformNotifyIntervalMs)) {
      return;
    }

    lastTransformNotifyRef.current = now;
    onTransformChange({
      tx: nextTx,
      ty: nextTy,
      scale: nextScale,
      width: sizeRef.current.w,
      height: sizeRef.current.h,
    });
  }, [notifyTransformDuringGesture, onTransformChange, transformNotifyIntervalMs]);

  const clampOffsets = (
    nextTx: number,
    nextTy: number,
    nextScale: number
  ): { tx: number; ty: number } => {
    "worklet";
    const travelPaddingX = Math.max(sizeW.value * 0.55, contentW.value * 0.12, 220);
    const travelPaddingY = Math.max(sizeH.value * 0.55, contentH.value * 0.12, 220);
    const maxOffsetX = Math.max(0, (contentW.value * nextScale - sizeW.value) / 2) + travelPaddingX;
    const maxOffsetY = Math.max(0, (contentH.value * nextScale - sizeH.value) / 2) + travelPaddingY;

    return {
      tx: Math.max(-maxOffsetX, Math.min(maxOffsetX, nextTx)),
      ty: Math.max(-maxOffsetY, Math.min(maxOffsetY, nextTy)),
    };
  };

  const animateTo = useCallback(
    (x: number, y: number, nextScale = 1) => {
      const clampedScale = Math.max(minScale, Math.min(maxScale, nextScale));
      const travelPaddingX = Math.max(size.w * 0.55, (contentWidth ?? size.w) * 0.12, 220);
      const travelPaddingY = Math.max(size.h * 0.55, (contentHeight ?? size.h) * 0.12, 220);
      const maxOffsetX =
        Math.max(0, (((contentWidth ?? size.w) * clampedScale) - size.w) / 2) + travelPaddingX;
      const maxOffsetY =
        Math.max(0, (((contentHeight ?? size.h) * clampedScale) - size.h) / 2) + travelPaddingY;
      const clampedOffsets = {
        tx: Math.max(-maxOffsetX, Math.min(maxOffsetX, -x * clampedScale)),
        ty: Math.max(-maxOffsetY, Math.min(maxOffsetY, -y * clampedScale)),
      };
      setTransformJS(clampedOffsets.tx, clampedOffsets.ty, clampedScale, true);
      tx.value = withTiming(clampedOffsets.tx, { duration: 220 });
      ty.value = withTiming(clampedOffsets.ty, { duration: 220 });
      scale.value = withTiming(clampedScale, { duration: 220 });
      setScaleJS(clampedScale, true);
    },
    [contentHeight, contentWidth, maxScale, minScale, scale, setScaleJS, setTransformJS, size.h, size.w, tx, ty]
  );

  useImperativeHandle(
    ref,
    () => ({
      centerOn: (x: number, y: number, nextScale = 1, screenOffsetX = 0, screenOffsetY = 0) => {
        const clampedScale = Math.max(minScale, Math.min(maxScale, nextScale));
        const worldOffsetX = screenOffsetX / clampedScale;
        const worldOffsetY = screenOffsetY / clampedScale;
        animateTo(x + worldOffsetX, y + worldOffsetY, clampedScale);
      },
      reset: () => {
        animateTo(0, 0, 1);
      },
      localToWorld: (localX: number, localY: number) => {
        const safeScale = transformRef.current.scale || 1;
        return {
          x: (localX - sizeRef.current.w / 2 - transformRef.current.tx) / safeScale,
          y: (localY - sizeRef.current.h / 2 - transformRef.current.ty) / safeScale,
        };
      },
    }),
    [animateTo, maxScale, minScale]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setSize({ w: width, h: height });
    sizeRef.current = { w: width, h: height };
    sizeW.value = width;
    sizeH.value = height;
    onTransformChange?.({
      ...transformRef.current,
      width,
      height,
    });
  };

  useEffect(() => {
    contentW.value = contentWidth ?? size.w;
    contentH.value = contentHeight ?? size.h;
  }, [contentH, contentHeight, contentW, contentWidth, size.h, size.w]);

  const pan = Gesture.Pan()
    .enabled(enabled)
    .minDistance(3)
    .maxPointers(1)
    .averageTouches(true)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      const movementFactor = 0.82;
      tx.value = startTx.value + e.translationX * movementFactor;
      ty.value = startTy.value + e.translationY * movementFactor;
      runOnJS(setTransformJS)(tx.value, ty.value, scale.value, false);
    })
    .onEnd(() => {
      const clamped = clampOffsets(tx.value, ty.value, scale.value);
      runOnJS(setTransformJS)(clamped.tx, clamped.ty, scale.value, true);
      tx.value = withTiming(clamped.tx, { duration: 180 });
      ty.value = withTiming(clamped.ty, { duration: 180 });
    })
    .onFinalize(() => {
      const clamped = clampOffsets(tx.value, ty.value, scale.value);
      runOnJS(setTransformJS)(clamped.tx, clamped.ty, scale.value, true);
      tx.value = withTiming(clamped.tx, { duration: 180 });
      ty.value = withTiming(clamped.ty, { duration: 180 });
    });

  const pinch = Gesture.Pinch()
    .enabled(enabled)
    .shouldCancelWhenOutside(false)
    .onBegin(() => {
      startScale.value = scale.value;
      startTx.value = tx.value;
      startTy.value = ty.value;
      if (onZoomGestureStart) {
        runOnJS(onZoomGestureStart)();
      }
    })
    .onUpdate((e) => {
      // A slightly amplified pinch curve makes zoom feel closer to native mind-map apps.
      let next = startScale.value * Math.pow(e.scale, 1.35);
      if (next < minScale) next = minScale;
      if (next > maxScale) next = maxScale;

      const cx = size.w / 2;
      const cy = size.h / 2;

      const fx = e.focalX;
      const fy = e.focalY;

      const s0 = startScale.value;
      const s1 = next;

      const t0x = startTx.value;
      const t0y = startTy.value;
      const focalShiftX = fx - cx;
      const focalShiftY = fy - cy;
      const nextTx = focalShiftX - ((focalShiftX - t0x) * s1) / s0;
      const nextTy = focalShiftY - ((focalShiftY - t0y) * s1) / s0;
      const clamped = clampOffsets(nextTx, nextTy, s1);
      tx.value = clamped.tx;
      ty.value = clamped.ty;

      scale.value = next;
      runOnJS(setTransformJS)(clamped.tx, clamped.ty, next, false);

      if (onScaleChange) runOnJS(setScaleJS)(next, false);
    })
    .onEnd(() => {
      if (onScaleChange) runOnJS(setScaleJS)(scale.value, true);
      runOnJS(setTransformJS)(tx.value, ty.value, scale.value, true);
      if (onZoomGestureEnd) {
        runOnJS(onZoomGestureEnd)();
      }
    })
    .onFinalize(() => {
      if (onZoomGestureEnd) {
        runOnJS(onZoomGestureEnd)();
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(enabled)
    .maxDuration(220)
    .maxDelay(260)
    .maxDistance(18)
    .shouldCancelWhenOutside(false)
    .onEnd(() => {
      if (onDoubleTap) {
        runOnJS(onDoubleTap)();
      } else {
        runOnJS(setTransformJS)(0, 0, 1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        scale.value = withTiming(1);
        if (onScaleChange) runOnJS(setScaleJS)(1, true);
      }
    });

  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));

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
        <View style={styles.gestureSurface}>
          <Animated.View style={[styles.content, animatedStyle]}>
            {children}
          </Animated.View>
          {tapEnabled && onTapPoint ? (
            <Pressable
              style={styles.tapOverlay}
              onPress={(event) => {
                onTapPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
              }}
            />
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
});

export default ZoomableCanvas;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  gestureSurface: {
    flex: 1,
  },
  tapOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
