import React, { useCallback, useState } from "react";
import { View, StyleSheet, Pressable, FlatList, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedView } from "@/components/themed-view";
import { ThemedText } from "@/components/themed-text";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

import { listMaps, deleteMap } from "@/src/storage/mapsRepo";

type Item = {
  id: string;
  title: string;
  updatedAt?: number;
};

export default function MyMapsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? "light"];

  const [items, setItems] = useState<Item[]>([]);

  const load = async () => {
    const data = await listMaps();
    setItems(data as any);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const openMap = (id: string) => {
    router.push({ pathname: "/(tabs)/myMaps/[id]", params: { id } });
  };

  const onDelete = (id: string) => {
    Alert.alert("Delete map?", "This action cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteMap(id);
          load();
        },
      },
    ]);
  };

  return (
    <ThemedView style={[s.screen, { paddingTop: insets.top + 12 }]}>
      <ThemedText type="title" style={s.title}>
        My mind maps
      </ThemedText>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={s.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openMap(item.id)}
            style={({ pressed }) => [
              s.card,
              { borderColor: "rgba(0,0,0,0.08)", backgroundColor: theme.background },
              pressed && s.pressed,
            ]}
          >
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <ThemedText style={s.cardTitle} numberOfLines={1}>
                  {item.title || "Untitled"}
                </ThemedText>
                {!!item.updatedAt && (
                  <ThemedText style={s.cardSub}>
                    {new Date(item.updatedAt).toLocaleString()}
                  </ThemedText>
                )}
              </View>

              <Pressable
                onPress={() => onDelete(item.id)}
                style={({ pressed }) => [s.deleteBtn, pressed && s.pressed]}
              >
                <ThemedText style={s.deleteText}>Delete</ThemedText>
              </Pressable>
            </View>
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 16 },
  title: { marginBottom: 12 },
  list: { paddingBottom: 24, gap: 12 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: "700" },
  cardSub: { marginTop: 6, opacity: 0.6 },
  deleteBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.25)",
  },
  deleteText: { color: "#ef4444", fontWeight: "700" },
  pressed: { opacity: 0.7 },
});