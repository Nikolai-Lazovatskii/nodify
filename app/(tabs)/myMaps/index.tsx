import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Keyboard,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { exportToMm } from "@/src/export/mm";
import {
  deleteMap,
  exportMapXmind,
  getMap,
  listMaps,
  renameMap,
} from "@/src/storage/mapsRepo";

type MapMeta = {
  id: string;
  title: string;
  updatedAt?: number;
};

export default function MyMapsIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<MapMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string>("");

  const [exportId, setExportId] = useState<string | null>(null);
  const [pendingExportId, setPendingExportId] = useState<string | null>(null);
  const [pendingExportKind, setPendingExportKind] = useState<"mm" | "xmind" | null>(null);

  const exportVisible = exportId != null;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMaps();
      setItems(list as MapMeta[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const openMap = useCallback(
    (id: string) => {
      router.push({
        pathname: "/(tabs)/myMaps/[id]" as any,
        params: { id },
      });
    },
    [router]
  );

  const onDelete = useCallback(
    (id: string) => {
      Alert.alert("Delete mind map?", "This action cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteMap(id);
            await reload();
          },
        },
      ]);
    },
    [reload]
  );

  const startEdit = useCallback(
    (id: string, currentTitle: string) => {
      setEditingId(id);
      setDraftTitle((currentTitle || "Untitled").trim() || "Untitled");
    },
    []
  );

  const stopEdit = useCallback(() => {
    setEditingId(null);
    setDraftTitle("");
    Keyboard.dismiss();
  }, []);

  const commitRename = useCallback(
    async (id: string, fallbackTitle: string) => {
      const next = (draftTitle || "").trim();
      const safe = next.length ? next : (fallbackTitle || "Untitled").trim() || "Untitled";

      stopEdit();

      const prev = (fallbackTitle || "").trim();
      if (prev === safe) return;

      await renameMap(id, safe);
      await reload();
    },
    [draftTitle, reload, stopEdit]
  );

  const doExportMm = useCallback(async (id: string) => {
    try {
      const map = await getMap(id);
      if (!map) {
        Alert.alert("Export failed", "Map not found.");
        return;
      }

      const xml = exportToMm(map);

      const safeName = (map.title || "mind-map")
        .replace(/[\\/:*?"<>|]/g, "-")
        .trim()
        .slice(0, 60);

      const baseDir = FileSystem.documentDirectory;
      if (!baseDir) {
        Alert.alert("Export failed", "File system directory is not available.");
        return;
      }

      const uri = `${baseDir}${safeName}-${id}.mm`;

      await FileSystem.writeAsStringAsync(uri, xml, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "text/xml",
          dialogTitle: "Export mind map",
          UTI: "public.xml",
        });
      } else {
        Alert.alert("Export ready", `Saved to:\n${uri}`);
      }
    } catch (e: any) {
      Alert.alert("Export failed", e?.message ? String(e.message) : String(e));
    }
  }, []);

  const headerPadTop = Math.max(insets.top, 12);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [items]);

  const runPendingExport = useCallback(() => {
    const id = pendingExportId;
    const kind = pendingExportKind;
    if (!id || !kind) return;

    setPendingExportId(null);
    setPendingExportKind(null);

    InteractionManager.runAfterInteractions(() => {
      if (kind === "mm") {
        doExportMm(id);
      } else {
        exportMapXmind(id).catch((e: any) => {
          Alert.alert(
            "Export failed",
            e?.message ? String(e.message) : String(e)
          );
        });
      }
    });
  }, [doExportMm, exportMapXmind, pendingExportId, pendingExportKind]);

  return (
    <View style={s.screen}>
      <View style={[s.header, { paddingTop: headerPadTop }]}>
        <Text style={s.headerTitle}>My mind maps</Text>
      </View>

      <FlatList
        contentContainerStyle={s.listContent}
        data={sortedItems}
        keyExtractor={(it) => it.id}
        refreshing={loading}
        onRefresh={reload}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>No maps yet</Text>
              <Text style={s.emptyText}>Create one using the Create tab.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openMap(item.id)}
            style={({ pressed }) => [s.card, pressed && s.pressed]}
          >
            <View style={s.cardTop}>
              <Pressable
                style={s.titlePress}
                onPress={() => {
                  if (editingId === item.id) return;
                  startEdit(item.id, item.title || "Untitled");
                }}
              >
                {editingId === item.id ? (
                  <TextInput
                    value={draftTitle}
                    onChangeText={setDraftTitle}
                    autoFocus
                    selectTextOnFocus
                    style={s.titleInput}
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={() => commitRename(item.id, item.title || "Untitled")}
                    onBlur={() => commitRename(item.id, item.title || "Untitled")}
                    autoCorrect={false}
                    autoCapitalize="sentences"
                    maxLength={80}
                  />
                ) : (
                  <Text style={s.title} numberOfLines={1}>
                    {item.title || "Untitled"}
                  </Text>
                )}
              </Pressable>

              <Text style={s.meta}>
                {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ""}
              </Text>
            </View>

            <View style={s.actionsRow}>
              <Pressable
                onPress={() => openMap(item.id)}
                style={({ pressed }) => [s.actionBtn, pressed && s.pressedBtn]}
              >
                <Text style={s.actionText}>Open</Text>
              </Pressable>

              <Pressable
                onPress={() => setExportId(item.id)}
                style={({ pressed }) => [s.actionBtn, pressed && s.pressedBtn]}
              >
                <Text style={s.actionText}>Export</Text>
              </Pressable>

              <Pressable
                onPress={() => onDelete(item.id)}
                style={({ pressed }) => [
                  s.actionBtn,
                  s.dangerBtn,
                  pressed && s.pressedBtn,
                ]}
              >
                <Text style={[s.actionText, s.dangerText]}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />

      <Modal
        visible={exportVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setExportId(null)}
        onDismiss={() => {
          // iOS: вызывается после полного закрытия модалки
          runPendingExport();
        }}
      >
        <Pressable style={sheet.backdrop} onPress={() => setExportId(null)} />

        <View style={sheet.panel}>
          <Text style={sheet.title}>Export format</Text>

          <Pressable
            style={({ pressed }) => [sheet.option, pressed && sheet.pressed]}
            onPress={() => {
              const id = exportId;
              if (!id) return;

              setPendingExportKind("mm");
              setPendingExportId(id);
              setExportId(null);

              if (Platform.OS !== "ios") {
                setTimeout(() => {
                  runPendingExport();
                }, 200);
              }
            }}
          >
            <Text style={sheet.optionText}>.mm (FreeMind)</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [sheet.option, pressed && sheet.pressed]}
            onPress={() => {
              const id = exportId;
              if (!id) return;

              setPendingExportKind("xmind");
              setPendingExportId(id);
              setExportId(null);

              if (Platform.OS !== "ios") {
                setTimeout(() => {
                  runPendingExport();
                }, 200);
              }
            }}
          >
            <Text style={sheet.optionText}>.xmind (XMind)</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              sheet.option,
              sheet.cancel,
              pressed && sheet.pressed,
            ]}
            onPress={() => setExportId(null)}
          >
            <Text style={[sheet.optionText, sheet.cancelText]}>Cancel</Text>
          </Pressable>

          <View style={{ height: Platform.OS === "ios" ? insets.bottom : 0 }} />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
    backgroundColor: "#ffffff",
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  listContent: { padding: 16, paddingBottom: 24, gap: 12 },
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    borderRadius: 14,
    padding: 14,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  cardTop: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  titlePress: {
    flex: 1,
    minHeight: 34,
    justifyContent: "center",
  },
  titleInput: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.14)",
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.03)",
  },
  title: { flex: 1, fontSize: 16, fontWeight: "800", color: "#0f172a" },
  meta: { fontSize: 12, color: "rgba(15,23,42,0.55)", fontWeight: "600" },
  actionsRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,132,199,0.10)",
    borderWidth: 1,
    borderColor: "rgba(2,132,199,0.18)",
  },
  actionText: { fontSize: 13, fontWeight: "800", color: "#0369a1" },
  dangerBtn: {
    backgroundColor: "rgba(239,68,68,0.10)",
    borderColor: "rgba(239,68,68,0.20)",
  },
  dangerText: { color: "#b91c1c" },
  pressedBtn: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  empty: { paddingTop: 24, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  emptyText: { fontSize: 13, color: "rgba(15,23,42,0.6)", fontWeight: "600" },
});

const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  panel: {
    padding: 14,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  title: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  option: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    backgroundColor: "#ffffff",
  },
  optionText: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  cancel: { backgroundColor: "rgba(0,0,0,0.04)" },
  cancelText: { color: "rgba(15,23,42,0.8)" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});