import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  noteFullImage,
  noteImageUri,
  noteTitle,
  type NoteRecord,
} from '../shared/viewer-core';
import { viewerDark, viewerRadii } from '../theme/viewerTheme';

declare const window: unknown | undefined;

export type PopoverFace = 'front' | 'back';

export interface PopoverItem {
  note: NoteRecord;
  face: PopoverFace;
  uri: string | null;
}

// Collection-wide front/back interleaved sequence (2N). Nulls are kept as
// placeholder pages so the `k / 2N` counter stays positional. Overlays use
// the full variant (ticket 08: preview in lists, full in overlays).
export function buildPopoverSequence(notes: NoteRecord[]): PopoverItem[] {
  const items: PopoverItem[] = [];
  for (const note of notes) {
    for (const face of ['front', 'back'] as const) {
      items.push({ note, face, uri: noteImageUri(noteFullImage(note, face)) });
    }
  }
  return items;
}

export function popoverInitialIndex(
  notes: NoteRecord[],
  noteId?: number,
  face?: PopoverFace,
): number {
  const count = notes.length * 2;
  if (count === 0) {
    return 0;
  }
  const noteIndex = notes.findIndex((note) => note.id === noteId);
  if (noteIndex < 0) {
    return 0;
  }
  return clampPopoverIndex(count, noteIndex * 2 + (face === 'back' ? 1 : 0));
}

export function clampPopoverIndex(count: number, index: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.min(Math.max(0, index), count - 1);
}

export function nextPopoverIndex(count: number, current: number): number {
  if (count <= 0) {
    return 0;
  }
  return (current + 1) % count;
}

export function prevPopoverIndex(count: number, current: number): number {
  if (count <= 0) {
    return 0;
  }
  return (current - 1 + count) % count;
}

export function popoverCounterText(index: number, count: number): string {
  return `${index + 1} / ${count}`;
}

export type PopoverKeyAction = 'close' | 'next' | 'previous' | null;

