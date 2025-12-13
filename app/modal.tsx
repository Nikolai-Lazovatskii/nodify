import React from "react";
import { View, StyleSheet } from "react-native";
import { Link } from "expo-router";

import MapScreen from "../src/screens/MapScreen";
import { ThemedText } from "@/components/themed-text";

export default function ModalScreen() {
  return (
    <View style={styles.container}>
      <Link href="/" dismissTo style={styles.back}>
        <ThemedText type="link">← Back</ThemedText>
      </Link>

      <View style={styles.content}>
        <MapScreen />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  back: {
    padding: 12,
  },
  content: {
    flex: 1,
  },
});