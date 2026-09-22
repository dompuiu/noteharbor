import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { ViewerControllerState } from '../state/useViewerController';
import type { NoteRecord } from '../shared/viewer-core';
import {
  NotesTableScreen,
  calculateTagsColumnWidth,
  clampRevealOffset,
  MIN_TABLE_CONTENT_WIDTH,
} from './NotesTableScreen';

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
    tags: [{ name: 'Polymer' }],
  }),
];

function makeController(
  overrides: Partial<ViewerControllerState> = {},
): ViewerControllerState {
  return {
    dataset: {
      generatedAt: null,
      noteCount: 2,
      source: 'imported',
      collections: [{ id: 1, name: 'Default', noteCount: 2, isDefault: true }],
      notes: baseNotes,
    },
    isLoading: false,
    isMutating: false,
    error: null,
    query: '',
    setQuery: jest.fn(),
    activeCollectionId: 1,
    activeCollection: {
      id: 1,
      name: 'Default',
      noteCount: 2,
      isDefault: true,
    },
    selectCollection: jest.fn(),
    sortKey: 'displayOrder',
    ascending: true,
    setSort: jest.fn(),
    filteredNotes: baseNotes,
    sourceLabel: 'Using imported archive',
    clearError: jest.fn(),
    canManageImportedDatasets: true,
    importArchive: jest.fn(),
    deleteCollection: jest.fn(),
    setDefaultCollection: jest.fn(),
    deleteImportedDataset: jest.fn(),
    ...overrides,
  };
}

function renderScreen(
  controller: ViewerControllerState,
  props: Partial<React.ComponentProps<typeof NotesTableScreen>> = {},
) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NotesTableScreen
        controller={controller}
        onOpenSlideshow={jest.fn(() => Promise.resolve(null))}
        onOpenImport={jest.fn()}
        {...props}
      />,
    );
  });
  return tree;
}

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
  const children = byTestId(tree, testID).findByType(Text).props.children;
  return (Array.isArray(children) ? children : [children]).join('');
}

test('renders all nine column headers with Front not sortable', () => {
  const tree = renderScreen(makeController());

  const headerTexts = tree.root
    .findAllByType(Text)
    .map((node) =>
      (Array.isArray(node.props.children)
        ? node.props.children
        : [node.props.children]
      ).join(''),
    );
  for (const label of [
    'ID',
    'Front',
    'Denomination',
    'Date',
    'Catalog',
    'Company',
    'Grade',
    'Serial',
    'Tags',
  ]) {
    expect(headerTexts.some((text) => text.includes(label))).toBe(true);
  }

  absentTestId(tree, 'sort-front');
  expect(textContent(tree, 'header-front')).toBe('Front');
});

test('tapping a sortable header calls setSort and the active header shows an arrow', () => {
  const setSort = jest.fn();
  const tree = renderScreen(
    makeController({ sortKey: 'denomination', ascending: true, setSort }),
  );

  const header = byTestId(tree, 'sort-denomination');
  act(() => {
    header.props.onPress();
  });
  expect(setSort).toHaveBeenCalledWith('denomination');
  expect(textContent(tree, 'sort-denomination')).toContain('▲');
});

test('shows descending arrow when the active sort is descending', () => {
  const tree = renderScreen(
    makeController({ sortKey: 'catalogNumber', ascending: false }),
  );

  expect(textContent(tree, 'sort-catalogNumber')).toContain('▼');
});

test('header pill shows visible/total counts', () => {
  const oneVisible = [baseNotes[0]];
  const tree = renderScreen(makeController({ filteredNotes: oneVisible }));

  expect(textContent(tree, 'notes-pill')).toBe('Notes: 1 / 2');
});

test('import button is gated on the manage permission and handler', () => {
  const onOpenImport = jest.fn();
  const visible = renderScreen(
    makeController({ canManageImportedDatasets: true }),
    { onOpenImport },
  );
  act(() => {
    byTestId(visible, 'import-button').props.onPress();
  });
  expect(onOpenImport).toHaveBeenCalledTimes(1);

  const hidden = renderScreen(
    makeController({ canManageImportedDatasets: false }),
    { onOpenImport },
  );
  absentTestId(hidden, 'import-button');

  const noHandler = renderScreen(makeController(), { onOpenImport: undefined });
  absentTestId(noHandler, 'import-button');
});

test('tag-tap sets the canonical tags query', () => {
  const setQuery = jest.fn();
  const tree = renderScreen(makeController({ setQuery }));

  act(() => {
    byTestId(tree, 'tag-chip-Romania').props.onPress();
  });

  expect(setQuery).toHaveBeenCalledWith('tags: Romania');
});

