import React from 'react';
import { Linking, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { NoteRecord } from '../shared/viewer-core';
import {
  clampSlideshowIndex,
  isScrolledToBottom,
  nextSlideshowIndex,
  NoteSlideshow,
  prevSlideshowIndex,
  slideshowCounterText,
  slideshowDetailRows,
  slideshowKeyAction,
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
  const tree = renderSlideshow({
    notes: [
      ...baseNotes,
      makeNote({ id: 3, denomination: '', catalogNumber: '' }),
    ],
  });

  expect(textContent(tree, 'slide-title-1')).toBe('5 Lei - P-98');
  expect(textContent(tree, 'slide-title-2')).toBe('10 Lei - P-90');
  expect(textContent(tree, 'slide-title-3')).toBe('Untitled note');
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

test('footer prev/next page with wrap-around', () => {
  const tree = renderSlideshow();

  act(() => {
    byTestId(tree, 'slideshow-next').props.onPress();
  });
  expect(textContent(tree, 'slideshow-counter')).toBe('2 / 2');

  act(() => {
    byTestId(tree, 'slideshow-next').props.onPress();
  });
  expect(textContent(tree, 'slideshow-counter')).toBe('1 / 2');

  act(() => {
    byTestId(tree, 'slideshow-prev').props.onPress();
  });
  expect(textContent(tree, 'slideshow-counter')).toBe('2 / 2');
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
