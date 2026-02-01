import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Animated,
  PanResponder,
} from "react-native";
import { MindMapNode, NodeShape, EdgeStyle } from "../types/map";

type Props = {
  node: MindMapNode | null;
  nodes: Record<string, MindMapNode>;
  onClose: () => void;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
  onUpdateColor: (nodeId: string, color: string | undefined) => void;
  onHeight: (h: number) => void;
  onSelectNode: (nodeId: string) => void;
  onUpdateShape?: (nodeId: string, shape: NodeShape | undefined) => void;
  onUpdateEdge?: (
    nodeId: string,
    patch: { style?: EdgeStyle; width?: number; color?: string }
  ) => void;
};

const PALETTE = [
  "#38bdf8",
  "#22c55e",
  "#a855f7",
  "#f97316",
  "#ef4444",
  "#facc15",
  "#94a3b8",
  "#e5e7eb",
];

export default function NodeInspector({
  node,
  nodes,
  onClose,
  onUpdateTitle,
  onUpdateColor,
  onHeight,
  onSelectNode,
  onUpdateShape,
  onUpdateEdge,
}: Props) {
  const [draft, setDraft] = useState("");
  const [measuredH, setMeasuredH] = useState(0);

  const translateY = useRef(new Animated.Value(0)).current;
  const lastY = useRef(0);

  useEffect(() => {
    setDraft(node?.title ?? "");
    translateY.setValue(0);
    lastY.current = 0;
  }, [node?.id]);

  const parent = useMemo(() => {
    if (!node?.parentId) return null;
    return nodes[node.parentId] ?? null;
  }, [node?.parentId, nodes]);

  const children = useMemo(() => {
    if (!node) return [];
    return (node.children ?? [])
      .map((id) => nodes[id])
      .filter(Boolean) as MindMapNode[];
  }, [node, nodes]);

  const submit = () => {
    if (!node) return;
    const next = draft.trim();
    if (next && next !== node.title) onUpdateTitle(node.id, next);
  };

  const selectColor = (c: string) => {
    if (!node) return;
    onUpdateColor(node.id, c);
  };

  const clearColor = () => {
    if (!node) return;
    onUpdateColor(node.id, undefined);
  };

  const setShape = (shape: NodeShape) => {
    if (!node) return;
    onUpdateShape?.(node.id, shape);
  };

  const setEdgeStyle = (style: EdgeStyle) => {
    if (!node) return;
    onUpdateEdge?.(node.id, { style });
  };

  const bumpEdgeWidth = (delta: number) => {
    if (!node) return;
    const cur = typeof node.edgeToParent?.width === "number" ? node.edgeToParent.width : 2;
    const next = Math.max(1, Math.min(10, cur + delta));
    onUpdateEdge?.(node.id, { width: next });
  };

  const closeWithAnim = () => {
    const to = measuredH > 0 ? measuredH : 320;
    Animated.timing(translateY, {
      toValue: to,
      duration: 160,
      useNativeDriver: true,
    }).start(() => {
      translateY.setValue(0);
      lastY.current = 0;
      onClose();
    });
  };

  const snapBack = () => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start(() => {
      lastY.current = 0;
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        translateY.stopAnimation((v) => {
          lastY.current = typeof v === "number" ? v : 0;
        });
      },
      onPanResponderMove: (_, g) => {
        const next = Math.max(0, lastY.current + g.dy);
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const dragged = lastY.current + g.dy;
        const shouldClose =
          (measuredH > 0 && dragged > measuredH * 0.28) ||
          dragged > 120 ||
          g.vy > 1.25;

        if (shouldClose) closeWithAnim();
        else snapBack();
      },
      onPanResponderTerminate: () => {
        snapBack();
      },
    })
  ).current;

  if (!node) return null;

  return (
    <Animated.View
      style={[s.sheet, { transform: [{ translateY }] }]}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        setMeasuredH(h);
        onHeight(h);
      }}
      {...panResponder.panHandlers}
    >
      <View style={s.header}>
        <View style={s.grabber} />
        <Pressable
          onPress={closeWithAnim}
          style={({ pressed }) => [s.close, pressed && s.pressed]}
        >
          <Text style={s.closeText}>Close</Text>
        </Pressable>
      </View>

      <Text style={s.title}>Node</Text>

      <View style={s.row}>
        <Text style={s.label}>Name</Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={submit}
          onSubmitEditing={submit}
          style={s.input}
          placeholder="Node title"
          returnKeyType="done"
        />
      </View>

      <View style={s.row}>
        <Text style={s.label}>Color</Text>
        <View style={s.paletteWrap}>
          {PALETTE.map((c) => {
            const active = (node.color ?? "") === c;
            return (
              <Pressable
                key={c}
                onPress={() => selectColor(c)}
                style={({ pressed }) => [
                  s.swatch,
                  { backgroundColor: c },
                  active && s.swatchActive,
                  pressed && s.pressed,
                ]}
              />
            );
          })}
          <Pressable
            onPress={clearColor}
            style={({ pressed }) => [s.clearBtn, pressed && s.pressed]}
          >
            <Text style={s.clearText}>Default</Text>
          </Pressable>
        </View>
      </View>

      <View style={s.row}>
        <Text style={s.label}>ID</Text>
        <Text style={s.value}>{node.id}</Text>
      </View>

      <View style={s.row}>
        <Text style={s.label}>Parent</Text>
        {parent ? (
          <Pressable
            onPress={() => onSelectNode(parent.id)}
            style={({ pressed }) => [s.link, pressed && s.pressed]}
          >
            <Text style={s.linkText}>{parent.title}</Text>
          </Pressable>
        ) : (
          <Text style={s.value}>—</Text>
        )}
      </View>

      <View style={[s.row, { alignItems: "flex-start" }]}>
        <Text style={s.label}>Children</Text>
        <View style={s.childrenCol}>
          {children.length === 0 ? (
            <Text style={s.value}>—</Text>
          ) : (
            children.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => onSelectNode(c.id)}
                style={({ pressed }) => [s.link, pressed && s.pressed]}
              >
                <Text style={s.linkText}>{c.title}</Text>
              </Pressable>
            ))
          )}
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>Appearance</Text>

        <View style={s.row}>
          <Text style={s.label}>Shape</Text>
          <View style={s.pills}>
            {([
              { k: "circle", t: "Circle" },
              { k: "rounded", t: "Rounded" },
              { k: "capsule", t: "Capsule" },
            ] as const).map((it) => {
              const active = (node.shape ?? "circle") === it.k;
              return (
                <Pressable
                  key={it.k}
                  onPress={() => setShape(it.k)}
                  style={({ pressed }) => [
                    s.pill,
                    active && s.pillActive,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={[s.pillText, active && s.pillTextActive]}>
                    {it.t}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={s.row}>
          <Text style={s.label}>Line</Text>
          <View style={s.pills}>
            {([
              { k: "solid", t: "Solid" },
              { k: "dashed", t: "Dashed" },
            ] as const).map((it) => {
              const active = (node.edgeToParent?.style ?? "solid") === it.k;
              return (
                <Pressable
                  key={it.k}
                  onPress={() => setEdgeStyle(it.k)}
                  style={({ pressed }) => [
                    s.pill,
                    active && s.pillActive,
                    pressed && s.pressed,
                  ]}
                >
                  <Text style={[s.pillText, active && s.pillTextActive]}>
                    {it.t}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={s.row}>
          <Text style={s.label}>Width</Text>
          <View style={s.stepper}>
            <Pressable
              onPress={() => bumpEdgeWidth(-1)}
              style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}
            >
              <Text style={s.stepText}>−</Text>
            </Pressable>

            <Text style={s.stepValue}>
              {typeof node.edgeToParent?.width === "number" ? node.edgeToParent.width : 2}
            </Text>

            <Pressable
              onPress={() => bumpEdgeWidth(1)}
              style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}
            >
              <Text style={s.stepText}>＋</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 10,
  },
  header: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 4,
    backgroundColor: "#e5e7eb",
    marginBottom: 8,
  },
  close: {
    position: "absolute",
    right: 0,
    top: 0,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  closeText: {
    color: "#0ea5e9",
    fontWeight: "700",
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  label: {
    width: 70,
    fontSize: 13,
    color: "#64748b",
    fontWeight: "700",
  },
  value: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
  },
  input: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#111827",
  },
  paletteWrap: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  swatchActive: {
    borderWidth: 3,
    borderColor: "#111827",
  },
  clearBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f8fafc",
  },
  clearText: {
    fontSize: 12,
    color: "#111827",
    fontWeight: "700",
  },
  link: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
  },
  linkText: {
    fontSize: 13,
    color: "#0ea5e9",
    fontWeight: "800",
  },
  childrenCol: {
    flex: 1,
    gap: 6,
  },
  section: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 6,
  },
  pills: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  pillActive: {
    borderColor: "#111827",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#374151",
  },
  pillTextActive: {
    color: "#111827",
  },
  stepper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    marginTop: -1,
  },
  stepValue: {
    minWidth: 24,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
  },
  pressed: {
    opacity: 0.7,
  },
});

