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
  useWindowDimensions,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/i18n/LanguagePreference";

import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { exportToMm } from "@/src/export/mm";
import { importFromMm } from "@/src/import/mm";
import { importFromXmind } from "@/src/import/xmind";
import {
  createMap,
  deleteMap,
  exportMapXmind,
  getMap,
  listMaps,
  renameMap,
  saveMap,
} from "@/src/storage/mapsRepo";

type MapMeta = {
  id: string;
  title: string;
  updatedAt?: number;
};

export default function MyMapsIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [items, setItems] = useState<MapMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string>("");

  const [exportId, setExportId] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [pendingImportKind, setPendingImportKind] = useState<"mm" | "xmind" | null>(null);
  const [pendingExportId, setPendingExportId] = useState<string | null>(null);
  const [pendingExportKind, setPendingExportKind] = useState<"mm" | "xmind" | null>(null);

  const exportVisible = exportId != null;
  const horizontalInset = isLandscape
    ? 16 + Math.max(insets.left, insets.right)
    : 16;

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
      Alert.alert(t("maps.deleteMindMap"), t("maps.actionCannotBeUndone"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            await deleteMap(id);
            await reload();
          },
        },
      ]);
    },
    [reload, t]
  );

  const startEdit = useCallback(
    (id: string, currentTitle: string) => {
      setEditingId(id);
      setDraftTitle((currentTitle || t("common.untitled")).trim() || t("common.untitled"));
    },
    [t]
  );

  const stopEdit = useCallback(() => {
    setEditingId(null);
    setDraftTitle("");
    Keyboard.dismiss();
  }, []);

  const commitRename = useCallback(
    async (id: string, fallbackTitle: string) => {
      const next = (draftTitle || "").trim();
      const safe = next.length ? next : (fallbackTitle || t("common.untitled")).trim() || t("common.untitled");

      stopEdit();

      const prev = (fallbackTitle || "").trim();
      if (prev === safe) return;

      await renameMap(id, safe);
      await reload();
    },
    [draftTitle, reload, stopEdit, t]
  );

  const doExportMm = useCallback(async (id: string) => {
    try {
      const map = await getMap(id);
      if (!map) {
        Alert.alert(t("maps.exportFailed"), t("maps.mapNotFound"));
        return;
      }

      const xml = exportToMm(map);

      const safeName = (map.title || "mind-map")
        .replace(/[\\/:*?"<>|]/g, "-")
        .trim()
        .slice(0, 60);

      const baseDir = FileSystem.documentDirectory;
      if (!baseDir) {
        Alert.alert(t("maps.exportFailed"), t("maps.fileSystemUnavailable"));
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
          dialogTitle: t("maps.exportMindMap"),
          UTI: "public.xml",
        });
      } else {
        Alert.alert(t("maps.exportReady"), t("maps.savedTo", { uri }));
      }
    } catch (e: any) {
      Alert.alert(t("maps.exportFailed"), e?.message ? String(e.message) : String(e));
    }
  }, [t]);

  const importMm = useCallback(async () => {
    try {
      const picked = await File.pickFileAsync(undefined, "text/xml");
      const pickedFile = Array.isArray(picked) ? picked[0] : picked;
      if (!pickedFile) {
        return;
      }

      const xml = await pickedFile.text();
      const uriParts = pickedFile.uri.split("/");
      const fileName = uriParts[uriParts.length - 1] || `${t("maps.importedMindMap")}.mm`;
      const fallbackTitle = fileName.replace(/\.mm$/i, "");
      const importedFallbackTitle = fallbackTitle || t("maps.importedMindMap");
      const importedMap = await importFromMm(xml, importedFallbackTitle);
      const created = await createMap(importedMap.title || importedFallbackTitle, t("create.root"));
      const mapToSave = {
        ...importedMap,
        id: created.id,
        title: importedMap.title || importedFallbackTitle,
      };

      await saveMap(mapToSave);
      await reload();

      Alert.alert(t("maps.importComplete"), t("maps.mmImportedSuccessfully"), [
        {
          text: t("common.open"),
          onPress: () => openMap(created.id),
        },
        { text: t("common.later"), style: "cancel" },
      ]);
    } catch (e: any) {
      const message = e?.message ? String(e.message) : String(e);
      if (message.toLowerCase().includes("cancel")) {
        return;
      }

      Alert.alert(t("maps.importFailed"), message);
    }
  }, [openMap, reload, t]);

  const importXmind = useCallback(async () => {
    try {
      const picked = await File.pickFileAsync(undefined, "application/octet-stream");
      const pickedFile = Array.isArray(picked) ? picked[0] : picked;
      if (!pickedFile) {
        return;
      }

      const zipBase64 = await pickedFile.base64();
      const uriParts = pickedFile.uri.split("/");
      const fileName = uriParts[uriParts.length - 1] || `${t("maps.importedXmindMap")}.xmind`;
      const fallbackTitle = fileName.replace(/\.xmind$/i, "");
      const importedFallbackTitle = fallbackTitle || t("maps.importedXmindMap");
      const importedMap = await importFromXmind(zipBase64, importedFallbackTitle);
      const created = await createMap(importedMap.title || importedFallbackTitle, t("create.root"));
      const mapToSave = {
        ...importedMap,
        id: created.id,
        title: importedMap.title || importedFallbackTitle,
      };

      await saveMap(mapToSave);
      await reload();

      Alert.alert(t("maps.importComplete"), t("maps.xmindImportedSuccessfully"), [
        {
          text: t("common.open"),
          onPress: () => openMap(created.id),
        },
        { text: t("common.later"), style: "cancel" },
      ]);
    } catch (e: any) {
      const message = e?.message ? String(e.message) : String(e);
      if (message.toLowerCase().includes("cancel")) {
        return;
      }

      Alert.alert(t("maps.importFailed"), message);
    }
  }, [openMap, reload, t]);

  const headerPadTop = isLandscape ? 12 : Math.max(insets.top, 12);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [items]);

  const numColumns = isLandscape ? 2 : 1;

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
        exportMapXmind(id, t("maps.exportXmind")).catch((e: any) => {
          Alert.alert(
            t("maps.exportFailed"),
            e?.message ? String(e.message) : String(e)
          );
        });
      }
    });
  }, [doExportMm, pendingExportId, pendingExportKind, t]);

  const runPendingImport = useCallback(() => {
    const kind = pendingImportKind;
    if (!kind) return;

    setPendingImportKind(null);

    InteractionManager.runAfterInteractions(() => {
      if (kind === "mm") {
        importMm();
      } else {
        importXmind();
      }
    });
  }, [importMm, importXmind, pendingImportKind]);

  return (
    <View style={[s.screen, isDark && s.screenDark]}>
      <View
        style={[
          s.header,
          isDark && s.headerDark,
          {
            paddingTop: headerPadTop,
            paddingLeft: horizontalInset,
            paddingRight: horizontalInset,
          },
        ]}
      >
        <View style={s.headerRow}>
          <Text style={[s.headerTitle, isDark && s.headerTitleDark]}>{t("maps.title")}</Text>
          <Pressable onPress={() => setImportVisible(true)} style={({ pressed }) => [s.importButton, pressed && s.pressedBtn]}>
            <Text style={s.importButtonText}>{t("maps.import")}</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        key={`mymaps-${numColumns}`}
        contentContainerStyle={[
          s.listContent,
          isLandscape && s.listContentLandscape,
          {
            paddingLeft: horizontalInset,
            paddingRight: horizontalInset,
            paddingBottom: Math.max(insets.bottom, 24),
          },
        ]}
        data={sortedItems}
        keyExtractor={(it) => it.id}
        refreshing={loading}
        onRefresh={reload}
        numColumns={numColumns}
        columnWrapperStyle={isLandscape ? s.columns : undefined}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={[s.emptyTitle, isDark && s.emptyTitleDark]}>{t("maps.noMaps")}</Text>
              <Text style={[s.emptyText, isDark && s.emptyTextDark]}>{t("maps.createOneUsingCreate")}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openMap(item.id)}
            style={({ pressed }) => [s.card, isDark && s.cardDark, isLandscape && s.cardLandscape, pressed && s.pressed]}
          >
            <View style={s.cardTop}>
              <Pressable
                style={s.titlePress}
                onPress={() => {
                  if (editingId === item.id) return;
                  startEdit(item.id, item.title || t("common.untitled"));
                }}
              >
                {editingId === item.id ? (
                  <TextInput
                    value={draftTitle}
                    onChangeText={setDraftTitle}
                    autoFocus
                    selectTextOnFocus
                    style={[s.titleInput, isDark && s.titleInputDark]}
                    returnKeyType="done"
                    blurOnSubmit
                    onSubmitEditing={() => commitRename(item.id, item.title || t("common.untitled"))}
                    onBlur={() => commitRename(item.id, item.title || t("common.untitled"))}
                    autoCorrect={false}
                    autoCapitalize="sentences"
                    maxLength={80}
                  />
                ) : (
                  <Text style={[s.title, isDark && s.titleDark]} numberOfLines={1}>
                    {item.title || t("common.untitled")}
                  </Text>
                )}
              </Pressable>

              <Text style={[s.meta, isDark && s.metaDark]}>
                {item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : ""}
              </Text>
            </View>

            <View style={s.actionsRow}>
              <Pressable
                onPress={() => openMap(item.id)}
                style={({ pressed }) => [s.actionBtn, isDark && s.actionBtnDark, pressed && s.pressedBtn]}
              >
                <Text style={[s.actionText, isDark && s.actionTextDark]}>{t("maps.open")}</Text>
              </Pressable>

              <Pressable
                onPress={() => setExportId(item.id)}
                style={({ pressed }) => [s.actionBtn, isDark && s.actionBtnDark, pressed && s.pressedBtn]}
              >
                <Text style={[s.actionText, isDark && s.actionTextDark]}>{t("maps.export")}</Text>
              </Pressable>

              <Pressable
                onPress={() => onDelete(item.id)}
                style={({ pressed }) => [
                  s.actionBtn,
                  s.dangerBtn,
                  pressed && s.pressedBtn,
                ]}
              >
                <Text style={[s.actionText, s.dangerText]}>{t("maps.delete")}</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />

      <Modal
        visible={importVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setImportVisible(false)}
        onDismiss={() => {
          runPendingImport();
        }}
      >
        <Pressable style={sheet.backdrop} onPress={() => setImportVisible(false)} />

        <View style={[sheet.panel, isDark && sheet.panelDark]}>
          <Text style={[sheet.title, isDark && sheet.titleDark]}>{t("maps.importFormat")}</Text>

          <Pressable
            style={({ pressed }) => [sheet.option, isDark && sheet.optionDark, pressed && sheet.pressed]}
            onPress={() => {
              setPendingImportKind("mm");
              setImportVisible(false);

              if (Platform.OS !== "ios") {
                setTimeout(() => {
                  runPendingImport();
                }, 200);
              }
            }}
          >
            <Text style={[sheet.optionText, isDark && sheet.optionTextDark]}>{t("maps.freeMind")}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [sheet.option, isDark && sheet.optionDark, pressed && sheet.pressed]}
            onPress={() => {
              setPendingImportKind("xmind");
              setImportVisible(false);

              if (Platform.OS !== "ios") {
                setTimeout(() => {
                  runPendingImport();
                }, 200);
              }
            }}
          >
            <Text style={[sheet.optionText, isDark && sheet.optionTextDark]}>{t("maps.xmind")}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              sheet.option,
              sheet.cancel,
              isDark && sheet.cancelDark,
              pressed && sheet.pressed,
            ]}
            onPress={() => setImportVisible(false)}
          >
            <Text style={[sheet.optionText, isDark && sheet.optionTextDark, sheet.cancelText, isDark && sheet.cancelTextDark]}>{t("common.cancel")}</Text>
          </Pressable>

          <View style={{ height: Platform.OS === "ios" ? insets.bottom : 0 }} />
        </View>
      </Modal>

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

        <View style={[sheet.panel, isDark && sheet.panelDark]}>
          <Text style={[sheet.title, isDark && sheet.titleDark]}>{t("maps.exportFormat")}</Text>

          <Pressable
            style={({ pressed }) => [sheet.option, isDark && sheet.optionDark, pressed && sheet.pressed]}
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
            <Text style={[sheet.optionText, isDark && sheet.optionTextDark]}>{t("maps.freeMind")}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [sheet.option, isDark && sheet.optionDark, pressed && sheet.pressed]}
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
            <Text style={[sheet.optionText, isDark && sheet.optionTextDark]}>{t("maps.xmind")}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              sheet.option,
              sheet.cancel,
              isDark && sheet.cancelDark,
              pressed && sheet.pressed,
            ]}
            onPress={() => setExportId(null)}
          >
            <Text style={[sheet.optionText, isDark && sheet.optionTextDark, sheet.cancelText, isDark && sheet.cancelTextDark]}>{t("common.cancel")}</Text>
          </Pressable>

          <View style={{ height: Platform.OS === "ios" ? insets.bottom : 0 }} />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  screenDark: { backgroundColor: "#0f172a" },
  header: {
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.06)",
    backgroundColor: "#ffffff",
  },
  headerDark: {
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0f172a",
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  headerTitleDark: { color: "#f8fafc" },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  importButton: {
    minWidth: 108,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0ea5e9",
  },
  importButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#ffffff",
  },
  listContent: { paddingTop: 16, gap: 12 },
  listContentLandscape: { paddingTop: 14 },
  columns: { gap: 12 },
  card: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    borderRadius: 14,
    padding: 14,
  },
  cardDark: {
    backgroundColor: "#111827",
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardLandscape: {
    // keeps cards visually balanced in 2 columns
    minHeight: 118,
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
  titleInputDark: {
    color: "#f8fafc",
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  title: { flex: 1, fontSize: 16, fontWeight: "800", color: "#0f172a" },
  titleDark: { color: "#f8fafc" },
  meta: { fontSize: 12, color: "rgba(15,23,42,0.55)", fontWeight: "600" },
  metaDark: { color: "rgba(226,232,240,0.65)" },
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
  actionBtnDark: {
    backgroundColor: "rgba(14,165,233,0.12)",
    borderColor: "rgba(56,189,248,0.28)",
  },
  actionText: { fontSize: 13, fontWeight: "800", color: "#0369a1" },
  actionTextDark: { color: "#7dd3fc" },
  dangerBtn: {
    backgroundColor: "rgba(239,68,68,0.10)",
    borderColor: "rgba(239,68,68,0.20)",
  },
  dangerText: { color: "#b91c1c" },
  pressedBtn: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  empty: { paddingTop: 24, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  emptyTitleDark: { color: "#f8fafc" },
  emptyText: { fontSize: 13, color: "rgba(15,23,42,0.6)", fontWeight: "600" },
  emptyTextDark: { color: "#94a3b8" },
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
  panelDark: {
    backgroundColor: "#111827",
    borderColor: "rgba(255,255,255,0.08)",
  },
  title: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 10 },
  titleDark: { color: "#f8fafc" },
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
  optionDark: {
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "#0f172a",
  },
  optionText: { fontSize: 15, fontWeight: "800", color: "#0f172a" },
  optionTextDark: { color: "#f8fafc" },
  cancel: { backgroundColor: "rgba(0,0,0,0.04)" },
  cancelDark: { backgroundColor: "rgba(255,255,255,0.06)" },
  cancelText: { color: "rgba(15,23,42,0.8)" },
  cancelTextDark: { color: "#cbd5e1" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
