import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  normalizeSourceUrl,
  noteImageUri,
  notePreviewImage,
  noteTitle,
  type NoteRecord,
} from '../shared/viewer-core';
import { viewerDark, viewerRadii } from '../theme/viewerTheme';

import { NoteImageView } from './NoteImageView';
import type { SlideshowReturn } from './NotesTableScreen';

declare const window: unknown | undefined;

export type SlideshowImageFace = 'front' | 'back';

// Image popover contract (ticket 11: ImagePopover over the filtered notes,
// returning the current Note identity for jump-back sync). Optional mirrors
// Flutter's null guard; App.tsx wires it.
export type OpenImagePopover = (
  note: NoteRecord,
  face: SlideshowImageFace,
) => Promise<number | null>;

export interface NoteSlideshowHandle {
  jumpToNoteId: (noteId: number) => void;
}

export function clampSlideshowIndex(count: number, index: number): number {
  if (count <= 0) {
    return 0;
  }

  return Math.min(Math.max(0, index), count - 1);
}

export function nextSlideshowIndex(count: number, current: number): number {
  if (count <= 0) {
    return 0;
  }

  return (current + 1) % count;
}

export function prevSlideshowIndex(count: number, current: number): number {
  if (count <= 0) {
    return 0;
  }

  return (current - 1 + count) % count;
}

export function slideshowCounterText(index: number, count: number): string {
  return `${index + 1} / ${count}`;
}

export type SlideshowKeyAction = 'close' | 'next' | 'previous' | null;

export function slideshowKeyAction(
  key: string,
  isDesktopLike: boolean,
): SlideshowKeyAction {
  if (key === 'Escape') {
    return 'close';
  }

  if (!isDesktopLike) {
    return null;
  }

  if (key === 'ArrowLeft') {
    return 'previous';
  }

  if (key === 'ArrowRight') {
    return 'next';
  }

  return null;
}

export function isScrolledToBottom(
  offsetY: number,
  viewportHeight: number,
  contentHeight: number,
): boolean {
  return offsetY >= contentHeight - viewportHeight - 1;
}

export interface SlideshowDetailRow {
  label: string;
  value: string;
}

export function slideshowDetailRows(note: NoteRecord): SlideshowDetailRow[] {
  return (
    [
      { label: 'Date', value: note.issueDate },
      { label: 'Catalog', value: note.catalogNumber },
      { label: 'Grade', value: note.grade },
      { label: 'Serial', value: note.serial },
      { label: 'Watermark', value: note.watermark },
    ] as SlideshowDetailRow[]
  ).filter((row) => row.value.trim().length > 0);
}

function slideshowTags(note: NoteRecord): string[] {
  return note.tags
    .map((tag) => tag.name.trim())
    .filter((name) => name.length > 0);
}

const FADE_STRIP_OPACITIES = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];

