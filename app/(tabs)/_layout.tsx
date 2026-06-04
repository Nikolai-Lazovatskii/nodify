/**
 * Súbor: app/(tabs)/_layout.tsx
 * Abstrakt: Definuje hlavnú záložkovú navigáciu aplikácie a jej vizuálne nastavenia.
 */
import React from "react";
import { Tabs } from "expo-router";
import { BottomTabBar, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { MaterialIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/haptic-tab";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTranslation } from "@/src/lang/LanguagePreference";

function LandscapeTabMenu({ state, descriptors, navigation }: BottomTabBarProps) {
  const [open, setOpen] = React.useState(false);
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === "dark";
  const tint = Colors[colorScheme ?? "light"].tint;
  const visibleRoutes = state.routes.filter((route) =>
    route.name === "index" || route.name === "myMaps/index"
  );
  const activeRoute = state.routes[state.index];
  const menuRoute = visibleRoutes.find((route) => route.name === "index");
  const myMapsRoute = visibleRoutes.find((route) => route.name === "myMaps/index");
  const menuLabel = menuRoute && typeof descriptors[menuRoute.key]?.options.title === "string"
    ? descriptors[menuRoute.key].options.title
    : "Menu";
  const myMapsLabel = myMapsRoute && typeof descriptors[myMapsRoute.key]?.options.title === "string"
    ? descriptors[myMapsRoute.key].options.title
    : "My maps";
  const activeLabel = activeRoute?.name.startsWith("myMaps") ? myMapsLabel : menuLabel;

  const navigateToRoute = (route: (typeof state.routes)[number]) => {
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });

    if (!event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
      setOpen(false);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        tabMenu.landscapeWrap,
        {
          left: Math.max(insets.left, 10) + 6,
          bottom: Math.max(insets.bottom, 12) + 18,
        },
      ]}
    >
      {open ? (
        <View style={[tabMenu.landscapePanel, isDark && tabMenu.landscapePanelDark]}>
          {visibleRoutes.map((route) => {
            const focused = state.routes[state.index]?.key === route.key;
            const options = descriptors[route.key]?.options;
            const label = typeof options?.title === "string" ? options.title : route.name;
            const iconName = route.name === "myMaps/index" ? "folder" : "home";
            const color = focused ? tint : isDark ? "#cbd5e1" : "#475569";

            return (
              <Pressable
                key={route.key}
                onPress={() => navigateToRoute(route)}
                style={({ pressed }) => [
                  tabMenu.landscapeItem,
                  focused && tabMenu.landscapeItemActive,
                  isDark && tabMenu.landscapeItemDark,
                  focused && isDark && tabMenu.landscapeItemActiveDark,
                  pressed && tabMenu.pressed,
                ]}
              >
                <MaterialIcons name={iconName} size={19} color={color} />
                <Text style={[tabMenu.landscapeItemText, isDark && tabMenu.landscapeItemTextDark, focused && { color }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Pressable
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [
          tabMenu.burgerButton,
          isDark && tabMenu.burgerButtonDark,
          pressed && tabMenu.pressed,
        ]}
      >
        <MaterialIcons name={open ? "close" : "menu"} size={22} color={isDark ? "#f8fafc" : "#0f172a"} />
        <Text numberOfLines={1} style={[tabMenu.burgerText, isDark && tabMenu.burgerTextDark]}>
          {activeLabel}
        </Text>
      </Pressable>
    </View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  return (
    <Tabs
      tabBar={(props) => (
        isLandscape ? <LandscapeTabMenu {...props} /> : <BottomTabBar {...props} />
      )}
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
          paddingLeft: 0,
          paddingRight: 0,
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

const tabMenu = StyleSheet.create({
  landscapeWrap: {
    position: "absolute",
    alignItems: "flex-start",
    gap: 8,
    zIndex: 100,
  },
  landscapePanel: {
    minWidth: 168,
    borderRadius: 16,
    padding: 6,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.10)",
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 12,
    gap: 4,
  },
  landscapePanelDark: {
    backgroundColor: "rgba(15,23,42,0.98)",
    borderColor: "rgba(255,255,255,0.10)",
  },
  landscapeItem: {
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  landscapeItemDark: {
    backgroundColor: "transparent",
  },
  landscapeItemActive: {
    backgroundColor: "rgba(14,165,233,0.12)",
  },
  landscapeItemActiveDark: {
    backgroundColor: "rgba(56,189,248,0.16)",
  },
  landscapeItemText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "800",
  },
  landscapeItemTextDark: {
    color: "#cbd5e1",
  },
  burgerButton: {
    maxWidth: 178,
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.98)",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.12)",
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 12,
  },
  burgerButtonDark: {
    backgroundColor: "rgba(15,23,42,0.98)",
    borderColor: "rgba(255,255,255,0.12)",
  },
  burgerText: {
    flexShrink: 1,
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "900",
  },
  burgerTextDark: {
    color: "#f8fafc",
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
