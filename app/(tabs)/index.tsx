import React from "react";
import { View, StyleSheet, Pressable, Image, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useAuth } from "@/src/auth/AuthProvider";

export default function Index() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const insets = useSafeAreaInsets();

  const { user, loading } = useAuth();

  const goAccount = () => {
    // While session is restoring, do nothing to avoid redirect glitches
    if (loading) return;
    if (user) router.push("/(tabs)/account" as any);
    else router.push("/(auth)/login" as any);
  };

  return (
    <ThemedView style={[styles.container, isLandscape && styles.containerLandscape]}>
      <Pressable
        style={({ pressed }) => [
          styles.accountBtn,
          { top: (isLandscape ? 8 : 12) + insets.top, left: 12 + insets.left },
          pressed && styles.pressed,
        ]}
        onPress={goAccount}
      >
        <ThemedText style={styles.accountText}>{loading ? "..." : user ? "Profile" : "Login"}</ThemedText>
      </Pressable>

      <View style={styles.content}>
        <Image
          source={require("@/assets/Nodify2.png")}
          style={[styles.logo, isLandscape && styles.logoLandscape]}
          resizeMode="contain"
        />

        <ThemedText type="title" style={styles.title}>
          Nodify
        </ThemedText>

        <ThemedText style={styles.subtitle}>Mind mapping made simple</ThemedText>

        <View style={[styles.buttons, isLandscape && styles.buttonsLandscape]}>
          <Pressable
            style={[styles.primaryButton, isLandscape && styles.buttonLandscape]}
            onPress={() => router.push("/(tabs)/create")}
          >
            <ThemedText style={styles.primaryText}>Create new mind map</ThemedText>
          </Pressable>

          <Pressable
            style={[styles.secondaryButton, isLandscape && styles.buttonLandscape]}
            onPress={() => router.push("/(tabs)/myMaps")}
          >
            <ThemedText style={styles.secondaryText}>My mind maps</ThemedText>
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  accountBtn: {
    position: "absolute",
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(156,163,175,0.6)",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  accountText: {
    color: "#111827",
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
  },
  logo: {
    width: 110,
    height: 110,
    alignSelf: "center",
    marginBottom: 18,
  },
  title: {
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    textAlign: "center",
    opacity: 0.7,
    marginBottom: 24,
  },
  buttons: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: "#38bdf8",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryText: {
    color: "#111827",
    fontWeight: "600",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#9ca3af",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryText: {
    color: "#374151",
  },
  containerLandscape: {
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  logoLandscape: {
    width: 80,
    height: 80,
    marginBottom: 10,
  },
  buttonsLandscape: {
    gap: 10,
  },
  buttonLandscape: {
    paddingVertical: 10,
    borderRadius: 10,
  },
});