export const NoteSlideshow = forwardRef(function NoteSlideshow(
  {
    notes,
    initialIndex,
    onClose,
    onOpenPopover,
    isDesktopLike = Platform.OS === 'macos' ||
      Platform.OS === 'windows' ||
      Platform.OS === 'web',
  }: {
    notes: NoteRecord[];
    initialIndex: number;
    onClose: (result: SlideshowReturn | null) => void;
    onOpenPopover?: OpenImagePopover;
    isDesktopLike?: boolean;
  },
  ref: React.Ref<NoteSlideshowHandle>,
) {
  const { width: windowWidth } = useWindowDimensions();
  const pagerRef = useRef<ScrollView | null>(null);
  // Inline in the shared Card: measure our own width so pages match the
  // visible column instead of overflowing past the Card padding.
  const [containerWidth, setContainerWidth] = useState(0);
  const pageWidth = containerWidth > 0 ? containerWidth : windowWidth;
  const [currentIndex, setCurrentIndex] = useState(() =>
    clampSlideshowIndex(notes.length, initialIndex),
  );
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;

  const scrollToIndex = useCallback(
    (index: number) => {
      pagerRef.current?.scrollTo?.({ x: index * pageWidth, animated: true });
    },
    [pageWidth],
  );

  const goToIndex = useCallback(
    (index: number) => {
      const clamped = clampSlideshowIndex(notes.length, index);
      setCurrentIndex(clamped);
      scrollToIndex(clamped);
    },
    [notes.length, scrollToIndex],
  );

  const goNext = useCallback(() => {
    const next = nextSlideshowIndex(notes.length, currentIndexRef.current);
    setCurrentIndex(next);
    scrollToIndex(next);
  }, [notes.length, scrollToIndex]);

  const goPrevious = useCallback(() => {
    const previous = prevSlideshowIndex(notes.length, currentIndexRef.current);
    setCurrentIndex(previous);
    scrollToIndex(previous);
  }, [notes.length, scrollToIndex]);

  const jumpToNoteId = useCallback(
    (noteId: number) => {
      const index = notes.findIndex((note) => note.id === noteId);
      if (index >= 0) {
        goToIndex(index);
      }
    },
    [notes, goToIndex],
  );

  useImperativeHandle(ref, () => ({ jumpToNoteId }), [jumpToNoteId]);

  const closedRef = useRef(false);
  const close = useCallback(
    (tagName?: string) => {
      // onDismiss can fire after a programmatic close unmounts the modal;
      // resolve the open contract exactly once.
      if (closedRef.current) {
        return;
      }
      closedRef.current = true;

      const note = notes[currentIndexRef.current];
      onClose(note ? { noteId: note.id, tagName } : null);
    },
    [notes, onClose],
  );

  // Esc closes everywhere; arrows page with wrap on desktop-like targets.
  // Android hardware back arrives via Modal onRequestClose and iOS
  // swipe-dismiss via onDismiss, all on the same close path. The window
  // listener only fires where window key events exist (web); native
  // macOS/Windows key handling needs a native key module (out of scope).
  useEffect(() => {
    const target = window as unknown as
      | {
          addEventListener?: (type: string, listener: (event: { key?: string }) => void) => void;
          removeEventListener?: (type: string, listener: (event: { key?: string }) => void) => void;
        }
      | undefined;
    if (typeof target?.addEventListener !== 'function') {
      return undefined;
    }

    const onKeyDown = (event: { key?: string }) => {
      const action = slideshowKeyAction(event.key ?? '', isDesktopLike);
      if (action === 'close') {
        close();
      } else if (action === 'next') {
        goNext();
      } else if (action === 'previous') {
        goPrevious();
      }
    };

    target.addEventListener('keydown', onKeyDown);
    return () => target.removeEventListener?.('keydown', onKeyDown);
  }, [close, goNext, goPrevious, isDesktopLike]);

  const openPopover = useCallback(
    async (note: NoteRecord, face: SlideshowImageFace) => {
      if (!onOpenPopover) {
        return;
      }

      const noteId = await onOpenPopover(note, face);
      if (noteId != null) {
        jumpToNoteId(noteId);
      }
    },
    [onOpenPopover, jumpToNoteId],
  );

  return (
    // Inline (no Modal): shares the main window with the table, so it keeps
    // the same dimensions and stays resizable. A Modal opens a separate
    // native window on Windows/macOS that fills the screen.
    <View
      style={styles.screen}
      onLayout={(event) => {
        const { width } = event.nativeEvent.layout;
        if (width > 0 && Math.abs(width - containerWidth) > 1) {
          setContainerWidth(width);
        }
      }}>
        <View style={styles.header}>
          <View style={styles.spacer} />
          <View style={styles.counterPill}>
            <Text testID="slideshow-counter" style={styles.counterText}>
              {slideshowCounterText(currentIndex, notes.length)}
            </Text>
          </View>
          <Pressable
            testID="slideshow-back"
            accessibilityLabel="Back to table"
            onPress={() => close()}
            style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>
        {notes.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No notes to show.</Text>
          </View>
        ) : (
          <ScrollView
            testID="slideshow-pager"
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.pager}
            onMomentumScrollEnd={(event) => {
              const measured = event.nativeEvent.layoutMeasurement.width;
              const page = measured > 0 ? measured : pageWidth;
              setCurrentIndex(
                clampSlideshowIndex(
                  notes.length,
                  Math.round(event.nativeEvent.contentOffset.x / Math.max(1, page)),
                ),
              );
            }}>
            {notes.map((note) => (
              <View key={note.id} style={{ width: pageWidth }}>
                <NoteSlide
                  note={note}
                  imageWidth={Math.max(1, pageWidth - 56)}
                  onTagTap={(tagName) => close(tagName)}
                  onImageTap={(face) => openPopover(note, face)}
                />
              </View>
            ))}
          </ScrollView>
        )}
      </View>
  );
});

