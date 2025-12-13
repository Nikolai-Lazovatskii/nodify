import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";

export default function Index() {
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>
        Nodify 🧠
      </ThemedText>

      <ThemedText style={styles.subtitle}>
        Mind mapping made simple
      </ThemedText>

      <View style={styles.buttons}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => router.push("/modal")}
        >
          <ThemedText style={styles.primaryText}>
            Create new mind map
          </ThemedText>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            router.push("/(tabs)/explore");
          }}
        >
          <ThemedText style={styles.secondaryText}>
            My mind maps
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    textAlign: "center",
    opacity: 0.7,
    marginBottom: 32,
  },
  buttons: {
    gap: 16,
  },
  primaryButton: {
    backgroundColor: "#38bdf8",
    paddingVertical: 14,
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
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryText: {
    color: "#374151",
  },
});