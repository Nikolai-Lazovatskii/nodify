import React from "react";
import { View, StyleSheet } from "react-native";
import MapScreen from "@/src/screens/MapScreen";
import { Colors } from "@/constants/theme";

export default function CreateScreen() {
  return (
    <View style={styles.container}>
      <MapScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
});