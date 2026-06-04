/**
 * Súbor: app/(tabs)/index.tsx
 * Abstrakt: Zobrazuje úvodnú obrazovku menu s navigáciou k hlavným častiam aplikácie.
 */
import React from "react";
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAuth } from "@/src/auth/AuthProvider";
import { useLanguagePreference, useTranslation } from "@/src/lang/LanguagePreference";
import { useThemePreference } from "@/src/theme/ThemePreference";

export default function Index() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? "light";
  const isDark = colorScheme === "dark";
  const { togglePreference } = useThemePreference();
  const { language, toggleLanguage } = useLanguagePreference();
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  const horizontalInset = isLandscape ? 18 + Math.max(insets.left, insets.right) : 20;
  const topInset = Math.max(insets.top, isLandscape ? 12 : 16);
  const bottomInset = Math.max(insets.bottom, 16);

  const goAccount = () => {
    if (loading) return;
    if (user) {
      router.push("/(tabs)/account");
      return;
    }
    router.push("/(auth)/login");
  };

  return (
    <View style={[styles.container, isDark ? styles.containerDark : styles.containerLight]}>
      <View
        style={[
          styles.topBar,
          isLandscape && styles.topBarLandscape,
          {
            paddingTop: topInset,
            paddingHorizontal: horizontalInset,
          },
        ]}
      >
        <Pressable
          style={({ pressed }) => [
            styles.utilityButton,
            isDark ? styles.utilityButtonDark : styles.utilityButtonLight,
            pressed && styles.pressed,
          ]}
          onPress={goAccount}
        >
          <ThemedText style={[styles.utilityText, isDark ? styles.utilityTextDark : styles.utilityTextLight]}>
            {loading ? t("common.loading") : user ? t("common.profile") : t("common.login")}
          </ThemedText>
        </Pressable>

        <View style={[styles.utilityRow, isLandscape && styles.utilityRowLandscape]}>
          <Pressable
            style={({ pressed }) => [
              styles.utilityButton,
              isDark ? styles.utilityButtonDark : styles.utilityButtonLight,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              void togglePreference();
            }}
          >
            <ThemedText style={[styles.utilityText, isDark ? styles.utilityTextDark : styles.utilityTextLight]}>
              {colorScheme === "dark" ? t("menu.lightMode") : t("menu.darkMode")}
            </ThemedText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.utilityButton,
              isDark ? styles.utilityButtonDark : styles.utilityButtonLight,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              void toggleLanguage();
            }}
          >
            <ThemedText style={[styles.utilityText, isDark ? styles.utilityTextDark : styles.utilityTextLight]}>
              {t("menu.languageButton", {
                language: language === "en" ? t("common.english") : t("common.slovak"),
              })}
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <View
        style={[
          styles.content,
          {
            paddingLeft: horizontalInset,
            paddingRight: horizontalInset,
            paddingBottom: bottomInset,
          },
        ]}
      >
        <View style={styles.centerPanel}>
          <Image
            source={require("@/assets/NodifyNew.png")}
            style={[styles.logo, isLandscape && styles.logoLandscape]}
            resizeMode="contain"
          />

          <ThemedText type="title" style={[styles.title, isDark && styles.titleDark]}>
            Nodify
          </ThemedText>

          <ThemedText style={[styles.subtitle, isDark && styles.subtitleDark]}>
            {t("menu.subtitle")}
          </ThemedText>

          <View style={[styles.buttons, isLandscape && styles.buttonsLandscape]}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                isLandscape && styles.buttonLandscape,
                pressed && styles.pressed,
              ]}
              onPress={() => router.push("/(tabs)/create")}
            >
              <ThemedText style={styles.primaryText}>{t("menu.createNewMindMap")}</ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                isDark && styles.secondaryButtonDark,
                isLandscape && styles.buttonLandscape,
                pressed && styles.pressed,
              ]}
              onPress={() => router.push("/(tabs)/myMaps")}
            >
              <ThemedText style={[styles.secondaryText, isDark && styles.secondaryTextDark]}>
                {t("menu.myMindMaps")}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  containerLight: {
    backgroundColor: "#ffffff",
  },
  containerDark: {
    backgroundColor: "#0f172a",
  },
  topBar: {
    gap: 10,
  },
  topBarLandscape: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  utilityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  utilityRowLandscape: {
    justifyContent: "flex-end",
    flex: 1,
    marginLeft: 12,
  },
  utilityButton: {
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
  },
  utilityButtonLight: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderColor: "rgba(156,163,175,0.45)",
  },
  utilityButtonDark: {
    backgroundColor: "rgba(17,24,39,0.92)",
    borderColor: "rgba(255,255,255,0.14)",
  },
  utilityText: {
    fontSize: 13,
    fontWeight: "700",
  },
  utilityTextLight: {
    color: "#111827",
  },
  utilityTextDark: {
    color: "#f8fafc",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  centerPanel: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
  },
  logo: {
    width: 220,
    height: 220,
    marginBottom: 8,
  },
  logoLandscape: {
    width: 150,
    height: 150,
    marginBottom: 4,
  },
  title: {
    textAlign: "center",
    marginBottom: 8,
  },
  titleDark: {
    color: "#f8fafc",
  },
  subtitle: {
    textAlign: "center",
    color: "#475569",
    opacity: 0.85,
    marginBottom: 24,
  },
  subtitleDark: {
    color: "#94a3b8",
  },
  buttons: {
    width: "100%",
    gap: 12,
  },
  buttonsLandscape: {
    gap: 10,
  },
  primaryButton: {
    backgroundColor: "#38bdf8",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryText: {
    color: "#082f49",
    fontWeight: "700",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#9ca3af",
    backgroundColor: "#ffffff",
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
  },
  secondaryButtonDark: {
    borderColor: "#334155",
    backgroundColor: "#111827",
  },
  secondaryText: {
    color: "#374151",
    fontWeight: "600",
  },
  secondaryTextDark: {
    color: "#e5e7eb",
  },
  buttonLandscape: {
    paddingVertical: 11,
    borderRadius: 12,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