function NoteSlide({
  note,
  imageWidth,
  onTagTap,
  onImageTap,
}: {
  note: NoteRecord;
  imageWidth: number;
  onTagTap: (tagName: string) => void;
  onImageTap: (face: SlideshowImageFace) => void;
}) {
  const [atBottom, setAtBottom] = useState(false);
  const tags = slideshowTags(note);
  const rows = slideshowDetailRows(note);
  const notesText = note.notes.trim().length === 0 ? 'No extra notes.' : note.notes;
  const hasSourceUrl = note.url.trim().length > 0;

  const openSourceUrl = async () => {
    const normalized = normalizeSourceUrl(note.url);
    if (!normalized) {
      return;
    }

    await Linking.openURL(normalized);
  };

  return (
    <View style={styles.slideOuter}>
      <View style={styles.slideCard}>
        <ScrollView
          testID={`slide-scroll-${note.id}`}
          style={styles.slideScroll}
          contentContainerStyle={styles.slideContent}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            setAtBottom(
              isScrolledToBottom(
                contentOffset.y,
                layoutMeasurement.height,
                contentSize.height,
              ),
            );
          }}
          scrollEventThrottle={16}>
          <Text testID={`slide-title-${note.id}`} style={styles.title}>
            {noteTitle(note)}
          </Text>
          {note.gradingCompany.trim().length > 0 ? (
            <Text testID={`slide-company-${note.id}`} style={styles.company}>
              {note.gradingCompany}
            </Text>
          ) : null}
          <View style={styles.imagesGap} />
          <SlideImage note={note} face="front" imageWidth={imageWidth} onImageTap={onImageTap} />
          <View style={styles.imagesGap} />
          <SlideImage note={note} face="back" imageWidth={imageWidth} onImageTap={onImageTap} />
          <View style={styles.imagesGap} />
          <View style={styles.metaPanel}>
            {rows.map((row) => (
              <View key={row.label}>
                <Text style={styles.metaLabel}>{row.label}</Text>
                <Text testID={`meta-row-${row.label}-${note.id}`} style={styles.metaValue}>
                  {row.value}
                </Text>
                <View style={styles.metaGap} />
              </View>
            ))}
            {tags.length > 0 ? (
              <View testID={`slide-tags-${note.id}`}>
                <Text style={styles.metaLabel}>Tags</Text>
                <View style={styles.tagsWrap}>
                  {tags.map((name) => (
                    <Pressable
                      key={name}
                      testID={`slideshow-tag-${note.id}-${name}`}
                      accessibilityLabel={`Filter table by tag ${name}`}
                      onPress={() => onTagTap(name)}
                      style={styles.tagChip}>
                      <Text style={styles.tagChipText}>{name}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.metaGap} />
              </View>
            ) : null}
            {hasSourceUrl ? (
              <View>
                <Text style={styles.metaLabel}>Source URL</Text>
                <Pressable
                  testID={`slide-source-url-${note.id}`}
                  accessibilityLabel={`Open source URL ${note.url}`}
                  onPress={openSourceUrl}>
                  <Text style={styles.sourceUrl}>{note.url}</Text>
                </Pressable>
                <View style={styles.metaGap} />
              </View>
            ) : null}
            <Text style={styles.metaLabel}>Notes</Text>
            <Text testID={`slide-notes-${note.id}`} style={styles.notesText}>
              {notesText}
            </Text>
          </View>
        </ScrollView>
        <View
          testID={`slide-fade-${note.id}`}
          pointerEvents="none"
          style={[styles.bottomFade, atBottom && styles.fadeHidden]}>
          {/* No built-in gradient in RN: stacked translucent strips
              approximate Flutter's transparent-to-card fade. */}
          {FADE_STRIP_OPACITIES.map((stripOpacity, index) => (
            <View
              key={index}
              style={[
                styles.fadeStrip,
                { backgroundColor: viewerDark.surface, opacity: stripOpacity },
              ]}
            />
          ))}
        </View>
      </View>
      <View pointerEvents="none" style={styles.slideBorder} />
    </View>
  );
}

