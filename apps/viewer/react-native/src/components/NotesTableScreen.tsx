import {
  activeCollectionNotes,
  noteImageUri,
  notePreviewImage,
  type NoteRecord,
} from '../shared/viewer-core';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type ListRenderItemInfo,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { viewerLight } from '../theme/viewerTheme';

import { NoteImageView } from './NoteImageView';
import { CloseIcon, ImageIcon, SearchIcon, UploadIcon } from './ViewerIcons';
import type { ViewerControllerState } from '../state/useViewerController';

// Bundled copy of the Flutter header logo
// (apps/viewer/flutter/web/icons/Icon-192.png).
const logoSource = require('../assets/Icon-192.png');

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

interface TableRowProps {
  note: NoteRecord;
  index: number;
  tagsWidth: number;
  onOpen: (index: number) => void;
  onTagFilter: (tagName: string) => void;
}

// Memoized so scrolling a 300+ row virtualized list only re-renders rows
// whose note object (or column width) actually changed.
const TableRow = memo(function TableRow({
  note,
  index,
  tagsWidth,
  onOpen,
  onTagFilter,
}: TableRowProps) {
  const tags = note.tags
    .map((tag) => tag.name.trim())
    .filter((name) => name.length > 0);
  const thumbUri = noteImageUri(notePreviewImage(note, 'front'));

  return (
    <Pressable
      key={note.id}
      testID={`table-row-${note.id}`}
      accessibilityLabel={`Open note ${note.id}`}
      onPress={() => onOpen(index)}
      style={styles.row}>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[90]]}>
        <Text style={styles.cellText}>{note.displayOrder}</Text>
      </View>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[120]]}>
        <View
          testID={thumbUri ? `thumb-${note.id}` : `thumb-placeholder-${note.id}`}
          style={styles.thumbWrap}>
          <NoteImageView
            uri={thumbUri}
            width={96}
            height={56}
            fit="cover"
            radius={10}
            placeholderIcon={
              <ImageIcon size={22} color={viewerLight.textMuted} />
            }
          />
        </View>
      </View>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[190]]}>
        <Text style={styles.cellText}>{dashForEmpty(note.denomination)}</Text>
      </View>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[120]]}>
        <Text style={styles.cellText}>{dashForEmpty(note.issueDate)}</Text>
      </View>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[130]]}>
        <Text style={styles.cellText}>{dashForEmpty(note.catalogNumber)}</Text>
      </View>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[120]]}>
        <Text style={styles.cellText}>{dashForEmpty(note.gradingCompany)}</Text>
      </View>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[110]]}>
        <Text style={styles.cellText}>{dashForEmpty(note.grade)}</Text>
      </View>
      <View style={[styles.cell, FIXED_WIDTH_STYLES[140]]}>
        <Text style={styles.cellText}>{dashForEmpty(note.serial)}</Text>
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
                onPress={() => onTagFilter(name)}
                style={styles.tagChip}>
                <Text style={styles.tagChipText}>{name}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
});

