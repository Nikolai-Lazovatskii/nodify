import React from "react";
import { Tabs } from "expo-router";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/i18n/LanguagePreference";

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
        tabBarInactiveTintColor:
          colorScheme === "dark" ? Colors.dark.tabIconDefault : Colors.light.text,
        tabBarStyle: {
          paddingLeft: isLandscape ? Math.max(insets.left, 8) : 0,
          paddingRight: isLandscape ? Math.max(insets.right, 8) : 0,
          paddingBottom: Math.max(insets.bottom, 6),
          height: 56 + Math.max(insets.bottom, 6),
          backgroundColor: colorScheme === "dark" ? "#111827" : "#ffffff",
          borderTopColor: colorScheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)",
        },
        sceneStyle: {
          paddingLeft: isLandscape ? Math.max(insets.left, 0) : 0,
          paddingRight: isLandscape ? Math.max(insets.right, 0) : 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.menu"),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="house.fill" color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="myMaps/index"
        options={{
          title: t("tabs.myMaps"),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="folder.fill" color={color} />
          ),
        }}
      />

      <Tabs.Screen name="create" options={{ href: null }} />
      <Tabs.Screen name="myMaps/[id]" options={{ href: null }} />
      <Tabs.Screen name="account" options={{ href: null }} />
    </Tabs>
  );
}
