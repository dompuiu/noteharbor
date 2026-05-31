import { noteTagsLabel, noteTitle } from '../shared/viewer-core';
import { StyleSheet, Text, View } from 'react-native';

import type { ViewerControllerState } from '../state/useViewerController';

export function DesktopNotesTable({
  controller,
}: {
  controller: ViewerControllerState;
}) {
  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={[styles.cell, styles.headerText]}>Order</Text>
        <Text style={[styles.cell, styles.headerText]}>Title</Text>
        <Text style={[styles.cell, styles.headerText]}>Catalog</Text>
        <Text style={[styles.cell, styles.headerText]}>Tags</Text>
      </View>
      {controller.filteredNotes.map((note) => (
        <View key={note.id} style={styles.row}>
          <Text style={styles.cell}>{note.displayOrder}</Text>
          <Text style={styles.cell}>{noteTitle(note)}</Text>
          <Text style={styles.cell}>{note.catalogNumber || '-'}</Text>
          <Text style={styles.cell}>{noteTagsLabel(note) || '-'}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 0,
  },
  header: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dcc9af',
  },
  headerText: {
    fontWeight: '800',
    color: '#3f2a1d',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee1cf',
  },
  cell: {
    flex: 1,
    color: '#4f3925',
    fontSize: 13,
  },
});