export function popoverKeyAction(
  key: string,
  isDesktopLike: boolean,
): PopoverKeyAction {
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

// Zoom math ported from Flutter's _ZoomableImagePage (image_lightbox.dart).
// Logical size is intrinsic pixels over the device pixel ratio; the fitted
// size contains it in the viewport; 1:1 scale is logical over fitted.
export function fittedContentSize(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  pixelRatio = 2,
): { width: number; height: number } {
  const logicalWidth = naturalWidth / Math.max(1, pixelRatio);
  const logicalHeight = naturalHeight / Math.max(1, pixelRatio);
  if (
    logicalWidth <= 0 ||
    logicalHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return { width: viewportWidth, height: viewportHeight };
  }
  const fitScale = Math.min(
    viewportWidth / logicalWidth,
    viewportHeight / logicalHeight,
  );
  return {
    width: logicalWidth * fitScale,
    height: logicalHeight * fitScale,
  };
}

export function realSizeScale(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  pixelRatio = 2,
): number {
  const ratio = Math.max(1, pixelRatio);
  const logicalWidth = naturalWidth / ratio;
  const logicalHeight = naturalHeight / ratio;
  const fitted = fittedContentSize(
    naturalWidth,
    naturalHeight,
    viewportWidth,
    viewportHeight,
    pixelRatio,
  );
  if (
    logicalWidth <= 0 ||
    logicalHeight <= 0 ||
    fitted.width <= 0 ||
    fitted.height <= 0
  ) {
    return 1;
  }
  return Math.max(
    1,
    Math.max(logicalWidth / fitted.width, logicalHeight / fitted.height),
  );
}

// Flutter's _kMaxZoomCap: 1:1 wins when it demands more than ~12x.
export function maxZoomScale(realScale: number): number {
  return Math.max(realScale, 12);
}

export function clampZoomScale(scale: number, maxScale: number): number {
  return Math.min(Math.max(1, scale), Math.max(1, maxScale));
}

// Double-tap toggles between fit and 1:1; when 1:1 never exceeds fit the
// target stays at 1 (Zoom view gated, matching Flutter).
export function toggleZoomTarget(
  currentScale: number,
  realScale: number,
  maxScale: number,
): number {
  if (currentScale > 1.01) {
    return 1;
  }
  return clampZoomScale(realScale, maxScale);
}

export function isZoomed(scale: number): boolean {
  return scale > 1.01;
}

export interface PopoverOffset {
  x: number;
  y: number;
}

export function clampPopoverOffset(
  offset: PopoverOffset,
  fittedWidth: number,
  fittedHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  scale: number,
): PopoverOffset {
  const maxDx = Math.max(0, (fittedWidth * scale - viewportWidth) / 2);
  const maxDy = Math.max(0, (fittedHeight * scale - viewportHeight) / 2);
  return {
    x: Math.min(Math.max(-maxDx, offset.x), maxDx),
    y: Math.min(Math.max(-maxDy, offset.y), maxDy),
  };
}

// Port of Flutter's _offsetForScale: keep the focal point stable across a
// scale change. Offsets are translations of the scaled content center.
export function offsetForScale(
  focal: PopoverOffset,
  viewportCenter: PopoverOffset,
  currentOffset: PopoverOffset,
  currentScale: number,
  nextScale: number,
): PopoverOffset {
  if (currentScale === nextScale) {
    return currentOffset;
  }
  const ratio = nextScale / Math.max(0.0001, currentScale);
  return {
    x:
      focal.x - viewportCenter.x - (focal.x - viewportCenter.x - currentOffset.x) * ratio,
    y:
      focal.y - viewportCenter.y - (focal.y - viewportCenter.y - currentOffset.y) * ratio,
  };
}

const DOUBLE_TAP_WINDOW_MS = 300;

export function ImagePopover({
  notes,
  initialNoteId,
  initialFace = 'front',
  onClose,
  isDesktopLike = Platform.OS === 'macos' ||
    Platform.OS === 'windows' ||
    Platform.OS === 'web',
}: {
  notes: NoteRecord[];
  initialNoteId?: number;
  initialFace?: PopoverFace;
  onClose: (noteId: number | null) => void;
  isDesktopLike?: boolean;
}) {
  const items = useMemo(() => buildPopoverSequence(notes), [notes]);
  const { width: pageWidth } = useWindowDimensions();
  const pagerRef = useRef<ScrollView | null>(null);
  const [currentIndex, setCurrentIndex] = useState(() =>
    popoverInitialIndex(notes, initialNoteId, initialFace),
  );
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  // Zoomed/multi-touch state of the current page drives the pager lock.
  const [currentZoomed, setCurrentZoomed] = useState(false);
  const [currentMultiTouch, setCurrentMultiTouch] = useState(false);
  // Bumped on page change so pages reset zoom (Flutter's _pageGeneration).
  const [pageGeneration, setPageGeneration] = useState(0);

  const scrollToIndex = useCallback(
    (index: number) => {
      pagerRef.current?.scrollTo?.({ x: index * pageWidth, animated: true });
    },
    [pageWidth],
  );

  const goToIndex = useCallback(
    (index: number) => {
      const clamped = clampPopoverIndex(items.length, index);
      setCurrentIndex(clamped);
      setCurrentZoomed(false);
      setCurrentMultiTouch(false);
      setPageGeneration((generation) => generation + 1);
      scrollToIndex(clamped);
    },
    [items.length, scrollToIndex],
  );

  const goNext = useCallback(() => {
    goToIndex(nextPopoverIndex(items.length, currentIndexRef.current));
  }, [items.length, goToIndex]);

  const goPrevious = useCallback(() => {
    goToIndex(prevPopoverIndex(items.length, currentIndexRef.current));
  }, [items.length, goToIndex]);

  const closedRef = useRef(false);
  const close = useCallback(() => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    const item = items[currentIndexRef.current];
    onClose(item ? item.note.id : null);
  }, [items, onClose]);

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
      const action = popoverKeyAction(event.key ?? '', isDesktopLike);
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

  const onZoomStateChanged = useCallback(
    (pageIndex: number, zoomed: boolean, multiTouch: boolean) => {
      if (pageIndex !== currentIndexRef.current) {
        return;
      }
      setCurrentZoomed(zoomed);
      setCurrentMultiTouch(multiTouch);
    },
    [],
  );

  const pagerEnabled =
    items.length > 0 && !currentZoomed && !currentMultiTouch;
  const currentItem = items[currentIndex];

  return (
    // Inline (no Modal): same window as the table/slideshow, same size.
    <View style={styles.screen}>
        <View style={styles.header}>
          <Text
            testID="popover-title"
            style={styles.title}
            numberOfLines={1}
            ellipsizeMode="tail">
            {currentItem ? noteTitle(currentItem.note) : 'No images'}
          </Text>
          <View style={styles.counterPill}>
            <Text testID="popover-counter" style={styles.counterText}>
              {items.length === 0
                ? '0 / 0'
                : popoverCounterText(currentIndex, items.length)}
            </Text>
          </View>
          <Pressable
            testID="popover-back"
            accessibilityLabel="Back to slideshow"
            onPress={() => close()}
            style={styles.backButton}>
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        </View>
        {items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No images to show.</Text>
          </View>
        ) : (
          <ScrollView
            testID="popover-pager"
            ref={pagerRef}
            horizontal
            pagingEnabled
            scrollEnabled={pagerEnabled}
            showsHorizontalScrollIndicator={false}
            style={styles.pager}
            onMomentumScrollEnd={(event) => {
              const measured = event.nativeEvent.layoutMeasurement.width;
              const page = measured > 0 ? measured : pageWidth;
              goToIndex(
                Math.round(
                  event.nativeEvent.contentOffset.x / Math.max(1, page),
                ),
              );
            }}>
            {items.map((item, pageIndex) => (
              <View key={`${item.note.id}-${item.face}`} style={{ width: pageWidth }}>
                <PopoverPage
                  item={item}
                  pageIndex={pageIndex}
                  resetSignal={pageGeneration}
                  onZoomStateChanged={onZoomStateChanged}
                />
              </View>
            ))}
          </ScrollView>
        )}
        {items.length > 0 ? (
          <View style={styles.footer}>
            <Pressable
              testID="popover-prev"
              accessibilityLabel={`Previous image, ${currentIndex + 1} of ${items.length}`}
              onPress={() => goPrevious()}
              style={styles.navButton}>
              <Text style={styles.navText}>‹ Prev</Text>
            </Pressable>
            <Pressable
              testID="popover-next"
              accessibilityLabel={`Next image, ${currentIndex + 1} of ${items.length}`}
              onPress={() => goNext()}
              style={styles.navButton}>
              <Text style={styles.navText}>Next ›</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
  );
}

function touchPoint(touch: {
  locationX?: number;
  locationY?: number;
  pageX?: number;
  pageY?: number;
}): PopoverOffset {
  return {
    x: touch.locationX ?? touch.pageX ?? 0,
    y: touch.locationY ?? touch.pageY ?? 0,
  };
}

function PopoverPage({
  item,
  pageIndex,
  resetSignal,
  onZoomStateChanged,
}: {
  item: PopoverItem;
  pageIndex: number;
  resetSignal: number;
  onZoomStateChanged: (
    pageIndex: number,
    zoomed: boolean,
    multiTouch: boolean,
  ) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [stage, setStage] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<PopoverOffset>({ x: 0, y: 0 });
  const touchesRef = useRef(
    new Map<string | number, PopoverOffset>(),
  );
  const lastSpanRef = useRef<number | null>(null);
  const lastSingleRef = useRef<PopoverOffset | null>(null);
  const lastTapRef = useRef(0);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const viewport = stage ?? {
    width: Math.max(1, windowWidth - 24),
    height: Math.max(1, windowHeight - 220),
  };
  const ratio = PixelRatio.get();
  const realScale = natural
    ? realSizeScale(
        natural.width,
        natural.height,
        viewport.width,
        viewport.height,
        ratio,
      )
    : 1;
  const maxScale = maxZoomScale(realScale);
  const fitted = natural
    ? fittedContentSize(
        natural.width,
        natural.height,
        viewport.width,
        viewport.height,
        ratio,
      )
    : viewport;

  // Resolve the natural size for the 1:1 gate; spinner until then.
  useEffect(() => {
    if (!item.uri) {
      return;
    }
    let cancelled = false;
    setNatural(null);
    setLoaded(false);
    setFailed(false);
    Image.getSize(
      item.uri,
      (width, height) => {
        if (!cancelled) {
          setNatural({ width, height });
        }
      },
      () => {
        if (!cancelled) {
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.uri]);

  // Zoom resets on page change (Flutter's ValueKey + _pageGeneration).
  useEffect(() => {
    touchesRef.current.clear();
    lastSpanRef.current = null;
    lastSingleRef.current = null;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
  }, [resetSignal]);

  const report = useCallback(
    (nextScale: number, nextMultiTouch: boolean) => {
      onZoomStateChanged(pageIndex, isZoomed(nextScale), nextMultiTouch);
    },
    [onZoomStateChanged, pageIndex],
  );

  const applyScale = useCallback(
    (nextScale: number, nextOffset: PopoverOffset, nextMultiTouch: boolean) => {
      const clamped = clampZoomScale(nextScale, maxScale);
      const clampedOffset = clampPopoverOffset(
        clamped <= 1.01 ? { x: 0, y: 0 } : nextOffset,
        fitted.width,
        fitted.height,
        viewport.width,
        viewport.height,
        clamped,
      );
      setScale(clamped);
      setOffset(clampedOffset);
      report(clamped, nextMultiTouch);
    },
    [
      fitted.height,
      fitted.width,
      maxScale,
      report,
      viewport.height,
      viewport.width,
    ],
  );

  const toggleZoom = useCallback(
    (at?: PopoverOffset) => {
      if (!natural || failed) {
        return;
      }
      const target = toggleZoomTarget(scaleRef.current, realScale, maxScale);
      if (target <= 1.01) {
        applyScale(1, { x: 0, y: 0 }, false);
        return;
      }
      const focal = at ?? {
        x: viewport.width / 2,
        y: viewport.height / 2,
      };
      const center = { x: viewport.width / 2, y: viewport.height / 2 };
      const nextOffset = clampPopoverOffset(
        offsetForScale(focal, center, offsetRef.current, 1, target),
        fitted.width,
        fitted.height,
        viewport.width,
        viewport.height,
        target,
      );
      applyScale(target, nextOffset, false);
    },
    [
      applyScale,
      failed,
      fitted.height,
      fitted.width,
      maxScale,
      natural,
      realScale,
      viewport.height,
      viewport.width,
    ],
  );

  const onTogglePress = useCallback(
    (event?: { nativeEvent?: { locationX?: number; locationY?: number } }) => {
      const now = Date.now();
      const last = lastTapRef.current;
      if (now - last > DOUBLE_TAP_WINDOW_MS) {
        lastTapRef.current = now;
        return;
      }
      // Consume the pair so a trailing tap cannot chain into the next one.
      lastTapRef.current = 0;
      toggleZoom(
        event?.nativeEvent
          ? {
              x: event.nativeEvent.locationX ?? viewport.width / 2,
              y: event.nativeEvent.locationY ?? viewport.height / 2,
            }
          : undefined,
      );
    },
    [toggleZoom, viewport.height, viewport.width],
  );

  const spanOf = (points: PopoverOffset[]) => {
    if (points.length < 2) {
      return 1;
    }
    return Math.max(
      1,
      Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
    );
  };

  const focalOf = (points: PopoverOffset[]) => {
    if (points.length === 0) {
      return { x: viewport.width / 2, y: viewport.height / 2 };
    }
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  };

  if (!item.uri) {
    return (
      <View style={styles.pageOuter}>
        <View style={styles.card}>
          <Text testID={`popover-no-image-${pageIndex}`} style={styles.noImage}>
            No image
          </Text>
        </View>
      </View>
    );
  }

  if (failed) {
    return (
      <View style={styles.pageOuter}>
        <View style={styles.card}>
          <Text
            testID={`popover-load-error-${pageIndex}`}
            style={styles.noImage}>
            Couldn&apos;t load image
          </Text>
        </View>
      </View>
    );
  }

  if (!natural) {
    return (
      <View style={styles.pageOuter}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color={viewerDark.accent} />
        </View>
      </View>
    );
  }

  const zoomLabel = isZoomed(scale)
    ? `Reset zoom on ${item.face} image of ${noteTitle(item.note)}`
    : `Zoom ${item.face} image of ${noteTitle(item.note)} to actual size`;

  return (
    <View style={styles.pageOuter}>
      <View style={styles.card}>
        <View
          testID={`popover-zoom-stage-${pageIndex}`}
          style={styles.stage}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setStage({ width: Math.max(1, width), height: Math.max(1, height) });
          }}
          onTouchStart={(event) => {
            const touches = event.nativeEvent.touches ?? [];
            touchesRef.current.clear();
            touches.forEach((touch) => {
              touchesRef.current.set(touch.identifier, touchPoint(touch));
            });
            if (touchesRef.current.size >= 2) {
              const points = [...touchesRef.current.values()];
              lastSpanRef.current = spanOf(points);
              lastSingleRef.current = null;
              report(scaleRef.current, true);
            } else if (touchesRef.current.size === 1) {
              lastSingleRef.current = [...touchesRef.current.values()][0];
            }
          }}
          onTouchMove={(event) => {
            const touches = event.nativeEvent.touches ?? [];
            touches.forEach((touch) => {
              if (touchesRef.current.has(touch.identifier)) {
                touchesRef.current.set(touch.identifier, touchPoint(touch));
              }
            });
            if (touchesRef.current.size >= 2) {
              const points = [...touchesRef.current.values()];
              const span = spanOf(points);
              const focal = focalOf(points);
              const previousSpan = Math.max(1, lastSpanRef.current ?? span);
              const nextScale = clampZoomScale(
                scaleRef.current * (span / previousSpan),
                maxScale,
              );
              const center = {
                x: viewport.width / 2,
                y: viewport.height / 2,
              };
              const nextOffset = offsetForScale(
                focal,
                center,
                offsetRef.current,
                scaleRef.current,
                nextScale,
              );
              lastSpanRef.current = Math.max(1, span);
              lastSingleRef.current = null;
              applyScale(nextScale, nextOffset, true);
            } else if (
              touchesRef.current.size === 1 &&
              isZoomed(scaleRef.current)
            ) {
              const point = [...touchesRef.current.values()][0];
              const last = lastSingleRef.current ?? point;
              lastSingleRef.current = point;
              applyScale(
                scaleRef.current,
                {
                  x: offsetRef.current.x + (point.x - last.x),
                  y: offsetRef.current.y + (point.y - last.y),
                },
                false,
              );
            }
          }}
          onTouchEnd={(event) => {
            const touches = event.nativeEvent.touches ?? [];
            touchesRef.current.clear();
            touches.forEach((touch) => {
              touchesRef.current.set(touch.identifier, touchPoint(touch));
            });
            lastSpanRef.current = null;
            lastSingleRef.current =
              touchesRef.current.size === 1
                ? [...touchesRef.current.values()][0]
                : null;
            if (touchesRef.current.size < 2) {
              report(scaleRef.current, false);
            }
          }}>
          <Pressable
            testID={`popover-zoom-toggle-${pageIndex}`}
            accessibilityLabel={zoomLabel}
            accessibilityActions={[
              {
                name: 'toggleZoom',
                label: isZoomed(scale) ? 'Reset zoom' : 'Zoom to actual size',
              },
            ]}
            onAccessibilityAction={() => toggleZoom()}
            onPress={onTogglePress}
            style={styles.zoomPress}>
            <View
              style={{
                width: fitted.width,
                height: fitted.height,
                transform: [
                  { translateX: offset.x },
                  { translateY: offset.y },
                  { scale },
                ],
              }}>
              <Image
                source={{ uri: item.uri }}
                style={{ width: fitted.width, height: fitted.height }}
                resizeMode="contain"
                accessibilityLabel={zoomLabel}
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
              />
            </View>
          </Pressable>
          {!loaded ? (
            <View
              testID={`popover-loading-${pageIndex}`}
              pointerEvents="none"
              style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={viewerDark.accent} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
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
    gap: 12,
  },
  title: {
    flex: 1,
    color: viewerDark.text,
    fontSize: 17,
    fontWeight: '700',
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
  pageOuter: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
  },
  pager: {
    flex: 1,
  },
  card: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: viewerDark.surface,
    borderRadius: viewerRadii.lg,
    borderWidth: 1,
    borderColor: viewerDark.border,
    overflow: 'hidden',
    padding: 16,
  },
  stage: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomPress: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noImage: {
    color: viewerDark.muted,
    fontSize: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: viewerDark.scrim,
    borderRadius: viewerRadii.md,
  },
  navText: {
    color: viewerDark.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
