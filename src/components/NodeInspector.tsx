import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { MindMapNode } from "../types/map";

type Props = {
  node: MindMapNode | null;
  onClose: () => void;
  onUpdateTitle: (nodeId: string, newTitle: string) => void;
  onHeight?: (h: number) => void;
};

export default function NodeInspector({ node, onClose, onUpdateTitle, onHeight }: Props) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(node?.title ?? "");
  }, [node?.id, node?.title]);

  if (!node) return null;

  const submit = () => {
    const next = draft.trim() || node.title;
    onUpdateTitle(node.id, next);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.wrapper}
    >
      <View
        style={styles.sheet}
        onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      >
        <View style={styles.topRow}>
          <View style={styles.handle} />
        </View>

        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Node</Text>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            onBlur={submit}
            style={styles.input}
            placeholder="Node title"
            returnKeyType="done"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Node settings</Text>

          <View style={styles.placeholderBox}>
            <View style={styles.placeholderRow}>
              <Text style={styles.placeholderLabel}>Color</Text>
              <Text style={styles.placeholderValue}>Soon</Text>
            </View>
            <View style={styles.placeholderRow}>
              <Text style={styles.placeholderLabel}>Icon</Text>
              <Text style={styles.placeholderValue}>Soon</Text>
            </View>
            <View style={styles.placeholderRowNoBorder}>
              <Text style={styles.placeholderLabel}>Notes</Text>
              <Text style={styles.placeholderValue}>Soon</Text>
            </View>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 10,
  },
  topRow: {
    alignItems: "center",
    paddingBottom: 6,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  closeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  pressed: {
    opacity: 0.6,
  },
  section: {
    gap: 8,
    paddingTop: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(17,24,39,0.75)",
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.12)",
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(17,24,39,0.75)",
  },
  placeholderBox: {
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(0,0,0,0.02)",
  },
  placeholderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
  },
  placeholderRowNoBorder: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  placeholderLabel: {
    fontSize: 13,
    color: "#111827",
    fontWeight: "600",
  },
  placeholderValue: {
    fontSize: 13,
    color: "rgba(17,24,39,0.45)",
    fontWeight: "600",
  },
});