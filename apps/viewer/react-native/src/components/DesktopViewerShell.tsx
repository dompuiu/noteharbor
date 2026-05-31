import { activeCollectionNotes } from '../shared/viewer-core';
import { StyleSheet, Text, View } from 'react-native';

import { DesktopNotesTable } from './DesktopNotesTable';
import type { ViewerControllerState } from '../state/useViewerController';

export function DesktopViewerShell({
  controller,
}: {
  controller: ViewerControllerState;
}) {
  const collections = controller.dataset?.collections ?? [];
  const totalNotes = activeCollectionNotes(
    controller.dataset,
    controller.activeCollectionId,
  ).length;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Desktop shell</Text>
      <Text style={styles.meta}>
        Table-oriented layout target for iPad, macOS, and Windows.
      </Text>
      <View style={styles.collectionRow}>
        {collections.map((collection) => {
          const isActive = collection.id === controller.activeCollectionId;

          return (
            <Text
              key={collection.id}
              onPress={() => controller.selectCollection(collection.id)}
              style={[styles.collectionChip, isActive && styles.collectionChipActive]}>
              {collection.name} ({collection.noteCount})
            </Text>
          );
        })}
      </View>
      <Text style={styles.meta}>
        Showing {controller.filteredNotes.length} of {totalNotes} notes in{' '}
        {controller.activeCollection?.name ?? 'None'}
      </Text>
      <DesktopNotesTable controller={controller} />
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
  meta: {
    color: '#7a6247',
    fontSize: 13,
    fontWeight: '600',
  },
  collectionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  collectionChip: {
    color: '#5d4328',
    backgroundColor: '#efe1ce',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: 'hidden',
  },
  collectionChipActive: {
    color: '#fffaf2',
    backgroundColor: '#8b5a2b',
  },
});
