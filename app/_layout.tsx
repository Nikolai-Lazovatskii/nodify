/* eslint-disable import/no-duplicates */
import "react-native-gesture-handler";
import "react-native-reanimated";

import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "@/src/auth/AuthProvider";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { LanguagePreferenceProvider, useTranslation } from "@/src/i18n/LanguagePreference";
import { ThemePreferenceProvider } from "@/src/theme/ThemePreference";

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <LanguagePreferenceProvider>
        <RootLayoutInner />
      </LanguagePreferenceProvider>
    </ThemePreferenceProvider>
  );
}

function RootLayoutInner() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="modal" options={{ presentation: "modal", title: t("tabs.modal") }} />
          </Stack>
          <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