function TableRowSeparator() {
  return <View style={styles.rowSeparator} />;
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
  const vListRef = useRef<FlatList<NoteRecord> | null>(null);
  const prevCollectionIdRef = useRef<number | null | undefined>(undefined);

  const totalNotes = activeCollectionNotes(
    controller.dataset,
    controller.activeCollectionId,
  ).length;
  const visibleNotes = controller.filteredNotes;
  // O(n) over the filtered notes; memoized so typing/scroll renders that
  // don't change the list don't recompute the width.
  const tagsWidth = useMemo(
    () => calculateTagsColumnWidth(visibleNotes),
    [visibleNotes],
  );
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
    vListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [controller, controller.activeCollectionId]);

  // Estimate only: rows vary in height (tag chips wrap), so this is just
  // the fallback when scrollToIndex can't measure the target yet.
  const estimatedRowOffset = (index: number) =>
    index * (TABLE_ROW_HEIGHT + TABLE_ROW_SEPARATOR_HEIGHT);

  // setQuery is a stable useState setter, unlike the controller object
  // identity (recreated every render): depend on it so memoized rows below
  // aren't invalidated by unrelated re-renders.
  const { setQuery } = controller;

  const applyTagFilter = useCallback(
    (tagName: string) => {
      setQuery(`tags: ${tagName}`);
      hScrollRef.current?.scrollTo({ x: 0, animated: false });
    },
    [setQuery],
  );

  const scrollToEstimatedOffset = useCallback((index: number) => {
    vListRef.current?.scrollToOffset({
      offset: estimatedRowOffset(index),
      animated: true,
    });
  }, []);

  const revealNoteById = useCallback(
    (notes: NoteRecord[], noteId: number) => {
      const index = notes.findIndex((note) => note.id === noteId);
      if (index < 0) {
        return;
      }

      // Rows have variable height (tag chips wrap), so no getItemLayout:
      // scrollToIndex measures on demand. An unmeasured target reports
      // through onScrollToIndexFailed, which falls back to the estimate.
      // viewPosition 0 keeps the original top-aligned reveal.
      vListRef.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0,
      });
    },
    [],
  );

  const openRow = async (index: number) => {
    const result = await onOpenSlideshow?.(visibleNotes, index);
    if (!result) {
      return;
    }

    hScrollRef.current?.scrollTo({ x: 0, animated: false });
    if (result.tagName) {
      // Canonical `tags:` filter (fixes Flutter's raw-name inconsistency).
      setQuery(`tags: ${result.tagName}`);
    }
    revealNoteById(visibleNotes, result.noteId);
  };

  const handleOpenRow = useCallback(
    (index: number) => {
      openRow(index);
    },
    // openRow closes over visibleNotes/onOpenSlideshow/setQuery; re-create
    // the stable callback when they change so memoized rows stay correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleNotes, onOpenSlideshow, setQuery],
  );

  const keyExtractor = useCallback((note: NoteRecord) => String(note.id), []);

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<NoteRecord>) => (
      <TableRow
        note={item}
        index={index}
        tagsWidth={tagsWidth}
        onOpen={handleOpenRow}
        onTagFilter={applyTagFilter}
      />
    ),
    [tagsWidth, handleOpenRow, applyTagFilter],
  );

  const canShowImport =
    controller.canManageImportedDatasets && onOpenImport != null;
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={styles.badge} accessibilityLabel="Note Harbor">
          <Image
            source={logoSource}
            style={styles.badgeLogo}
            accessibilityLabel="Note Harbor logo"
          />
          <Text style={styles.badgeText}>Note{'\n'}Harbor</Text>
        </View>
        <View style={styles.pill}>
          <Text testID="notes-pill" style={styles.pillText}>
            <Text style={styles.pillLabel}>Notes: </Text>
            {`${visibleNotes.length} / ${totalNotes}`}
          </Text>
        </View>
        {canShowImport ? (
          <Pressable
            testID="import-button"
            accessibilityLabel="Manage imported archives"
            onPress={onOpenImport}
            style={styles.importButton}>
            <UploadIcon size={20} color={viewerLight.accent} />
          </Pressable>
        ) : null}
      </View>

      <View
        testID="table-search-field"
        style={[
          styles.searchField,
          searchFocused && styles.searchFieldFocused,
        ]}>
        <SearchIcon size={18} color={viewerLight.textMuted} />
        <TextInput
          testID="table-search"
          value={controller.query}
          onChangeText={controller.setQuery}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
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
            <CloseIcon size={18} color={viewerLight.textMuted} />
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
            style={styles.hscroll}
            contentContainerStyle={styles.hscrollContent}>
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
              <View testID="table-header-divider" style={styles.tableHeaderDivider} />
              <FlatList
                testID="table-vscroll"
                ref={vListRef}
                data={visibleNotes}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                style={styles.vscroll}
                contentContainerStyle={styles.vscrollContent}
                initialNumToRender={15}
                maxToRenderPerBatch={10}
                windowSize={7}
                updateCellsBatchingPeriod={50}
                removeClippedSubviews
                ItemSeparatorComponent={TableRowSeparator}
                onScrollToIndexFailed={(info) => {
                  // Rows vary in height (tag chips wrap), so an unmeasured
                  // target can fail: fall back to the estimated offset.
                  scrollToEstimatedOffset(info.index);
                }}
              />
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    gap: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badge: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 14,
    paddingVertical: 6,
    backgroundColor: viewerLight.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: viewerLight.border,
    shadowColor: viewerLight.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 4,
  },
  badgeLogo: {
    width: 36,
    height: 36,
    borderRadius: 12,
  },
  badgeText: {
    marginLeft: 12,
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
  },
  pillLabel: {
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
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: viewerLight.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 4,
    backgroundColor: viewerLight.surface,
  },
  searchFieldFocused: {
    borderWidth: 1.5,
    borderColor: viewerLight.accent,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    color: viewerLight.text,
  },
  clearButton: {
    height: 32,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableCard: {
    flex: 1,
    minHeight: 0,
    backgroundColor: viewerLight.surface,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: viewerLight.border,
    shadowColor: viewerLight.shadow,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 28,
    elevation: 8,
    overflow: 'hidden',
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
    flex: 1,
    minHeight: 0,
  },
  hscrollContent: {
    flexGrow: 1,
    minHeight: '100%',
  },
  tableContent: {
    flexGrow: 1,
    minHeight: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: viewerLight.tableHeader,
    paddingHorizontal: TABLE_HORIZONTAL_PADDING,
    paddingVertical: 4,
  },
  tableHeaderDivider: {
    height: 2,
    backgroundColor: viewerLight.borderControl,
  },
  vscroll: {
    flex: 1,
    minHeight: 0,
  },
  vscrollContent: {
    flexGrow: 1,
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
    paddingHorizontal: TABLE_HORIZONTAL_PADDING,
    paddingVertical: 12,
  },
  rowSeparator: {
    height: TABLE_ROW_SEPARATOR_HEIGHT,
    backgroundColor: viewerLight.borderSoft,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: {
    color: viewerLight.text,
    fontSize: 14,
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
