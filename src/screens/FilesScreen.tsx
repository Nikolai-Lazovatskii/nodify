import { View, Text, StyleSheet } from 'react-native';

export default function FilesScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Súbory</Text>
      <Text>Tu bude zoznam máp (.mm, .xmind).</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 64,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
});