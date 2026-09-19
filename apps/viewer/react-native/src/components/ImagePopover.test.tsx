import React from 'react';
import { ActivityIndicator, Image, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { NoteRecord } from '../shared/viewer-core';
import {
  buildPopoverSequence,
  clampPopoverIndex,
  clampZoomScale,
  fittedContentSize,
  ImagePopover,
  isZoomed,
  maxZoomScale,
  nextPopoverIndex,
  popoverCounterText,
  popoverInitialIndex,
  popoverKeyAction,
  prevPopoverIndex,
  realSizeScale,
  toggleZoomTarget,
} from './ImagePopover';

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
    tags: [],
    images: [],
    scrapedData: null,
    ...overrides,
  };
}

const baseNotes = [
  makeNote({
    id: 1,
    images: [
      { type: 'front', variant: 'full', filePath: '/tmp/n1-front.jpg' },
      { type: 'back', variant: 'full', filePath: '/tmp/n1-back.jpg' },
    ],
  }),
  makeNote({
    id: 2,
    displayOrder: 2,
    denomination: '10 Lei',
    catalogNumber: 'P-90',
    images: [{ type: 'front', variant: 'full', filePath: '/tmp/n2-front.jpg' }],
  }),
];

type TestTree = ReactTestRenderer.ReactTestRenderer;

function byTestId(tree: TestTree, testID: string) {
  const nodes = tree.root.findAll((node) => node.props?.testID === testID);
  expect(nodes.length).toBeGreaterThan(0);
  return nodes[0];
}

function textContent(tree: TestTree, testID: string): string {
  const children = byTestId(tree, testID).findAllByType(Text)[0].props.children;
  return (Array.isArray(children) ? children : [children]).join('');
}

function mockImageSize(width: number, height: number) {
  return jest
    .spyOn(Image, 'getSize')
    .mockImplementation(((uri: string, success?: (w: number, h: number) => void) => {
      success?.(width, height);
      return undefined;
    }) as typeof Image.getSize);
}

function mockImageFailure() {
  return jest
    .spyOn(Image, 'getSize')
    .mockImplementation(((uri: string, success?: (w: number, h: number) => void, failure?: () => void) => {
      failure?.();
      return undefined;
    }) as typeof Image.getSize);
}

function renderPopover(
  props: Partial<React.ComponentProps<typeof ImagePopover>> = {},
) {
  let tree!: TestTree;
  act(() => {
    tree = ReactTestRenderer.create(
      <ImagePopover notes={baseNotes} onClose={jest.fn()} {...props} />,
    );
  });
  return tree;
}

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

afterEach(() => {
  jest.restoreAllMocks();
});

test('sequence interleaves front/back across the collection (2N)', () => {
  const sequence = buildPopoverSequence(baseNotes);

  expect(sequence).toHaveLength(4);
  expect(sequence.map((item) => [item.note.id, item.face])).toEqual([
    [1, 'front'],
    [1, 'back'],
    [2, 'front'],
    [2, 'back'],
  ]);
});

test('sequence keeps gaps as positional null pages and uses the full variant', () => {
  const sequence = buildPopoverSequence(baseNotes);

  expect(sequence[2].uri).toBe('file:///tmp/n2-front.jpg');
  expect(sequence[3].uri).toBeNull();
  expect(sequence[0].uri).toBe('file:///tmp/n1-front.jpg');
  expect(sequence[1].uri).toBe('file:///tmp/n1-back.jpg');
});

test('sequence prefers the full variant over thumbnails', () => {
  const notes = [
    makeNote({
      images: [
        { type: 'front', variant: 'thumbnail', filePath: '/tmp/thumb.jpg' },
        { type: 'front', variant: 'full', filePath: '/tmp/full.jpg' },
      ],
    }),
  ];

  expect(buildPopoverSequence(notes)[0].uri).toBe('file:///tmp/full.jpg');
});

test('initial index resolves the face target', () => {
  expect(popoverInitialIndex(baseNotes, 1, 'front')).toBe(0);
  expect(popoverInitialIndex(baseNotes, 1, 'back')).toBe(1);
  expect(popoverInitialIndex(baseNotes, 2, 'back')).toBe(3);
  expect(popoverInitialIndex(baseNotes, 999, 'front')).toBe(0);
});

