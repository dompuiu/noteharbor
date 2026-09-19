import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { viewerLight } from '../theme/viewerTheme';

export function ImportBlockingOverlay({
  visible,
  archiveName,
  testID,
}: {
  visible: boolean;
  archiveName?: string | null;
  testID?: string;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {}}>
      <View testID={testID} style={styles.barrier}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={viewerLight.accent} />
          <Text style={styles.title}>Importing archive...</Text>
          {archiveName ? <Text style={styles.name}>{archiveName}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  barrier: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46,35,24,0.45)',
  },
  card: {
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 24,
    backgroundColor: viewerLight.surface,
  },
  title: {
    color: viewerLight.text,
    fontSize: 15,
    fontWeight: '700',
  },
  name: {
    color: viewerLight.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
