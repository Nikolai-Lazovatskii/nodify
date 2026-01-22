import React, { useCallback, useRef } from "react";
import { View, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { createMap } from "@/src/storage/mapsRepo";

export default function CreateTab() {
  const router = useRouter();
  const runningRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (runningRef.current) return;

      runningRef.current = true;
      let cancelled = false;

      (async () => {
        try {
          const map = await createMap("New mind map");
          if (cancelled) return;

          router.replace({
            pathname: "/(tabs)/myMaps/[id]",
            params: { id: map.id },
          });
        } catch (e: any) {
          if (cancelled) return;
          Alert.alert("Create failed", e?.message ?? "Unknown error");
        } finally {
          runningRef.current = false;
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [router])
  );

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}