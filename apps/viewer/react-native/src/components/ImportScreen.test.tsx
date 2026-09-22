import React from 'react';
import { Alert, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { ViewerControllerState } from '../state/useViewerController';
import { ImportScreen } from './ImportScreen';

function makeController(
  overrides: Partial<ViewerControllerState> = {},
): ViewerControllerState {
  return {
    dataset: {
      generatedAt: '2026-05-30T00:00:00.000Z',
      noteCount: 2,
      source: 'imported',
      collections: [
        { id: 1, name: 'Default', noteCount: 2, isDefault: true },
        { id: 2, name: 'Archive', noteCount: 5, isDefault: false },
      ],
      notes: [],
    },
    isLoading: false,
    isMutating: false,
    error: null,
    query: '',
    setQuery: jest.fn(),
    activeCollectionId: 1,
    activeCollection: { id: 1, name: 'Default', noteCount: 2, isDefault: true },
    selectCollection: jest.fn(),
    sortKey: 'displayOrder',
    ascending: true,
    setSort: jest.fn(),
    filteredNotes: [],
    sourceLabel: 'Using imported archive',
    canManageImportedDatasets: true,
    importArchive: jest.fn(async () => {}),
    deleteCollection: jest.fn(async () => {}),
    setDefaultCollection: jest.fn(async () => {}),
    deleteImportedDataset: jest.fn(async () => {}),
    ...overrides,
  };
}

type TestTree = ReactTestRenderer.ReactTestRenderer;

function flushTimers(ms = 5): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

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

function renderScreen(
  props: Partial<React.ComponentProps<typeof ImportScreen>> = {},
) {
  let tree!: TestTree;
  act(() => {
    tree = ReactTestRenderer.create(
      <ImportScreen
        controller={makeController()}
        isFirstRun={false}
        pickArchive={() => Promise.resolve(null)}
        paintDelayMs={0}
        {...props}
      />,
    );
  });
  return tree;
}

// Capture Alert.alert calls; pressButton simulates tapping a dialog button.
function mockAlert() {
  const calls: Array<{
    title: string;
    message?: string;
    buttons?: Array<{ text?: string; onPress?: () => void }>;
  }> = [];
  const spy = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((title, message, buttons) => {
      calls.push({ title, message, buttons: buttons as never });
    });
  return {
    calls,
    async pressButton(index: number) {
      await act(async () => {
        await calls[calls.length - 1].buttons?.[index]?.onPress?.();
        // Flush the paint-delay timer + promise chain so no async work
        // leaks into later tests (overlapping act() calls corrupt the queue).
        await flushTimers();
      });
    },
    restore() {
      spy.mockRestore();
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('first-run shows the empty-state panel and hides the back button', () => {
  const tree = renderScreen({
    controller: makeController({ dataset: null }),
    isFirstRun: true,
  });
  expect(textContent(tree, 'import-empty-title')).toBe(
    'Import data to get started',
  );
  absentTestId(tree, 'import-back');
});

test('modal mode shows a back button that closes', () => {
  const onClose = jest.fn();
  const tree = renderScreen({ onClose });
  act(() => {
    byTestId(tree, 'import-back').props.onPress();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('back button is hidden while busy', () => {
  const tree = renderScreen({
    controller: makeController({ isMutating: true }),
    onClose: jest.fn(),
  });
  absentTestId(tree, 'import-back');
});

test('import is disabled until an archive is picked', () => {
  const tree = renderScreen();
  expect(byTestId(tree, 'import-archive').props.disabled).toBe(true);
  expect(textContent(tree, 'picked-archive-name')).toBe('No archive selected');
});

test('choosing an archive enables import', async () => {
  const tree = renderScreen({
    pickArchive: () =>
      Promise.resolve({ archivePath: '/tmp/a.zip', name: 'a.zip' }),
  });
  await act(async () => {
    await byTestId(tree, 'choose-archive').props.onPress();
  });
  expect(textContent(tree, 'picked-archive-name')).toBe('a.zip');
  expect(byTestId(tree, 'import-archive').props.disabled).toBe(false);
});

test('import confirm copy is verbatim and success clears the pick', async () => {
  const controller = makeController();
  const tree = renderScreen({
    controller,
    pickArchive: () =>
      Promise.resolve({ archivePath: '/tmp/a.zip', name: 'a.zip' }),
  });
  await act(async () => {
    await byTestId(tree, 'choose-archive').props.onPress();
  });

  const alert = mockAlert();
  try {
    act(() => {
      byTestId(tree, 'import-archive').props.onPress();
    });
    expect(alert.calls).toHaveLength(1);
    expect(alert.calls[0].title).toBe('Import archive?');
    expect(alert.calls[0].message).toBe(
      'Importing an archive replaces collections found in the archive (matched by name). Collections not present in the archive stay untouched on this device.',
    );
    await alert.pressButton(1);
    expect(controller.importArchive).toHaveBeenCalledWith('/tmp/a.zip');
    expect(textContent(tree, 'import-message')).toBe(
      'Imported a.zip successfully.',
    );
    // Success clears the picked path/name.
    expect(textContent(tree, 'picked-archive-name')).toBe(
      'No archive selected',
    );
  } finally {
    alert.restore();
  }
});

test('import cancel leaves state untouched', async () => {
  const controller = makeController();
  const tree = renderScreen({
    controller,
    pickArchive: () =>
      Promise.resolve({ archivePath: '/tmp/a.zip', name: 'a.zip' }),
  });
  await act(async () => {
    await byTestId(tree, 'choose-archive').props.onPress();
  });

  const alert = mockAlert();
  try {
    act(() => {
      byTestId(tree, 'import-archive').props.onPress();
    });
    await alert.pressButton(0);
    expect(controller.importArchive).not.toHaveBeenCalled();
    absentTestId(tree, 'import-message');
    expect(textContent(tree, 'picked-archive-name')).toBe('a.zip');
  } finally {
    alert.restore();
  }
});

test('import failure shows the verbatim error message', async () => {
  const controller = makeController({
    importArchive: jest.fn(() => Promise.reject(new Error('boom'))),
  });
  const tree = renderScreen({
    controller,
    pickArchive: () =>
      Promise.resolve({ archivePath: '/tmp/a.zip', name: 'a.zip' }),
  });
  await act(async () => {
    await byTestId(tree, 'choose-archive').props.onPress();
  });

  const alert = mockAlert();
  try {
    act(() => {
      byTestId(tree, 'import-archive').props.onPress();
    });
    await alert.pressButton(1);
    expect(textContent(tree, 'import-message')).toBe(
      'Import failed: Error: boom',
    );
  } finally {
    alert.restore();
  }
});

test('blocking overlay is visible while the import applies', async () => {
  let resolveImport!: () => void;
  const controller = makeController({
    importArchive: jest.fn(
      () => new Promise<void>((resolve) => (resolveImport = resolve)),
    ),
  });
  const tree = renderScreen({
    controller,
    pickArchive: () =>
      Promise.resolve({ archivePath: '/tmp/a.zip', name: 'a.zip' }),
  });
  await act(async () => {
    await byTestId(tree, 'choose-archive').props.onPress();
  });

  const alert = mockAlert();
  try {
    act(() => {
      byTestId(tree, 'import-archive').props.onPress();
    });
    expect(alert.calls).toHaveLength(1);
    await act(async () => {
      alert.calls[0].buttons?.[1]?.onPress?.();
      await flushTimers();
    });
    byTestId(tree, 'import-blocking-overlay');
    await act(async () => {
      resolveImport();
      await flushTimers();
    });
    expect(textContent(tree, 'import-message')).toBe(
      'Imported a.zip successfully.',
    );
  } finally {
    alert.restore();
  }
});

test('pills show source, built date, collection and note counts', () => {
  const tree = renderScreen();
  expect(textContent(tree, 'pill-active-source')).toContain(
    'Using imported archive',
  );
  expect(textContent(tree, 'pill-dataset-built')).toContain(
    'May 30, 2026 at 00:00 UTC',
  );
  expect(textContent(tree, 'pill-collections')).toContain('2');
  expect(textContent(tree, 'pill-notes-active')).toContain('2');
});

test('empty dataset shows pill fallbacks', () => {
  const tree = renderScreen({
    controller: makeController({ dataset: null }),
    isFirstRun: true,
  });
  expect(textContent(tree, 'pill-active-source')).toContain(
    'No dataset imported',
  );
  expect(textContent(tree, 'pill-dataset-built')).toContain(
    'Not available yet',
  );
});

test('dropdown labels are verbatim and select clears the message', async () => {
  const controller = makeController();
  const tree = renderScreen({ controller });
  expect(textContent(tree, 'collection-option-1')).toContain(
    'Default (default) (2)',
  );
  expect(textContent(tree, 'collection-option-2')).toContain('Archive (5)');

  // Seed a message via a failed import, then select to clear it.
  (controller.importArchive as jest.Mock).mockRejectedValueOnce(
    new Error('boom'),
  );
  const pickTree = renderScreen({
    controller,
    pickArchive: () =>
      Promise.resolve({ archivePath: '/tmp/a.zip', name: 'a.zip' }),
  });
  await act(async () => {
    await byTestId(pickTree, 'choose-archive').props.onPress();
  });
  const alert = mockAlert();
  try {
    act(() => {
      byTestId(pickTree, 'import-archive').props.onPress();
    });
    await alert.pressButton(1);
    expect(textContent(pickTree, 'import-message')).toContain('Import failed');
    act(() => {
      byTestId(pickTree, 'collection-option-2').props.onPress();
    });
    expect(controller.selectCollection).toHaveBeenCalledWith(2);
    absentTestId(pickTree, 'import-message');
  } finally {
    alert.restore();
  }
});

test('set-as-default is disabled for the default collection', () => {
  const tree = renderScreen();
  expect(byTestId(tree, 'set-as-default').props.disabled).toBe(true);
});

test('delete collection confirm copy is verbatim', async () => {
  const controller = makeController();
  const tree = renderScreen({ controller });
  const alert = mockAlert();
  try {
    act(() => {
      byTestId(tree, 'delete-active-collection').props.onPress();
    });
    expect(alert.calls[0].title).toBe('Delete collection?');
    expect(alert.calls[0].message).toBe(
      'Delete "Default" and all notes/images in that collection from this device?',
    );
    await alert.pressButton(1);
    expect(controller.deleteCollection).toHaveBeenCalledWith(1);
    expect(textContent(tree, 'import-message')).toBe('Deleted Default.');
  } finally {
    alert.restore();
  }
});

test('delete imported data confirm copy is verbatim and clears the pick', async () => {
  const controller = makeController();
  const tree = renderScreen({
    controller,
    pickArchive: () =>
      Promise.resolve({ archivePath: '/tmp/a.zip', name: 'a.zip' }),
  });
  await act(async () => {
    await byTestId(tree, 'choose-archive').props.onPress();
  });
  const alert = mockAlert();
  try {
    act(() => {
      byTestId(tree, 'delete-imported-data').props.onPress();
    });
    expect(alert.calls[0].title).toBe('Delete imported data?');
    expect(alert.calls[0].message).toBe(
      'This removes the imported archive from this device. You will need to import another archive before browsing notes again.',
    );
    await alert.pressButton(1);
    expect(controller.deleteImportedDataset).toHaveBeenCalledTimes(1);
    expect(textContent(tree, 'import-message')).toBe(
      'Imported data deleted. Import another archive to continue.',
    );
    expect(textContent(tree, 'picked-archive-name')).toBe(
      'No archive selected',
    );
  } finally {
    alert.restore();
  }
});

test('windows shows the picker like other platforms', async () => {
  const tree = renderScreen({
    pickArchive: () =>
      Promise.resolve({ archivePath: 'C:\\tmp\\a.zip', name: 'a.zip' }),
  });
  byTestId(tree, 'choose-archive');
  await act(async () => {
    await byTestId(tree, 'choose-archive').props.onPress();
  });
  expect(textContent(tree, 'picked-archive-name')).toBe('a.zip');
  expect(byTestId(tree, 'import-archive').props.disabled).toBe(false);
});

test('footer shows the app manifest version', () => {
  const tree = renderScreen();
  expect(textContent(tree, 'import-footer')).toBe('Note Harbor Viewer v1.0.5');
});
