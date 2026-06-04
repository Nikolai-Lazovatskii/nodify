/**
 * Súbor: app/(tabs)/myMaps/[id].tsx
 * Abstrakt: Načíta konkrétnu myšlienkovú mapu a prepojí editor s ukladaním zmien.
 */
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/lang/LanguagePreference";

import MapScreen from "@/src/screens/MapScreen";
import { getMap, saveMap } from "@/src/storage/mapsRepo";
import { MindMap } from "@/src/types/map";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function MapEditorScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const { id } = useLocalSearchParams<{ id: string }>();
  const mapId = useMemo(() => (typeof id === "string" ? id : ""), [id]);

  const [map, setMap] = useState<MindMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMapRef = useRef<MindMap | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadError(null);
        const loaded = await getMap(mapId);
        if (alive) {
          latestMapRef.current = loaded;
          setMap(loaded);
        }
      } catch (error: unknown) {
        if (alive) {
          setMap(null);
          setLoadError(getErrorMessage(error, t("maps.failedToOpenMap")));
        }
      }
    })();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mapId, t]);

  const persist = (next: MindMap) => {
    latestMapRef.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (latestMapRef.current) {
        saveMap(latestMapRef.current).catch(() => {});
      }
    }, 250);
  };

  if (loadError) {
    return (
      <View style={[styles.centered, styles.errorContainer, isDark && styles.centeredDark]}>
        <Text style={[styles.errorTitle, isDark && styles.errorTitleDark]}>
          {t("maps.failedToOpenMap")}
        </Text>
        <Text style={[styles.errorText, isDark && styles.errorTextDark]}>
          {loadError}
        </Text>
      </View>
    );
  }

  if (!map) {
    return (
      <View style={[styles.centered, isDark && styles.centeredDark]}>
        <ActivityIndicator />
      </View>
    );
  }

  return <MapScreen key={map.id} initialMap={map} onMapChange={persist} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  centeredDark: {
    backgroundColor: "#020617",
  },
  errorContainer: {
    padding: 24,
  },
  errorTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  errorTitleDark: {
    color: "#f8fafc",
  },
  errorText: {
    marginTop: 8,
    color: "#475569",
    fontSize: 14,
    textAlign: "center",
  },
  errorTextDark: {
    color: "#94a3b8",
  },
});
