import { StyleSheet } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";

export default function ExploreScreen() {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">My Mind Maps</ThemedText>
      <ThemedText style={styles.text}>
        This section will contain saved mind maps in future versions.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  text: {
    marginTop: 12,
    opacity: 0.7,
  },
});