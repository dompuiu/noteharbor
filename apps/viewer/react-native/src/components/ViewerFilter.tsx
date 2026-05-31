import { StyleSheet, Text, TextInput, View } from 'react-native';

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
        placeholderTextColor="#9c8469"
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
    color: '#3f2a1d',
    fontSize: 17,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d5bea0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#241912',
    backgroundColor: '#fffdf9',
  },
});
