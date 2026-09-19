import {
  activeCollectionNotes,
  noteImageUri,
  notePreviewImage,
  type NoteRecord,
} from '../shared/viewer-core';
import { useEffect, useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { viewerLight } from '../theme/viewerTheme';

import { NoteImageView } from './NoteImageView';
import type { ViewerControllerState } from '../state/useViewerController';

// Flutter widths (notes_table_screen.dart): ID 90 / Front 120 / Denomination
// 190 / Date 120 / Catalog 130 / Company 120 / Grade 110 / Serial 140 / Tags
// dynamic >= 160. Row height 80, thumbnails 96x56, horizontal padding 14.
export const TABLE_ROW_HEIGHT = 80;
const TABLE_ROW_SEPARATOR_HEIGHT = 1;
const TABLE_HORIZONTAL_PADDING = 14;
const FIXED_COLUMN_WIDTHS = [90, 120, 190, 120, 130, 120, 110, 140];
const TAGS_COLUMN_MIN_WIDTH = 160;
export const MIN_TABLE_CONTENT_WIDTH =
  FIXED_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0) +
  TAGS_COLUMN_MIN_WIDTH +
  TABLE_HORIZONTAL_PADDING * 2;

export interface SlideshowReturn {
  noteId: number;
  tagName?: string | null;
}

export type OpenSlideshow = (
  notes: NoteRecord[],
  initialIndex: number,
) => Promise<SlideshowReturn | null>;

// Char-width estimate of the widest tag-chip row (Flutter measures with
// TextPainter; RN has no cheap sync measure, so estimate and keep the 160
// minimum). Recomputed every render from the visible notes.
export function calculateTagsColumnWidth(notes: NoteRecord[]): number {
  let widest = 0;

  for (const note of notes) {
    const names = note.tags
      .map((tag) => tag.name.trim())
      .filter((name) => name.length > 0);

    if (names.length === 0) {
      widest = Math.max(widest, 8);
      continue;
    }

    const chips = names.reduce(
      (sum, name) => sum + name.length * 7 + 24,
      0,
    );
    widest = Math.max(widest, chips + (names.length - 1) * 6 + 24);
  }

  return Math.max(TAGS_COLUMN_MIN_WIDTH, widest);
}

export function clampRevealOffset(target: number, maxOffset: number): number {
  return Math.min(Math.max(0, target), Math.max(0, maxOffset));
}

interface SortColumn {
  key: string;
  label: string;
  width: number;
  sortable: boolean;
}

const SORT_COLUMNS: SortColumn[] = [
  { key: 'displayOrder', label: 'ID', width: 90, sortable: true },
  { key: '', label: 'Front', width: 120, sortable: false },
  { key: 'denomination', label: 'Denomination', width: 190, sortable: true },
  { key: 'issueDate', label: 'Date', width: 120, sortable: true },
  { key: 'catalogNumber', label: 'Catalog', width: 130, sortable: true },
  { key: 'gradingCompany', label: 'Company', width: 120, sortable: true },
  { key: 'grade', label: 'Grade', width: 110, sortable: true },
  { key: 'serial', label: 'Serial', width: 140, sortable: true },
];

// Static width styles so fixed columns don't allocate style objects per render.
const FIXED_WIDTH_STYLES: Record<number, { width: number }> = {
  90: { width: 90 },
  110: { width: 110 },
  120: { width: 120 },
  130: { width: 130 },
  140: { width: 140 },
  190: { width: 190 },
};

function dashForEmpty(value: string): string {
  return value === '' ? '-' : value;
}

function sortArrow(
  controller: ViewerControllerState,
  columnKey: string,
): string {
  if (controller.sortKey !== columnKey) {
    return '';
  }

  return controller.ascending ? ' ▲' : ' ▼';
}

