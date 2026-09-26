import React from 'react';
import { Linking, Platform, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { NoteRecord } from '../shared/viewer-core';
import {
  clampSlideshowIndex,
  isScrolledToBottom,
  isSlideshowIndexMounted,
  nextSlideshowIndex,
  NoteSlideshow,
  prevSlideshowIndex,
  slideshowCounterText,
  slideshowDetailRows,
  slideshowKeyAction,
  slideshowNativeKeyAction,
  SLIDESHOW_OFFSCREEN_LIMIT,
  type NoteSlideshowHandle,
} from './NoteSlideshow';
import type { SlideshowReturn } from './NotesTableScreen';

function makeNote(overrides: Partial<NoteRecord> = {}): NoteRecord {
  return {
    id: 1,
    collectionId: 1,
    displayOrder: 1,
    denomination: '5 Lei',
    issueDate: '1991',
    catalogNumber: 'P-98',
    gradingCompany: 'PMG',
    grade: '64',
    watermark: '',
    serial: 'AB123456',
    url: '',
    notes: '',
    scrapeStatus: 'done',
    scrapeError: '',
    tags: [{ name: 'Romania' }],
    images: [],
    scrapedData: null,
    ...overrides,
  };
}

const baseNotes = [
  makeNote({ id: 1, displayOrder: 1 }),
  makeNote({
    id: 2,
    displayOrder: 2,
    denomination: '10 Lei',
    catalogNumber: 'P-90',
    issueDate: '',
    gradingCompany: '',
    grade: '',
    serial: '',
    tags: [],
  }),
];

type TestTree = ReactTestRenderer.ReactTestRenderer;

// RN jest mocks render composite + host nodes with the same props, so testID
// lookups match twice. Take the first (composite) match for interaction.
function byTestId(tree: TestTree, testID: string) {
  const nodes = tree.root.findAll((node) => node.props?.testID === testID);
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0];
}

function absentTestId(tree: TestTree, testID: string) {
  expect(
    tree.root.findAll((node) => node.props?.testID === testID).length,
  ).toBe(0);
}

function textContent(tree: TestTree, testID: string): string {
  const children = byTestId(tree, testID).findAllByType(Text)[0].props.children;
  return (Array.isArray(children) ? children : [children]).join('');
}

function renderSlideshow(
  props: Partial<React.ComponentProps<typeof NoteSlideshow>> = {},
  ref?: React.Ref<NoteSlideshowHandle>,
) {
  let tree!: TestTree;
  act(() => {
    tree = ReactTestRenderer.create(
      <NoteSlideshow
        notes={baseNotes}
        initialIndex={0}
        onClose={jest.fn()}
        {...props}
        ref={ref}
      />,
    );
  });
  return tree;
}

beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Capture window keydown listeners registered by the slideshow (the jest
// setup stubs addEventListener as a noop, so swap in a recorder per test).
function captureKeyListeners() {
  const added: Array<(event: { key?: string }) => void> = [];
  const globalWindow = globalThis as unknown as {
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  const prevAdd = globalWindow.addEventListener;
  const prevRemove = globalWindow.removeEventListener;
  globalWindow.addEventListener = jest.fn(
    (_type: string, listener: (event: { key?: string }) => void) => {
      added.push(listener);
    },
  ) as unknown as typeof globalWindow.addEventListener;
  globalWindow.removeEventListener = jest.fn() as unknown as typeof globalWindow.removeEventListener;

  return {
    added,
    restore() {
      globalWindow.addEventListener = prevAdd;
      globalWindow.removeEventListener = prevRemove;
    },
  };
}

test('renders inline with the position counter and Back', () => {
  const tree = renderSlideshow();

  expect(textContent(tree, 'slideshow-counter')).toBe('1 / 2');
  expect(textContent(tree, 'slideshow-back')).toBe('Back');
});

test('shows titles with the Untitled fallback', () => {
  const tree = renderSlideshow();
  expect(textContent(tree, 'slide-title-1')).toBe('5 Lei - P-98');
  expect(textContent(tree, 'slide-title-2')).toBe('10 Lei - P-90');

  // Untitled fallback on a single-note slideshow (index 0 always mounted).
  const untitled = renderSlideshow({
    notes: [makeNote({ id: 3, denomination: '', catalogNumber: '' })],
  });
  expect(textContent(untitled, 'slide-title-3')).toBe('Untitled note');
});

test('shows the grading company only when present', () => {
  const tree = renderSlideshow();

  expect(textContent(tree, 'slide-company-1')).toBe('PMG');
  absentTestId(tree, 'slide-company-2');
});

test('meta panel suppresses empty rows and shows non-empty ones', () => {
  const tree = renderSlideshow();

  expect(textContent(tree, 'meta-row-Date-1')).toBe('1991');
  expect(textContent(tree, 'meta-row-Catalog-1')).toBe('P-98');
  absentTestId(tree, 'meta-row-Date-2');
  absentTestId(tree, 'meta-row-Watermark-1');
});

test('tags section renders only when non-empty', () => {
  const tree = renderSlideshow();

  byTestId(tree, 'slide-tags-1');
  absentTestId(tree, 'slide-tags-2');
});

test('notes text falls back to No extra notes.', () => {
  const tree = renderSlideshow();

  expect(textContent(tree, 'slide-notes-1')).toBe('No extra notes.');
  const withNotes = renderSlideshow({
    notes: [makeNote({ notes: 'Kept in a sleeve.' })],
  });
  expect(textContent(withNotes, 'slide-notes-1')).toBe('Kept in a sleeve.');
});

test('missing images render as positional placeholders that still open the popover', async () => {
  const onOpenPopover = jest.fn(() => Promise.resolve<number | null>(null));
  const tree = renderSlideshow({ onOpenPopover });

  byTestId(tree, 'slideshow-image-placeholder-front-1');
  byTestId(tree, 'slideshow-image-placeholder-back-2');

  await act(async () => {
    await byTestId(tree, 'slideshow-image-tap-front-1').props.onPress();
  });
  expect(onOpenPopover).toHaveBeenCalledWith(
    expect.objectContaining({ id: 1 }),
    'front',
  );
});

test('tag tap closes returning noteId and tagName', () => {
  const onClose = jest.fn();
  const tree = renderSlideshow({ onClose });

  act(() => {
    byTestId(tree, 'slideshow-tag-1-Romania').props.onPress();
  });

  expect(onClose).toHaveBeenCalledWith({ noteId: 1, tagName: 'Romania' });
});

test('Back closes returning the current noteId', () => {
  const onClose = jest.fn();
  const tree = renderSlideshow({ onClose });

  act(() => {
    byTestId(tree, 'slideshow-back').props.onPress();
  });

  expect(onClose).toHaveBeenCalledWith({ noteId: 1 });
});

test('Escape closes with the current note', () => {
  const onClose: jest.Mock<void, [SlideshowReturn | null]> = jest.fn();
  const { added, restore } = captureKeyListeners();

  try {
    renderSlideshow({ onClose });
    expect(added.length).toBeGreaterThan(0);
    act(() => {
      added[0]({ key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledWith({ noteId: 1 });
  } finally {
    restore();
  }
});

test('arrow keys page with wrap-around on desktop-like targets only', () => {
  const { added, restore } = captureKeyListeners();

  try {
    const tree = renderSlideshow({ isDesktopLike: true });
    act(() => {
      added[0]({ key: 'ArrowLeft' });
    });
    // Wraps from the first to the last note.
    expect(textContent(tree, 'slideshow-counter')).toBe('2 / 2');

    act(() => {
      added[0]({ key: 'ArrowRight' });
    });
    expect(textContent(tree, 'slideshow-counter')).toBe('1 / 2');

    const plain = renderSlideshow({ isDesktopLike: false });
    act(() => {
      added[1]({ key: 'ArrowRight' });
    });
    expect(textContent(plain, 'slideshow-counter')).toBe('1 / 2');
  } finally {
    restore();
  }
});

test('swiping the pager updates the position counter', () => {
  const tree = renderSlideshow();

  act(() => {
    byTestId(tree, 'slideshow-pager').props.onMomentumScrollEnd({
      nativeEvent: {
        contentOffset: { x: 400 },
        layoutMeasurement: { width: 400 },
      },
    });
  });

  expect(textContent(tree, 'slideshow-counter')).toBe('2 / 2');
});

test('source URL opens externally with scheme normalization', async () => {
  const tree = renderSlideshow({
    notes: [makeNote({ url: 'example.com/note/1' })],
  });

  await act(async () => {
    await byTestId(tree, 'slide-source-url-1').props.onPress();
  });

  expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/note/1');
});

test('image tap opens the popover and the return jumps the slideshow', async () => {
  const onClose = jest.fn();
  const onOpenPopover = jest.fn(() => Promise.resolve<number | null>(2));
  const ref = React.createRef<NoteSlideshowHandle>();
  const tree = renderSlideshow(
    {
      onClose,
      onOpenPopover,
      notes: [
        makeNote({
          id: 1,
          images: [
            { type: 'front', variant: 'thumbnail', filePath: '/tmp/f1.jpg' },
          ],
        }),
        makeNote({ id: 2 }),
      ],
    },
    ref,
  );

  await act(async () => {
    await byTestId(tree, 'slideshow-image-tap-front-1').props.onPress();
  });

  expect(onOpenPopover).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'front');
  expect(textContent(tree, 'slideshow-counter')).toBe('2 / 2');

  // The exposed jump hook syncs the slideshow on popover return.
  act(() => {
    ref.current?.jumpToNoteId(1);
  });
  expect(textContent(tree, 'slideshow-counter')).toBe('1 / 2');

  // Unknown ids are ignored.
  act(() => {
    ref.current?.jumpToNoteId(999);
  });
  expect(textContent(tree, 'slideshow-counter')).toBe('1 / 2');
});

test('matches Flutter: no footer buttons, pager snaps full pages', () => {
  const tree = renderSlideshow();

  // Flutter's slideshow has no Prev/Next buttons (swipe + arrow keys only).
  absentTestId(tree, 'slideshow-prev');
  absentTestId(tree, 'slideshow-next');

  const pager = byTestId(tree, 'slideshow-pager');
  expect(pager.props.horizontal).toBe(true);
  expect(pager.props.pagingEnabled).toBe(true);
  // pagingEnabled alone drives full-page snapping. snapToInterval is
  // intentionally absent: on react-native-windows it throws in
  // ConfigureSnapInertiaModifiers and aborts the app on mount.
  expect(pager.props.snapToInterval).toBeUndefined();
  expect(pager.props.snapToAlignment).toBeUndefined();
  expect(pager.props.disableIntervalMomentum).toBeUndefined();
  expect(pager.props.showsHorizontalScrollIndicator).toBe(false);
});

test('pager is virtualized like Flutter PageView.builder', () => {
  const tree = renderSlideshow({
    notes: [
      ...baseNotes,
      makeNote({ id: 3, denomination: '', catalogNumber: '' }),
      makeNote({ id: 4, denomination: '20 Lei', catalogNumber: 'P-91' }),
      makeNote({ id: 5, denomination: '50 Lei', catalogNumber: 'P-92' }),
    ],
  });

  const pager = byTestId(tree, 'slideshow-pager');
  // Only the current page and its neighbours stay mounted.
  expect(pager.props.initialNumToRender).toBeLessThanOrEqual(3);
  expect(pager.props.maxToRenderPerBatch).toBeLessThanOrEqual(3);
  expect(pager.props.windowSize).toBeLessThanOrEqual(5);
  expect(pager.props.removeClippedSubviews).toBe(true);
  expect(typeof pager.props.getItemLayout).toBe('function');
  expect(typeof pager.props.keyExtractor).toBe('function');
  expect(pager.props.keyExtractor(baseNotes[0])).toBe('1');
  // Heavy slide content follows the mounted window: neighbours render,
  // far notes keep cheap placeholder slots (Flutter PageView.builder parity).
  expect(SLIDESHOW_OFFSCREEN_LIMIT).toBe(1);
  expect(isSlideshowIndexMounted(0, 0)).toBe(true);
  expect(isSlideshowIndexMounted(0, 1)).toBe(true);
  expect(isSlideshowIndexMounted(0, 2)).toBe(false);
  expect(textContent(tree, 'slide-title-1')).toBe('5 Lei - P-98');
  expect(textContent(tree, 'slide-title-2')).toBe('10 Lei - P-90');
  byTestId(tree, 'slide-placeholder-3');
  absentTestId(tree, 'slide-title-3');
});

test('swiping slides the mounted window forward', () => {
  const tree = renderSlideshow({
    notes: [
      ...baseNotes,
      makeNote({ id: 3, denomination: '15 Lei', catalogNumber: 'P-93' }),
      makeNote({ id: 4, denomination: '20 Lei', catalogNumber: 'P-91' }),
    ],
  });

  absentTestId(tree, 'slide-title-3');
  act(() => {
    byTestId(tree, 'slideshow-pager').props.onMomentumScrollEnd({
      nativeEvent: {
        contentOffset: { x: 400 },
        layoutMeasurement: { width: 400 },
      },
    });
  });
  expect(textContent(tree, 'slideshow-counter')).toBe('2 / 4');
  expect(textContent(tree, 'slide-title-3')).toBe('15 Lei - P-93');
});

test('pager getItemLayout pages by the measured width', () => {
  const tree = renderSlideshow();

  const pager = byTestId(tree, 'slideshow-pager');
  const layout = pager.props.getItemLayout(null, 2);
  expect(layout.index).toBe(2);
  expect(layout.offset).toBe(layout.length * 2);
  expect(layout.length).toBeGreaterThan(0);
});

test('pager starts on the initial index', () => {
  const tree = renderSlideshow({ initialIndex: 1 });

  expect(textContent(tree, 'slideshow-counter')).toBe('2 / 2');
  expect(byTestId(tree, 'slideshow-pager').props.initialScrollIndex).toBe(1);
});

test('pager falls back to the raw page offset when the target is unmeasured', () => {
  const tree = renderSlideshow();
  const pager = byTestId(tree, 'slideshow-pager');

  // The failed-jump handler re-targets the raw page offset; with no native
  // list under the test renderer it must at least exist and leave the
  // current page untouched.
  expect(typeof pager.props.onScrollToIndexFailed).toBe('function');
  act(() => {
    pager.props.onScrollToIndexFailed({ index: 1, highestMeasuredFrameIndex: 0 });
  });
  expect(textContent(tree, 'slideshow-counter')).toBe('1 / 2');
});

test('native key mapping covers key/code/flag shapes with desktop gating', () => {
  expect(slideshowNativeKeyAction({ key: 'Escape' }, false)).toBe('close');
  expect(slideshowNativeKeyAction({ code: 'Escape' }, false)).toBe('close');
  expect(slideshowNativeKeyAction({ key: 'ArrowRight' }, true)).toBe('next');
  expect(slideshowNativeKeyAction({ code: 'ArrowLeft' }, true)).toBe('previous');
  expect(slideshowNativeKeyAction({ rightArrowKey: true }, true)).toBe('next');
  expect(slideshowNativeKeyAction({ leftArrowKey: true }, true)).toBe('previous');
  expect(slideshowNativeKeyAction({ key: 'ArrowRight' }, false)).toBeNull();
  expect(slideshowNativeKeyAction({ code: 'ArrowLeft' }, false)).toBeNull();
  expect(slideshowNativeKeyAction({ key: 'Enter' }, true)).toBeNull();
});

test('native desktop keys page with wrap-around and Escape closes', () => {
  const originalOS = Platform.OS;
  jest.replaceProperty(Platform, 'OS', 'windows');
  try {
    const onClose: jest.Mock<void, [SlideshowReturn | null]> = jest.fn();
    const tree = renderSlideshow({ onClose, isDesktopLike: true });

    const screen = byTestId(tree, 'slideshow-screen');
    expect(typeof screen.props.onKeyDown).toBe('function');
    // Only props in the react-native-windows View API may reach the native
    // view: an unknown prop here crashed the Windows app (0xc0000409).
    expect(screen.props.validKeysDown).toBeUndefined();
    expect(screen.props.keyDownEvents).toEqual([
      { code: 'ArrowLeft' },
      { code: 'ArrowRight' },
      { code: 'Escape' },
    ]);
    const pressNativeKey = (nativeEvent: object) => {
      act(() => {
        screen.props.onKeyDown({ nativeEvent });
      });
    };

    // Wraps from the first to the last note.
    pressNativeKey({ key: 'ArrowLeft' });
    expect(textContent(tree, 'slideshow-counter')).toBe('2 / 2');

    pressNativeKey({ code: 'ArrowRight' });
    expect(textContent(tree, 'slideshow-counter')).toBe('1 / 2');

    pressNativeKey({ key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith({ noteId: 1 });
  } finally {
    jest.replaceProperty(Platform, 'OS', originalOS);
  }
});

test('native keys stay inert on non-desktop targets', () => {
  const tree = renderSlideshow({ isDesktopLike: false });

  // No native key props outside Windows/macOS (avoids unknown-prop noise).
  expect(byTestId(tree, 'slideshow-screen').props.onKeyDown).toBeUndefined();
});

test('bottom fade hides at scroll bottom', () => {
  const tree = renderSlideshow();

  const fadeOpacity = () => {
    const style = byTestId(tree, 'slide-fade-1').props.style;
    return (Array.isArray(style) ? Object.assign({}, ...style) : style).opacity;
  };

  expect(fadeOpacity()).toBe(1);
  act(() => {
    byTestId(tree, 'slide-scroll-1').props.onScroll({
      nativeEvent: {
        contentOffset: { y: 500 },
        contentSize: { height: 600 },
        layoutMeasurement: { height: 200 },
      },
    });
  });
  expect(fadeOpacity()).toBe(0);
});

test('pure slideshow helpers match Flutter behavior', () => {
  expect(clampSlideshowIndex(2, 9)).toBe(1);
  expect(clampSlideshowIndex(2, -4)).toBe(0);
  expect(nextSlideshowIndex(3, 2)).toBe(0);
  expect(prevSlideshowIndex(3, 0)).toBe(2);
  expect(slideshowCounterText(0, 2)).toBe('1 / 2');
  expect(slideshowKeyAction('Escape', false)).toBe('close');
  expect(slideshowKeyAction('ArrowRight', true)).toBe('next');
  expect(slideshowKeyAction('ArrowLeft', true)).toBe('previous');
  expect(slideshowKeyAction('ArrowRight', false)).toBeNull();
  expect(isScrolledToBottom(500, 200, 600)).toBe(true);
  expect(isScrolledToBottom(0, 200, 600)).toBe(false);
  expect(slideshowDetailRows(baseNotes[0]).map((row) => row.label)).toEqual([
    'Date',
    'Catalog',
    'Grade',
    'Serial',
  ]);
  expect(slideshowDetailRows(baseNotes[1]).map((row) => row.label)).toEqual([
    'Catalog',
  ]);
});
