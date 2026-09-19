import { StyleSheet, Text, TextInput, View } from 'react-native';
import { viewerLight } from '../theme/viewerTheme';

export function ViewerFilter({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (value: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Filter</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Try tags: romania or catalog: p-98"
        placeholderTextColor={viewerLight.textFaint}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: viewerLight.text,
    fontSize: 17,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: viewerLight.borderControl,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: viewerLight.text,
    backgroundColor: viewerLight.surface,
  },
});