test('row-tap opens the slideshow at the tapped index', async () => {
  const onOpenSlideshow = jest.fn(() => Promise.resolve(null));
  const tree = renderScreen(makeController(), { onOpenSlideshow });

  await act(async () => {
    await byTestId(tree, 'table-row-2').props.onPress();
  });

  expect(onOpenSlideshow).toHaveBeenCalledTimes(1);
  const [notes, index] = onOpenSlideshow.mock.calls[0] as unknown as [
    NoteRecord[],
    number,
  ];
  expect(notes.map((note) => note.id)).toEqual([1, 2]);
  expect(index).toBe(1);
});

test('slideshow return with a tag applies the canonical filter', async () => {
  const setQuery = jest.fn();
  const onOpenSlideshow = jest.fn(() =>
    Promise.resolve({ noteId: 2, tagName: 'Polymer' }),
  );
  const tree = renderScreen(makeController({ setQuery }), { onOpenSlideshow });

  await act(async () => {
    await byTestId(tree, 'table-row-1').props.onPress();
  });

  expect(setQuery).toHaveBeenCalledWith('tags: Polymer');
});

test('collection change clears the query', () => {
  const setQuery = jest.fn();
  const controller = makeController({ setQuery });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <NotesTableScreen
        controller={controller}
        onOpenSlideshow={jest.fn(() => Promise.resolve(null))}
      />,
    );
  });

  act(() => {
    tree.update(
      <NotesTableScreen
        controller={{ ...controller, activeCollectionId: 2 }}
        onOpenSlideshow={jest.fn(() => Promise.resolve(null))}
      />,
    );
  });

  expect(setQuery).toHaveBeenCalledWith('');
});

test('table scrolls horizontally with a minimum content width', () => {
  const tree = renderScreen(makeController());

  const hscroll = byTestId(tree, 'table-hscroll');
  expect(hscroll.props.horizontal).toBe(true);

  const rawStyle = byTestId(tree, 'table-content').props.style;
  const flatStyle = Object.assign(
    {},
    ...(Array.isArray(rawStyle) ? rawStyle : [rawStyle]),
  );
  expect(flatStyle.width).toBeGreaterThanOrEqual(MIN_TABLE_CONTENT_WIDTH);
});

test('search chrome filters live and clears with X', () => {
  const setQuery = jest.fn();
  const tree = renderScreen(makeController({ query: 'tags: rom', setQuery }));

  const input = byTestId(tree, 'table-search');
  expect(input.props.placeholder).toMatch(/catalog:/);
  act(() => {
    input.props.onChangeText('tags: romania');
  });
  expect(setQuery).toHaveBeenCalledWith('tags: romania');

  act(() => {
    byTestId(tree, 'search-clear').props.onPress();
  });
  expect(setQuery).toHaveBeenCalledWith('');
});

test('X clear affordance is hidden on an empty query', () => {
  const tree = renderScreen(makeController({ query: '' }));

  absentTestId(tree, 'search-clear');
});

test('empty filter shows the themed empty row', () => {
  const tree = renderScreen(makeController({ filteredNotes: [] }));

  expect(textContent(tree, 'empty-row')).toBe(
    'No notes match the current filter.',
  );
});

test('thumbnails render at 96x56 with a placeholder on missing images', () => {
  const withoutImages = baseNotes.map((note) => ({ ...note, images: [] }));
  const tree = renderScreen(
    makeController({ filteredNotes: withoutImages }),
  );

  const placeholder = byTestId(tree, 'thumb-placeholder-1');
  expect(placeholder.props.style).toEqual(
    expect.objectContaining({ width: 96, height: 56 }),
  );
});

test('table stays bounded inside its rounded container', () => {
  const tree = renderScreen(makeController());
  const flat = (style: unknown) =>
    Object.assign({}, ...(Array.isArray(style) ? style : [style]));

  const hscroll = byTestId(tree, 'table-hscroll');
  expect(flat(hscroll.props.style).flex).toBe(1);

  const vscroll = byTestId(tree, 'table-vscroll');
  expect(flat(vscroll.props.style).flex).toBe(1);

  const content = byTestId(tree, 'table-content');
  const contentStyle = flat(content.props.style);
  expect(contentStyle.flexGrow).toBe(1);
  expect(contentStyle.paddingHorizontal).toBeUndefined();

  const card = hscroll.parent;
  expect(flat(card.props.style).flex).toBe(1);
  expect(flat(card.props.style).overflow).toBe('hidden');
});

test('calculateTagsColumnWidth respects the 160 minimum and grows with chips', () => {
  expect(calculateTagsColumnWidth([])).toBe(160);
  expect(calculateTagsColumnWidth([makeNote({ tags: [] })])).toBe(160);

  const wide = calculateTagsColumnWidth([
    makeNote({ tags: [{ name: 'Romania' }, { name: 'Polymer commemorative' }] }),
  ]);
  expect(wide).toBeGreaterThan(160);
});

test('clampRevealOffset clamps the reveal target into the scroll range', () => {
  expect(clampRevealOffset(-10, 500)).toBe(0);
  expect(clampRevealOffset(600, 500)).toBe(500);
  expect(clampRevealOffset(162, 500)).toBe(162);
});
