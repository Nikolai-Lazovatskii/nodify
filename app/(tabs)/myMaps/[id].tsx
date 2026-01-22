import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import MapScreen from "@/src/screens/MapScreen";
import { getMap, saveMap } from "@/src/storage/mapsRepo";
import { MindMap } from "@/src/types/map";

export default function MapEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const mapId = useMemo(() => (typeof id === "string" ? id : ""), [id]);

  const [map, setMap] = useState<MindMap | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await getMap(mapId);
      if (alive) setMap(loaded);
    })();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [mapId]);

  const persist = (next: MindMap) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveMap(next).catch(() => {});
    }, 250);
  };

  if (!map) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <MapScreen key={map.id} initialMap={map} onMapChange={persist} />;
}