test('renders inline with positional counter, title, and Back', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover();

  expect(textContent(tree, 'popover-counter')).toBe('1 / 4');
  expect(textContent(tree, 'popover-title')).toBe('5 Lei - P-98');
  expect(textContent(tree, 'popover-back')).toBe('Back');
});

test('missing images stay as positional No image pages', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover({ initialNoteId: 2, initialFace: 'back' });

  expect(textContent(tree, 'popover-counter')).toBe('4 / 4');
  expect(textContent(tree, 'popover-title')).toBe('10 Lei - P-90');
  byTestId(tree, 'popover-no-image-3');
});

test('swiping the pager updates the counter and title with wrap-around', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover();

  act(() => {
    byTestId(tree, 'popover-pager').props.onMomentumScrollEnd({
      nativeEvent: {
        contentOffset: { x: 1200 },
        layoutMeasurement: { width: 400 },
      },
    });
  });
  expect(textContent(tree, 'popover-counter')).toBe('4 / 4');

  act(() => {
    byTestId(tree, 'popover-next').props.onPress();
  });
  expect(textContent(tree, 'popover-counter')).toBe('1 / 4');

  act(() => {
    byTestId(tree, 'popover-prev').props.onPress();
  });
  expect(textContent(tree, 'popover-counter')).toBe('4 / 4');
});

function doubleTap(tree: TestTree, testID: string) {
  act(() => {
    byTestId(tree, testID).props.onPress();
  });
  act(() => {
    byTestId(tree, testID).props.onPress();
  });
}

test('double-tap toggles Zoom view and disables the pager while zoomed', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover();
  const pagerEnabled = () =>
    byTestId(tree, 'popover-pager').props.scrollEnabled;

  expect(pagerEnabled()).toBe(true);

  doubleTap(tree, 'popover-zoom-toggle-0');
  expect(pagerEnabled()).toBe(false);

  doubleTap(tree, 'popover-zoom-toggle-0');
  expect(pagerEnabled()).toBe(true);
});

test('zoom resets on page change', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover();

  doubleTap(tree, 'popover-zoom-toggle-0');
  expect(byTestId(tree, 'popover-pager').props.scrollEnabled).toBe(false);

  act(() => {
    byTestId(tree, 'popover-pager').props.onMomentumScrollEnd({
      nativeEvent: {
        contentOffset: { x: 400 },
        layoutMeasurement: { width: 400 },
      },
    });
  });
  expect(textContent(tree, 'popover-counter')).toBe('2 / 4');
  expect(byTestId(tree, 'popover-pager').props.scrollEnabled).toBe(true);
});

test('multi-touch disables the pager until touches end', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover();
  const stage = () => byTestId(tree, 'popover-zoom-stage-0');

  act(() => {
    stage().props.onTouchStart({
      nativeEvent: { touches: [{ identifier: 0 }, { identifier: 1 }] },
    });
  });
  expect(byTestId(tree, 'popover-pager').props.scrollEnabled).toBe(false);

  act(() => {
    stage().props.onTouchEnd({
      nativeEvent: { touches: [] },
    });
  });
  expect(byTestId(tree, 'popover-pager').props.scrollEnabled).toBe(true);
});

test('Back and system dismiss paths return the current note identity', () => {
  mockImageSize(2000, 1200);
  const onClose = jest.fn();
  const tree = renderPopover({ onClose });

  act(() => {
    byTestId(tree, 'popover-pager').props.onMomentumScrollEnd({
      nativeEvent: {
        contentOffset: { x: 800 },
        layoutMeasurement: { width: 400 },
      },
    });
  });

  act(() => {
    byTestId(tree, 'popover-back').props.onPress();
  });
  expect(onClose).toHaveBeenCalledWith(2);
});

