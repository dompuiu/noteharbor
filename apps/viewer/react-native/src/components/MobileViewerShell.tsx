import { noteTagsLabel, noteTitle } from '../shared/viewer-core';
import { StyleSheet, Text, View } from 'react-native';

import type { ViewerControllerState } from '../state/useViewerController';

export function MobileViewerShell({
  controller,
}: {
  controller: ViewerControllerState;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Mobile shell</Text>
      <Text style={styles.meta}>
        Card/list browsing target for iPhone-sized layouts.
      </Text>
      <Text style={styles.sectionTitle}>
        Active collection: {controller.activeCollection?.name ?? 'None'}
      </Text>
      {controller.filteredNotes.map((note) => (
        <View key={note.id} style={styles.noteCard}>
          <Text style={styles.noteTitle}>{noteTitle(note)}</Text>
          <Text style={styles.noteMeta}>
            {note.issueDate || 'Unknown date'} • {note.catalogNumber || 'No catalog'}
          </Text>
          <Text style={styles.noteBody}>{note.notes || 'No notes yet.'}</Text>
          <Text style={styles.noteMeta}>{noteTagsLabel(note) || 'No tags'}</Text>
        </View>
      ))}
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
  noteCard: {
    gap: 6,
    borderRadius: 18,
    padding: 16,
    backgroundColor: '#f7efe3',
    borderWidth: 1,
    borderColor: '#e0ccb1',
  },
  noteTitle: {
    color: '#241912',
    fontSize: 18,
    fontWeight: '700',
  },
  noteMeta: {
    color: '#73573a',
    fontSize: 13,
    fontWeight: '600',
  },
  noteBody: {
    color: '#4f3925',
    fontSize: 14,
    lineHeight: 20,
  },
});
