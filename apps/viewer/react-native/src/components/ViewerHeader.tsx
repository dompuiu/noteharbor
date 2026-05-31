import { StyleSheet, Text, View } from 'react-native';

export function ViewerHeader({ sourceLabel }: { sourceLabel: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>Note Harbor</Text>
      <Text style={styles.title}>React Native viewer</Text>
      <Text style={styles.body}>
        The app shell now loads data asynchronously through a repository-backed controller.
      </Text>
      <Text style={styles.meta}>{sourceLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  eyebrow: {
    color: '#8b5a2b',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#241912',
    fontSize: 30,
    fontWeight: '800',
  },
  body: {
    color: '#4f3925',
    fontSize: 16,
    lineHeight: 24,
  },
  meta: {
    color: '#7a6247',
    fontSize: 13,
    fontWeight: '600',
  },
});