test('Escape closes; arrows page with wrap on desktop-like targets only', () => {
  mockImageSize(2000, 1200);
  const onClose = jest.fn();
  const { added, restore } = captureKeyListeners();

  try {
    const tree = renderPopover({ onClose, isDesktopLike: true });
    expect(added.length).toBeGreaterThan(0);

    act(() => {
      added[0]({ key: 'ArrowLeft' });
    });
    expect(textContent(tree, 'popover-counter')).toBe('4 / 4');

    act(() => {
      added[0]({ key: 'ArrowRight' });
    });
    expect(textContent(tree, 'popover-counter')).toBe('1 / 4');

    act(() => {
      added[0]({ key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledWith(1);

    const plain = renderPopover({ isDesktopLike: false });
    act(() => {
      added[1]({ key: 'ArrowRight' });
    });
    expect(textContent(plain, 'popover-counter')).toBe('1 / 4');
  } finally {
    restore();
  }
});

test('spinner shows while resolving; failure shows Could not load copy', () => {
  const size = mockImageSize(2000, 1200);
  size.mockImplementation(((() => undefined) as unknown) as typeof Image.getSize);
  const tree = renderPopover();

  expect(tree.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);

  const failing = mockImageFailure();
  expect(failing).toBeDefined();
  const failedTree = renderPopover();
  expect(textContent(failedTree, 'popover-load-error-0')).toMatch(
    "Couldn't load image",
  );
});

test('assistive-tech zoom action toggles without double-tap timing', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover();

  act(() => {
    byTestId(tree, 'popover-zoom-toggle-0').props.onAccessibilityAction();
  });
  expect(byTestId(tree, 'popover-pager').props.scrollEnabled).toBe(false);

  act(() => {
    byTestId(tree, 'popover-zoom-toggle-0').props.onAccessibilityAction();
  });
  expect(byTestId(tree, 'popover-pager').props.scrollEnabled).toBe(true);
});

test('empty collection shows a zero counter and Back returns null', () => {
  const onClose = jest.fn();
  let tree!: TestTree;
  act(() => {
    tree = ReactTestRenderer.create(
      <ImagePopover notes={[]} onClose={onClose} />,
    );
  });

  expect(textContent(tree, 'popover-counter')).toBe('0 / 0');
  act(() => {
    byTestId(tree, 'popover-back').props.onPress();
  });
  expect(onClose).toHaveBeenCalledWith(null);
});

test('accessible labels announce position and actions', () => {
  mockImageSize(2000, 1200);
  const tree = renderPopover();

  expect(byTestId(tree, 'popover-prev').props.accessibilityLabel).toMatch(
    /previous image/i,
  );
  expect(byTestId(tree, 'popover-next').props.accessibilityLabel).toMatch(
    /next image/i,
  );
  expect(byTestId(tree, 'popover-back').props.accessibilityLabel).toMatch(
    /back/i,
  );
  expect(
    byTestId(tree, 'popover-zoom-toggle-0').props.accessibilityLabel,
  ).toMatch(/zoom/i);
});

test('pure popover helpers match Flutter zoom and nav behavior', () => {
  expect(clampPopoverIndex(4, 9)).toBe(3);
  expect(clampPopoverIndex(4, -2)).toBe(0);
  expect(nextPopoverIndex(4, 3)).toBe(0);
  expect(prevPopoverIndex(4, 0)).toBe(3);
  expect(popoverCounterText(0, 4)).toBe('1 / 4');
  expect(popoverKeyAction('Escape', false)).toBe('close');
  expect(popoverKeyAction('ArrowRight', true)).toBe('next');
  expect(popoverKeyAction('ArrowLeft', true)).toBe('previous');
  expect(popoverKeyAction('ArrowRight', false)).toBeNull();

  // 2000x1200 natural on a 400x300 stage at ratio 2: logical 1000x600,
  // fitted contain 400x240, 1:1 scale 2.5.
  expect(fittedContentSize(2000, 1200, 400, 300, 2)).toEqual({
    width: 400,
    height: 240,
  });
  expect(realSizeScale(2000, 1200, 400, 300, 2)).toBeCloseTo(2.5);
  // Natural size smaller than space: 1:1 never exceeds fit.
  expect(realSizeScale(100, 60, 400, 300, 2)).toBe(1);
  expect(maxZoomScale(2.5)).toBe(12);
  expect(maxZoomScale(20)).toBe(20);
  expect(clampZoomScale(99, 12)).toBe(12);
  expect(clampZoomScale(0.2, 12)).toBe(1);
  expect(toggleZoomTarget(1, 2.5, 12)).toBeCloseTo(2.5);
  expect(toggleZoomTarget(2.5, 2.5, 12)).toBe(1);
  expect(toggleZoomTarget(1, 1, 12)).toBe(1);
  expect(isZoomed(1)).toBe(false);
  expect(isZoomed(1.2)).toBe(true);
});
