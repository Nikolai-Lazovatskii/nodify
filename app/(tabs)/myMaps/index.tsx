/**
 * Súbor: app/(tabs)/myMaps/index.tsx
 * Abstrakt: Zobrazuje zoznam máp, import, export, mazanie, synchronizačné stavy a lokálne indikátory.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  InteractionManager,
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
import { useAuth } from "@/src/auth/AuthProvider";
import { useTranslation } from "@/src/lang/LanguagePreference";
import { MaterialIcons } from "@expo/vector-icons";

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
  listLocalMaps,
  listMaps,
  renameMap,
  saveMap,
} from "@/src/storage/mapsRepo";
import type { MapMeta } from "@/src/types/map";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function MyMapsIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const {
    user,
    loading: authLoading,
    syncing,
    isOnline,
    pendingSyncCount,
    lastSyncAt,
    syncNow,
  } = useAuth();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [items, setItems] = useState<MapMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [listSyncing, setListSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [syncToastVisible, setSyncToastVisible] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string>("");

  const [exportId, setExportId] = useState<string | null>(null);
  const [importVisible, setImportVisible] = useState(false);
  const [pendingImportKind, setPendingImportKind] = useState<"mm" | "xmind" | null>(null);
  const [pendingExportId, setPendingExportId] = useState<string | null>(null);
  const [pendingExportKind, setPendingExportKind] = useState<"mm" | "xmind" | null>(null);

  const exportVisible = exportId != null;
  const horizontalInsetLeft = isLandscape ? Math.max(insets.left, 0) + 6 : 16;
  const horizontalInsetRight = isLandscape ? Math.max(insets.right, 0) + 6 : 16;

  const reload = useCallback(async (showLoading = true, runSyncAfter = true) => {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const list = await listMaps();
      setItems(list as MapMeta[]);
      setOffline(false);
      if (user && runSyncAfter) {
        setListSyncing(true);
        syncNow()
          .then(() => reload(false, false))
          .catch(() => {})
          .finally(() => {
            setListSyncing(false);
          });
      }
    } catch {
      if (user) {
        const localList = await listLocalMaps();
        setItems(localList as MapMeta[]);
        setOffline(true);
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [syncNow, user]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoading) {
        reload();
      }
    }, [authLoading, reload])
  );

  useEffect(() => {
    if (authLoading) {
      return;
    }

    void reload();
  }, [authLoading, reload, user?.id]);

  useEffect(() => {
    if (!user || !lastSyncAt) {
      return;
    }

    void reload(false);
    setSyncToastVisible(true);
    const timer = setTimeout(() => {
      setSyncToastVisible(false);
    }, 2600);

    return () => clearTimeout(timer);
  }, [lastSyncAt, reload, user]);

  useEffect(() => {
    if (!user || !offline) {
      return;
    }

    const timer = setInterval(() => {
      reload(false);
    }, 10000);

    return () => clearInterval(timer);
  }, [offline, reload, user]);

  const openMap = useCallback(
    (id: string) => {
      router.push({
        pathname: "/(tabs)/myMaps/[id]",
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
    } catch (error: unknown) {
      Alert.alert(t("maps.exportFailed"), getErrorMessage(error));
    }
  }, [t]);

  const importMm = useCallback(async () => {
    try {
      const picked = await File.pickFileAsync();
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
    } catch (error: unknown) {
      const message = getErrorMessage(error);
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
    } catch (error: unknown) {
      const message = getErrorMessage(error);
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

  const hasPendingSync = user
    ? pendingSyncCount > 0 || sortedItems.some((item) => item.pendingSyncAt != null)
    : false;
  const syncPending = syncing || listSyncing;
  const syncBadgeIcon = syncPending
    ? "sync"
    : hasPendingSync
      ? "cloud-upload"
      : offline || !isOnline
        ? "cloud-off"
        : "cloud-done";
  const syncBadgeColor = syncPending
    ? "#0284c7"
    : hasPendingSync
      ? "#0f766e"
      : offline || !isOnline
        ? "#b45309"
        : "#0369a1";

  const showSynchronizing = sortedItems.length === 0 && (authLoading || loading || syncing || listSyncing);
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
        exportMapXmind(id, t("maps.exportXmind")).catch((error: unknown) => {
          Alert.alert(
            t("maps.exportFailed"),
            getErrorMessage(error)
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

  useEffect(() => {
    if (importVisible || !pendingImportKind) {
      return;
    }

    const timer = setTimeout(runPendingImport, 120);
    return () => clearTimeout(timer);
  }, [importVisible, pendingImportKind, runPendingImport]);

  useEffect(() => {
    if (exportVisible || !pendingExportId || !pendingExportKind) {
      return;
    }

    const timer = setTimeout(runPendingExport, 120);
    return () => clearTimeout(timer);
  }, [exportVisible, pendingExportId, pendingExportKind, runPendingExport]);

  return (
    <View style={[s.screen, isDark && s.screenDark]}>
      <View
        style={[
          s.header,
          isDark && s.headerDark,
          {
            paddingTop: headerPadTop,
            paddingLeft: horizontalInsetLeft,
            paddingRight: horizontalInsetRight,
          },
        ]}
      >
        <View style={s.headerRow}>
          <Text style={[s.headerTitle, isDark && s.headerTitleDark]}>{t("maps.title")}</Text>
          <View style={s.headerActions}>
            {user ? (
              <View style={[
                s.syncBadge,
                isDark && s.syncBadgeDark,
                hasPendingSync && s.syncBadgePending,
                hasPendingSync && isDark && s.syncBadgePendingDark,
              ]}>
                <MaterialIcons
                  name={syncBadgeIcon}
                  size={16}
                  color={syncBadgeColor}
                />
              </View>
            ) : null}
            <Pressable onPress={() => setImportVisible(true)} style={({ pressed }) => [s.importButton, pressed && s.pressedBtn]}>
              <Text style={s.importButtonText}>{t("maps.import")}</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <FlatList
        key={`mymaps-${numColumns}`}
        contentContainerStyle={[
          s.listContent,
          isLandscape && s.listContentLandscape,
          {
            paddingLeft: horizontalInsetLeft,
            paddingRight: horizontalInsetRight,
            paddingBottom: isLandscape ? Math.max(insets.bottom, 12) + 86 : Math.max(insets.bottom, 24),
          },
        ]}
        data={sortedItems}
        keyExtractor={(it) => it.id}
        refreshing={loading}
        onRefresh={reload}
        numColumns={numColumns}
        columnWrapperStyle={isLandscape ? s.columns : undefined}
        ListHeaderComponent={
          user && offline ? (
            <View style={[s.offlineBanner, isDark && s.offlineBannerDark]}>
              <MaterialIcons name="cloud-off" size={17} color={isDark ? "#fbbf24" : "#b45309"} />
              <Text style={[s.offlineText, isDark && s.offlineTextDark]}>{t("maps.offlineLocalData")}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          showSynchronizing ? (
            <View style={s.syncEmpty}>
              <ActivityIndicator color={isDark ? "#7dd3fc" : "#0284c7"} />
              <Text style={[s.syncEmptyTitle, isDark && s.syncEmptyTitleDark]}>{t("maps.synchronizing")}</Text>
            </View>
          ) : !loading ? (
            <View style={s.empty}>
              <Text style={[s.emptyTitle, isDark && s.emptyTitleDark]}>{t("maps.noMaps")}</Text>
              <Text style={[s.emptyText, isDark && s.emptyTextDark]}>{t("maps.createOneUsingCreate")}</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const isPendingSync = item.pendingSyncAt != null;

          return (
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
                <View style={s.badgeRow}>
                  {isPendingSync ? (
                    <View style={[s.storageBadge, s.pendingStorageBadge, isDark && s.pendingStorageBadgeDark]}>
                      <MaterialIcons name="cloud-upload" size={15} color={isDark ? "#5eead4" : "#0f766e"} />
                    </View>
                  ) : null}
                  {item.storage === "cloud" ? (
                    <View style={[s.storageBadge, isDark && s.storageBadgeDark]}>
                      <MaterialIcons name="cloud-done" size={15} color={isDark ? "#7dd3fc" : "#0369a1"} />
                    </View>
                  ) : user ? (
                    <View style={[s.storageBadge, isDark && s.storageBadgeDark]}>
                      <MaterialIcons name="smartphone" size={15} color={isDark ? "#cbd5e1" : "#64748b"} />
                    </View>
                  ) : null}
                </View>
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
          );
        }}
      />

      {user && syncToastVisible && !offline ? (
        <View style={[s.toast, isDark && s.toastDark, { bottom: Math.max(insets.bottom, 16) + 10 }]}>
          <MaterialIcons name="cloud-done" size={16} color="#ffffff" />
          <Text style={s.toastText}>{t("maps.mapsSynced")}</Text>
        </View>
      ) : null}

      {importVisible ? (
        <View style={sheet.overlay}>
          <Pressable style={sheet.backdrop} onPress={() => setImportVisible(false)} />

          <View style={[sheet.panel, isDark && sheet.panelDark]}>
            <Text style={[sheet.title, isDark && sheet.titleDark]}>{t("maps.importFormat")}</Text>

            <Pressable
              style={({ pressed }) => [sheet.option, isDark && sheet.optionDark, pressed && sheet.pressed]}
              onPress={() => {
                setPendingImportKind("mm");
                setImportVisible(false);
              }}
            >
              <Text style={[sheet.optionText, isDark && sheet.optionTextDark]}>{t("maps.freeMind")}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [sheet.option, isDark && sheet.optionDark, pressed && sheet.pressed]}
              onPress={() => {
                setPendingImportKind("xmind");
                setImportVisible(false);
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
              <Text
                style={[
                  sheet.optionText,
                  isDark && sheet.optionTextDark,
                  sheet.cancelText,
                  isDark && sheet.cancelTextDark,
                ]}
              >
                {t("common.cancel")}
              </Text>
            </Pressable>

            <View style={{ height: Platform.OS === "ios" ? insets.bottom : 0 }} />
          </View>
        </View>
      ) : null}

      {exportVisible ? (
        <View style={sheet.overlay}>
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
              <Text
                style={[
                  sheet.optionText,
                  isDark && sheet.optionTextDark,
                  sheet.cancelText,
                  isDark && sheet.cancelTextDark,
                ]}
              >
                {t("common.cancel")}
              </Text>
            </Pressable>

            <View style={{ height: Platform.OS === "ios" ? insets.bottom : 0 }} />
          </View>
        </View>
      ) : null}
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  syncBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,132,199,0.08)",
    borderWidth: 1,
    borderColor: "rgba(2,132,199,0.14)",
  },
  syncBadgeDark: {
    backgroundColor: "rgba(14,165,233,0.10)",
    borderColor: "rgba(56,189,248,0.20)",
  },
  syncBadgePending: {
    backgroundColor: "rgba(20,184,166,0.10)",
    borderColor: "rgba(20,184,166,0.24)",
  },
  syncBadgePendingDark: {
    backgroundColor: "rgba(45,212,191,0.12)",
    borderColor: "rgba(94,234,212,0.24)",
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
  offlineBanner: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(245,158,11,0.10)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.24)",
  },
  offlineBannerDark: {
    backgroundColor: "rgba(245,158,11,0.12)",
    borderColor: "rgba(251,191,36,0.24)",
  },
  offlineText: {
    flex: 1,
    color: "#92400e",
    fontSize: 13,
    fontWeight: "700",
  },
  offlineTextDark: {
    color: "#fbbf24",
  },
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
  storageBadge: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,132,199,0.08)",
    borderWidth: 1,
    borderColor: "rgba(2,132,199,0.12)",
  },
  storageBadgeDark: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pendingStorageBadge: {
    backgroundColor: "rgba(20,184,166,0.10)",
    borderColor: "rgba(20,184,166,0.22)",
  },
  pendingStorageBadgeDark: {
    backgroundColor: "rgba(45,212,191,0.12)",
    borderColor: "rgba(94,234,212,0.22)",
  },
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
  syncEmpty: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  syncEmptyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0369a1",
  },
  syncEmptyTitleDark: {
    color: "#7dd3fc",
  },
  empty: { paddingTop: 24, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  emptyTitleDark: { color: "#f8fafc" },
  emptyText: { fontSize: 13, color: "rgba(15,23,42,0.6)", fontWeight: "600" },
  emptyTextDark: { color: "#94a3b8" },
  toast: {
    position: "absolute",
    alignSelf: "center",
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(15,23,42,0.92)",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  toastDark: {
    backgroundColor: "rgba(2,6,23,0.94)",
  },
  toastText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
});

const sheet = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    zIndex: 80,
    elevation: 80,
  },
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