export function NotesTableScreen({
  controller,
  onOpenSlideshow,
  onOpenImport,
}: {
  controller: ViewerControllerState;
  onOpenSlideshow?: OpenSlideshow;
  onOpenImport?: () => void;
}) {
  const hScrollRef = useRef<ScrollView | null>(null);
  const vScrollRef = useRef<ScrollView | null>(null);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const prevCollectionIdRef = useRef<number | null | undefined>(undefined);

  const totalNotes = activeCollectionNotes(
    controller.dataset,
    controller.activeCollectionId,
  ).length;
  const visibleNotes = controller.filteredNotes;
  const tagsWidth = calculateTagsColumnWidth(visibleNotes);
  const tableWidth =
    FIXED_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0) +
    tagsWidth +
    TABLE_HORIZONTAL_PADDING * 2;

  // Collection change clears the query and resets both scrollers (Flutter
  // _handleControllerChange).
  useEffect(() => {
    if (prevCollectionIdRef.current === undefined) {
      prevCollectionIdRef.current = controller.activeCollectionId;
      return;
    }

    if (prevCollectionIdRef.current === controller.activeCollectionId) {
      return;
    }

    prevCollectionIdRef.current = controller.activeCollectionId;
    controller.setQuery('');
    hScrollRef.current?.scrollTo({ x: 0, animated: false });
    vScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [controller, controller.activeCollectionId]);

  const applyTagFilter = (tagName: string) => {
    controller.setQuery(`tags: ${tagName}`);
    hScrollRef.current?.scrollTo({ x: 0, animated: false });
  };

  const revealNoteById = (notes: NoteRecord[], noteId: number) => {
    const index = notes.findIndex((note) => note.id === noteId);
    if (index < 0) {
      return;
    }

    const target = index * (TABLE_ROW_HEIGHT + TABLE_ROW_SEPARATOR_HEIGHT);
    const maxOffset =
      contentHeightRef.current - viewportHeightRef.current;
    vScrollRef.current?.scrollTo({
      y: maxOffset > 0 ? clampRevealOffset(target, maxOffset) : target,
      animated: true,
    });
  };

  const openRow = async (index: number) => {
    const result = await onOpenSlideshow?.(visibleNotes, index);
    if (!result) {
      return;
    }

    hScrollRef.current?.scrollTo({ x: 0, animated: false });
    if (result.tagName) {
      // Canonical `tags:` filter (fixes Flutter's raw-name inconsistency).
      controller.setQuery(`tags: ${result.tagName}`);
    }
    revealNoteById(visibleNotes, result.noteId);
  };

  const canShowImport =
    controller.canManageImportedDatasets && onOpenImport != null;
  const collections = controller.dataset?.collections ?? [];

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={styles.badge} accessibilityLabel="Note Harbor">
          <Text style={styles.badgeText}>Note{'\n'}Harbor</Text>
        </View>
        <View style={styles.pill}>
          <Text testID="notes-pill" style={styles.pillText}>
            {`Notes: ${visibleNotes.length} / ${totalNotes}`}
          </Text>
        </View>
        {canShowImport ? (
          <Pressable
            testID="import-button"
            accessibilityLabel="Manage imported archives"
            onPress={onOpenImport}
            style={styles.importButton}>
            <Text style={styles.importGlyph}>↑</Text>
          </Pressable>
        ) : null}
      </View>

      {collections.length > 0 ? (
        <View style={styles.collectionRow}>
          {collections.map((collection) => {
            const isActive = collection.id === controller.activeCollectionId;
            return (
              <Pressable
                key={collection.id}
                testID={`collection-chip-${collection.id}`}
                onPress={() => controller.selectCollection(collection.id)}
                style={[styles.chip, isActive && styles.chipActive]}>
                <Text
                  style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {collection.name} ({collection.noteCount})
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <TextInput
          testID="table-search"
          value={controller.query}
          onChangeText={controller.setQuery}
          placeholder="Filter... or use catalog: denom: date: company: grade: tags:"
          placeholderTextColor={viewerLight.textFaint}
          style={styles.searchInput}
        />
        {controller.query !== '' ? (
          <Pressable
            testID="search-clear"
            accessibilityLabel="Clear search"
            onPress={() => controller.setQuery('')}
            style={styles.clearButton}>
            <Text style={styles.clearGlyph}>X</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tableCard}>
        {visibleNotes.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text testID="empty-row" style={styles.emptyText}>
              No notes match the current filter.
            </Text>
          </View>
        ) : (
          <ScrollView
            testID="table-hscroll"
            ref={hScrollRef}
            horizontal
            style={styles.hscroll}>
            <View
              testID="table-content"
              style={[styles.tableContent, { width: tableWidth }]}>
              <View style={styles.tableHeader}>
                {SORT_COLUMNS.map((column) =>
                  column.sortable ? (
                    <Pressable
                      key={column.key}
                      testID={`sort-${column.key}`}
                      accessibilityLabel={`Sort by ${column.label}`}
                      onPress={() => controller.setSort(column.key)}
                      style={[
                        styles.headerCell,
                        FIXED_WIDTH_STYLES[column.width],
                      ]}>
                      <Text style={styles.headerCellText}>
                        {column.label}
                        {sortArrow(controller, column.key)}
                      </Text>
                    </Pressable>
                  ) : (
                    <View
                      key={column.label}
                      testID="header-front"
                      style={[
                        styles.headerCell,
                        FIXED_WIDTH_STYLES[column.width],
                      ]}>
                      <Text style={styles.headerCellPlain}>{column.label}</Text>
                    </View>
                  ),
                )}
                <Pressable
                  testID="sort-tags"
                  accessibilityLabel="Sort by Tags"
                  onPress={() => controller.setSort('tags')}
                  style={[styles.headerCell, { width: tagsWidth }]}>
                  <Text style={styles.headerCellText}>
                    Tags
                    {sortArrow(controller, 'tags')}
                  </Text>
                </Pressable>
              </View>
              <ScrollView
                testID="table-vscroll"
                ref={vScrollRef}
                onLayout={(event) =>
                  (viewportHeightRef.current =
                    event.nativeEvent.layout.height)
                }
                onContentSizeChange={(_, height) =>
                  (contentHeightRef.current = height)
                }>
                {visibleNotes.map((note, index) => {
                  const tags = note.tags
                    .map((tag) => tag.name.trim())
                    .filter((name) => name.length > 0);
                  const thumbUri = noteImageUri(
                    notePreviewImage(note, 'front'),
                  );
                  return (
                    <Pressable
                      key={note.id}
                      testID={`table-row-${note.id}`}
                      accessibilityLabel={`Open note ${note.id}`}
                      onPress={() => openRow(index)}
                      style={styles.row}>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[90]]}>
                        <Text style={styles.cellText}>
                          {note.displayOrder}
                        </Text>
                      </View>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[120]]}>
                        <View
                          testID={
                            thumbUri
                              ? `thumb-${note.id}`
                              : `thumb-placeholder-${note.id}`
                          }
                          style={styles.thumbWrap}>
                          <NoteImageView
                            uri={thumbUri}
                            width={96}
                            height={56}
                          />
                        </View>
                      </View>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[190]]}>
                        <Text style={styles.cellText}>
                          {dashForEmpty(note.denomination)}
                        </Text>
                      </View>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[120]]}>
                        <Text style={styles.cellText}>
                          {dashForEmpty(note.issueDate)}
                        </Text>
                      </View>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[130]]}>
                        <Text style={styles.cellText}>
                          {dashForEmpty(note.catalogNumber)}
                        </Text>
                      </View>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[120]]}>
                        <Text style={styles.cellText}>
                          {dashForEmpty(note.gradingCompany)}
                        </Text>
                      </View>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[110]]}>
                        <Text style={styles.cellText}>
                          {dashForEmpty(note.grade)}
                        </Text>
                      </View>
                      <View style={[styles.cell, FIXED_WIDTH_STYLES[140]]}>
                        <Text style={styles.cellText}>
                          {dashForEmpty(note.serial)}
                        </Text>
                      </View>
                      <View style={[styles.cell, { width: tagsWidth }]}>
                        {tags.length === 0 ? (
                          <Text style={styles.cellText}>-</Text>
                        ) : (
                          <View style={styles.tagsCell}>
                            {tags.map((name) => (
                              <Pressable
                                key={name}
                                testID={`tag-chip-${name}`}
                                accessibilityLabel={`Filter by tag ${name}`}
                                onPress={() => applyTagFilter(name)}
                                style={styles.tagChip}>
                                <Text style={styles.tagChipText}>{name}</Text>
                              </Pressable>
                            ))}
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badge: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
    backgroundColor: viewerLight.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: viewerLight.border,
  },
  badgeText: {
    color: viewerLight.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 15,
  },
  pill: {
    height: 48,
    marginLeft: 'auto',
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: viewerLight.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: viewerLight.border,
  },
  pillText: {
    color: viewerLight.text,
    fontSize: 14,
    fontWeight: '700',
  },
  importButton: {
    height: 48,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: viewerLight.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: viewerLight.border,
  },
  importGlyph: {
    color: viewerLight.accent,
    fontSize: 20,
    fontWeight: '800',
  },
  collectionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: viewerLight.surfaceContainer,
  },
  chipActive: {
    backgroundColor: viewerLight.accent,
  },
  chipText: {
    color: viewerLight.accentStrong,
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: viewerLight.surface,
  },
  searchWrap: {
    maxWidth: 420,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: viewerLight.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: viewerLight.text,
    backgroundColor: viewerLight.surface,
  },
  clearButton: {
    marginLeft: 8,
    height: 40,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: viewerLight.surfaceContainer,
  },
  clearGlyph: {
    color: viewerLight.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  tableCard: {
    backgroundColor: viewerLight.surface,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: viewerLight.border,
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: viewerLight.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  hscroll: {
    flexGrow: 0,
  },
  tableContent: {
    paddingHorizontal: TABLE_HORIZONTAL_PADDING,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: viewerLight.tableHeader,
  },
  headerCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  headerCellText: {
    color: viewerLight.accentStrong,
    fontSize: 13,
    fontWeight: '800',
  },
  headerCellPlain: {
    color: viewerLight.text,
    fontSize: 13,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TABLE_ROW_HEIGHT,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: viewerLight.borderSoft,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: {
    color: viewerLight.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  thumbWrap: {
    width: 96,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagsCell: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  tagChip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: viewerLight.tagBorder,
    backgroundColor: viewerLight.tagBackground,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagChipText: {
    color: viewerLight.tagText,
    fontSize: 12,
    fontWeight: '600',
  },
});
