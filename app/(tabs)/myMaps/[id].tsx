import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/i18n/LanguagePreference";

import MapScreen from "@/src/screens/MapScreen";
import { getMap, saveMap } from "@/src/storage/mapsRepo";
import { MindMap } from "@/src/types/map";

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
      } catch (error: any) {
        if (alive) {
          setMap(null);
          setLoadError(error?.message ?? t("maps.failedToOpenMap"));
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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: isDark ? "#020617" : "#ffffff" }}>
        <Text style={{ color: isDark ? "#f8fafc" : "#111827", fontSize: 16, fontWeight: "700", textAlign: "center" }}>{t("maps.failedToOpenMap")}</Text>
        <Text style={{ marginTop: 8, color: isDark ? "#94a3b8" : "#475569", fontSize: 14, textAlign: "center" }}>
          {loadError}
        </Text>
      </View>
    );
  }

  if (!map) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: isDark ? "#020617" : "#ffffff" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <MapScreen key={map.id} initialMap={map} onMapChange={persist} />;
}
