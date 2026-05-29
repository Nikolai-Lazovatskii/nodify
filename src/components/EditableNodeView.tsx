/**
 * Súbor: src/components/EditableNodeView.tsx
 * Abstrakt: Zobrazuje a upravuje jeden uzol mapy vrátane interakcií a lokálneho vstupu.
 */
import React, { memo, useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { MaterialIcons } from "@expo/vector-icons";

import { MindMapNode, NodeShape } from "../types/map";
import {
  getDisplayNodeTitle,
  getNodeImageAttachment,
  NODE_IMAGE_THUMB_SIZE,
} from "../screens/mapScreen/routing";

type Props = {
  node: MindMapNode;
  worldWidth: number;
  worldHeight: number;
  isRoot?: boolean;
  selected?: boolean;
  shape?: NodeShape;
  placementMode?: boolean;
  onSelect: (nodeId: string) => void;
  linkMode?: boolean;
  onSelectLinkTarget?: (nodeId: string) => void;
  changeParentMode?: boolean;
  onSelectChangeParentTarget?: (nodeId: string) => void;
  onStartReposition?: (nodeId: string) => void;
};

function EditableNodeView({
  node,
  worldWidth,
  worldHeight,
  isRoot = false,
  selected = false,
  shape = "circle",
  placementMode = false,
  onSelect,
  linkMode = false,
  onSelectLinkTarget,
  changeParentMode = false,
  onSelectChangeParentTarget,
  onStartReposition,
}: Props) {
  const shake = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!placementMode) {
      animationRef.current?.stop();
      shake.setValue(0);
      return;
    }

    animationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(shake, {
          toValue: 1,
          duration: 70,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(shake, {
          toValue: -1,
          duration: 70,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(shake, {
          toValue: 0,
          duration: 70,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    animationRef.current.start();

    return () => {
      animationRef.current?.stop();
      shake.setValue(0);
    };
  }, [placementMode, shake]);

  const handlePress = () => {
    if (placementMode) {
      return;
    }

    if (linkMode && onSelectLinkTarget) {
      onSelectLinkTarget(node.id);
      return;
    }

    if (changeParentMode && onSelectChangeParentTarget) {
      onSelectChangeParentTarget(node.id);
      return;
    }

    onSelect(node.id);
  };

  const handleLongPress = () => {
    if (linkMode || changeParentMode || placementMode || !onStartReposition) {
      return;
    }

    onStartReposition(node.id);
    Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)).catch(() => {});
  };

  const baseR = Math.max(isRoot ? 42 : 30, node.size ?? (isRoot ? 42 : 30));
  const fontSize = Math.max(12, Math.round(baseR * (isRoot ? 0.45 : 0.38)));
  const textPaddingX = isRoot ? 22 : 18;
  const approxCharW = fontSize * 0.6;
  const displayTitle = getDisplayNodeTitle(node.title);
  const textW = Math.max(24, displayTitle.length * approxCharW);
  const imageAttachment = getNodeImageAttachment(node);
  const hasMeta = !!node.note || !!node.dueAt || (node.attachments ?? []).length > 0 || (node.tags ?? []).length > 0;
  const width = Math.max(
    baseR * (isRoot ? 2.8 : 2.65),
    textW + textPaddingX * 2 + (imageAttachment ? NODE_IMAGE_THUMB_SIZE + 6 : 0),
    hasMeta ? 112 : 0
  );
  const height = baseR * (hasMeta ? 2.35 : 2.1);
  const left = worldWidth / 2 + node.x - width / 2;
  const top = worldHeight / 2 + node.y - height / 2;
  const fillDefault = isRoot ? "#0ea5e9" : "#ffffff";
  const fill = node.color ?? fillDefault;
  const isCircle = shape === "circle";
  const hasCollapsedChildren = !!node.collapsed && node.children.length > 0;
  const attachmentCount = node.attachments?.length ?? 0;
  const textColor = isRoot && !node.color ? "#ffffff" : "#0f172a";

  const animatedStyle = useMemo(
    () => ({
      transform: placementMode
        ? [
            {
              rotate: shake.interpolate({
                inputRange: [-1, 0, 1],
                outputRange: ["-2deg", "0deg", "2deg"],
              }),
            },
            {
              translateX: shake.interpolate({
                inputRange: [-1, 0, 1],
                outputRange: [-1.5, 0, 1.5],
              }),
            },
            { scale: 1.04 },
          ]
        : [{ scale: selected ? 1.02 : 1 }],
    }),
    [placementMode, selected, shake]
  );

  return (
    <Animated.View
      style={[
        styles.wrapper,
        animatedStyle,
        {
          left,
          top,
          width,
          height,
          zIndex: placementMode ? 40 : selected ? 20 : 10,
        },
      ]}
    >
      <Pressable
        onPress={handlePress}
        onLongPress={handleLongPress}
        delayLongPress={240}
        style={({ pressed }) => [
          styles.nodeBase,
          isCircle ? styles.circle : styles.rounded,
          shape === "capsule" ? { borderRadius: height / 2 } : null,
          isRoot && styles.rootNode,
          selected && styles.selectedNode,
          {
            width,
            height,
            backgroundColor: fill,
            borderColor: placementMode ? "#f59e0b" : selected ? "#0284c7" : "rgba(255,255,255,0.78)",
            opacity: pressed && !placementMode ? 0.9 : 1,
          },
        ]}
      >
        <View style={styles.titleRow}>
          {imageAttachment ? (
            <View style={styles.imageThumb}>
              <MaterialIcons name="image" size={13} color={isRoot ? "#e0f2fe" : "#0369a1"} />
            </View>
          ) : null}
          <Text numberOfLines={1} style={[styles.label, { fontSize, color: textColor }]}>
            {displayTitle}
          </Text>
        </View>
        {hasMeta ? (
          <View style={styles.metaRow}>
            {node.dueAt ? (
              <View style={[styles.metaPill, isRoot && styles.metaPillRoot]}>
                <MaterialIcons name="event" size={11} color={isRoot ? "#e0f2fe" : "#0369a1"} />
              </View>
            ) : null}
            {attachmentCount > 0 ? (
              <View style={[styles.metaPill, isRoot && styles.metaPillRoot]}>
                <MaterialIcons name="attach-file" size={11} color={isRoot ? "#e0f2fe" : "#0369a1"} />
                <Text style={[styles.metaText, isRoot && styles.metaTextRoot]}>{attachmentCount}</Text>
              </View>
            ) : null}
            {node.note ? (
              <View style={[styles.metaPill, isRoot && styles.metaPillRoot]}>
                <MaterialIcons name="notes" size={11} color={isRoot ? "#e0f2fe" : "#0369a1"} />
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      {hasCollapsedChildren ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>+</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

export default memo(EditableNodeView, (prev, next) => {
  return (
    prev.node === next.node &&
    prev.worldWidth === next.worldWidth &&
    prev.worldHeight === next.worldHeight &&
    prev.isRoot === next.isRoot &&
    prev.selected === next.selected &&
    prev.shape === next.shape &&
    prev.placementMode === next.placementMode &&
    prev.linkMode === next.linkMode &&
    prev.changeParentMode === next.changeParentMode &&
    prev.onSelect === next.onSelect &&
    prev.onSelectLinkTarget === next.onSelectLinkTarget &&
    prev.onSelectChangeParentTarget === next.onSelectChangeParentTarget &&
    prev.onStartReposition === next.onStartReposition
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  nodeBase: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    paddingHorizontal: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  rootNode: {
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 10,
  },
  selectedNode: {
    shadowColor: "#0284c7",
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 12,
  },
  circle: {
    borderRadius: 999,
  },
  rounded: {
    borderRadius: 18,
  },
  label: {
    fontWeight: "800",
    textAlign: "center",
    includeFontPadding: false,
    letterSpacing: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    maxWidth: "100%",
  },
  imageThumb: {
    width: NODE_IMAGE_THUMB_SIZE,
    height: NODE_IMAGE_THUMB_SIZE,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.08)",
  },
  metaRow: {
    position: "absolute",
    bottom: 8,
    flexDirection: "row",
    gap: 4,
  },
  metaPill: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: "rgba(224,242,254,0.92)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 1,
  },
  metaPillRoot: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  metaText: {
    color: "#0369a1",
    fontSize: 9,
    fontWeight: "900",
  },
  metaTextRoot: {
    color: "#e0f2fe",
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 10,
    lineHeight: 10,
    fontWeight: "700",
  },
});