function SlideImage({
  note,
  face,
  imageWidth,
  onImageTap,
}: {
  note: NoteRecord;
  face: SlideshowImageFace;
  imageWidth: number;
  onImageTap: (face: SlideshowImageFace) => void;
}) {
  const uri = noteImageUri(notePreviewImage(note, face));
  const imageHeight = Math.round(imageWidth / 1.65);
  const label = `${face} image of ${noteTitle(note)}`;

  if (!uri) {
    return (
      <View testID={`slideshow-image-placeholder-${face}-${note.id}`}>
        <NoteImageView
          uri={null}
          tone="dark"
          width={imageWidth}
          height={imageHeight}
          label={label}
        />
      </View>
    );
  }

  return (
    <Pressable
      testID={`slideshow-image-tap-${face}-${note.id}`}
      accessibilityLabel={`Open ${face} image fullscreen`}
      onPress={() => onImageTap(face)}>
      <NoteImageView
        uri={uri}
        tone="dark"
        errorLabel="Missing image"
        width={imageWidth}
        height={imageHeight}
        label={label}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: viewerDark.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  spacer: {
    flex: 1,
  },
  counterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: viewerDark.scrim,
    borderRadius: viewerRadii.md,
  },
  counterText: {
    color: viewerDark.text,
    fontSize: 15,
    fontWeight: '600',
  },
  backButton: {
    marginLeft: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: viewerDark.scrim,
    borderRadius: viewerRadii.md,
  },
  backText: {
    color: viewerDark.text,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: viewerDark.muted,
    fontSize: 15,
    fontWeight: '600',
  },
  slideOuter: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  pager: {
    flex: 1,
  },
  slideScroll: {
    flex: 1,
  },
  slideCard: {
    flex: 1,
    margin: 1,
    backgroundColor: viewerDark.surface,
    borderRadius: viewerRadii.lg,
    overflow: 'hidden',
  },
  slideBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: viewerRadii.lg,
    borderWidth: 1,
    borderColor: viewerDark.border,
  },
  slideContent: {
    padding: 16,
  },
  title: {
    color: viewerDark.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  company: {
    marginTop: 4,
    color: viewerDark.accent,
    fontSize: 15,
    textAlign: 'center',
  },
  imagesGap: {
    height: 12,
  },
  metaPanel: {
    backgroundColor: viewerDark.raised,
    borderRadius: viewerRadii.lg,
    borderWidth: 1,
    borderColor: viewerDark.border,
    padding: 20,
  },
  metaLabel: {
    color: viewerDark.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  metaValue: {
    marginTop: 3,
    color: viewerDark.text,
    fontSize: 16,
    fontWeight: '600',
  },
  metaGap: {
    height: 14,
  },
  tagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  tagChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: viewerDark.tagBackground,
    borderWidth: 1,
    borderColor: viewerDark.tagBorder,
    borderRadius: viewerRadii.lg,
  },
  tagChipText: {
    color: viewerDark.tagText,
    fontSize: 14,
    fontWeight: '600',
  },
  sourceUrl: {
    marginTop: 3,
    color: viewerDark.accent,
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  notesText: {
    marginTop: 3,
    color: viewerDark.text,
    fontSize: 15,
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 72,
    opacity: 1,
  },
  fadeHidden: {
    opacity: 0,
  },
  fadeStrip: {
    flex: 1,
  },
});
