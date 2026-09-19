import { Pressable, StyleSheet, Text, View } from 'react-native';
import { viewerLight } from '../theme/viewerTheme';

import type { ViewerControllerState } from '../state/useViewerController';

export function ManagePanel({
  controller,
}: {
  controller: ViewerControllerState;
}) {
  const activeCollectionId = controller.activeCollection?.id;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Manage dataset</Text>
      <Text style={styles.meta}>
        This is the first import/manage shell wired through repository and adapter actions.
      </Text>
      <View style={styles.buttonRow}>
        <ActionButton
          label={controller.dataset ? 'Re-import mock archive' : 'Import mock archive'}
          onPress={() => controller.importArchive('/mock/noteharbor-archive.zip')}
          disabled={controller.isMutating}
        />
        <ActionButton
          label="Delete imported data"
          onPress={() => controller.deleteImportedDataset()}
          disabled={controller.isMutating || controller.dataset == null}
        />
      </View>
      <View style={styles.buttonRow}>
        <ActionButton
          label="Set active as default"
          onPress={() => {
            if (activeCollectionId != null) {
              void controller.setDefaultCollection(activeCollectionId);
            }
          }}
          disabled={controller.isMutating || activeCollectionId == null}
        />
        <ActionButton
          label="Delete active collection"
          onPress={() => {
            if (activeCollectionId != null) {
              void controller.deleteCollection(activeCollectionId);
            }
          }}
          disabled={controller.isMutating || activeCollectionId == null}
        />
      </View>
      {controller.isMutating ? (
        <Text style={styles.meta}>Applying dataset change...</Text>
      ) : null}
      {controller.error ? <Text style={styles.errorText}>{controller.error}</Text> : null}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.button, disabled && styles.buttonDisabled]}>
      <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text>
    </Pressable>
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
  meta: {
    color: viewerLight.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: viewerLight.accent,
  },
  buttonDisabled: {
    backgroundColor: viewerLight.borderControl,
  },
  buttonText: {
    color: viewerLight.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  buttonTextDisabled: {
    color: viewerLight.textMuted,
  },
  errorText: {
    color: viewerLight.danger,
    fontSize: 13,
    fontWeight: '700',
  },
});
