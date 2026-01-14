import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { MindMapNode } from "../types/map";

type Props = {
  node: MindMapNode | null;
  nodes: Record<string, MindMapNode>;
  onClose: () => void;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
  onUpdateColor: (nodeId: string, color: string | undefined) => void;
  onHeight: (h: number) => void;
  onSelectNode: (nodeId: string) => void;
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
}: Props) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(node?.title ?? "");
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

  if (!node) return null;

  const submit = () => {
    const next = draft.trim();
    if (next && next !== node.title) onUpdateTitle(node.id, next);
  };

  const selectColor = (c: string) => {
    onUpdateColor(node.id, c);
  };

  const clearColor = () => {
    onUpdateColor(node.id, undefined);
  };

  return (
    <View
      style={s.sheet}
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
    >
      <View style={s.header}>
        <View style={s.grabber} />
        <Pressable onPress={onClose} style={({ pressed }) => [s.close, pressed && s.pressed]}>
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

      <View style={s.futureBox}>
        <Text style={s.futureTitle}>Future settings</Text>
        <Text style={s.futureText}>Placeholders for node options</Text>
      </View>
    </View>
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
  futureBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    padding: 12,
  },
  futureTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 4,
  },
  futureText: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.7,
  },
});