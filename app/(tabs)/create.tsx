/**
 * Súbor: app/(tabs)/create.tsx
 * Abstrakt: Vytvára novú myšlienkovú mapu a presmeruje používateľa do editora.
 */
import React, { useCallback, useRef } from "react";
import { View, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useTranslation } from "@/src/i18n/LanguagePreference";
import { createMap } from "@/src/storage/mapsRepo";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function CreateTab() {
  const router = useRouter();
  const { t } = useTranslation();
  const runningRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (runningRef.current) return;

      runningRef.current = true;
      let cancelled = false;

      (async () => {
        try {
          const map = await createMap(t("create.newMindMap"), t("create.root"), {
            numberedTitle: true,
          });
          if (cancelled) return;

          router.replace({
            pathname: "/(tabs)/myMaps/[id]",
            params: { id: map.id },
          });
        } catch (error: unknown) {
          if (cancelled) return;
          Alert.alert(t("create.createFailed"), getErrorMessage(error, t("create.unknownError")));
        } finally {
          runningRef.current = false;
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [router, t])
  );

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
