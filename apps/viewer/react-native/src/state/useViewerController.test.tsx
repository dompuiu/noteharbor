import React, { useEffect } from 'react';
import ReactTestRenderer from 'react-test-renderer';

import type { ViewerControllerState } from './useViewerController';
import { useViewerController } from './useViewerController';
import type { ViewerRepository } from '../data/viewerRepository';

class StubRepository implements ViewerRepository {
  constructor(private datasetFactory: () => Promise<any>) {}

  loadDataset() {
    return this.datasetFactory();
  }

  importArchive() {
    return this.datasetFactory();
  }

  deleteCollection() {
    return this.datasetFactory();
  }

  setDefaultCollection() {
    return this.datasetFactory();
  }

  deleteImportedDataset() {
    return Promise.resolve(null);
  }
}

function HookProbe({
  repository,
  onState,
}: {
  repository: ViewerRepository;
  onState: (state: ViewerControllerState) => void;
}) {
  const state = useViewerController(repository);

  useEffect(() => {
    onState(state);
  }, [onState, state]);

  return null;
}

const dataset = {
  generatedAt: '2026-05-30T00:00:00.000Z',
  noteCount: 1,
  source: 'imported' as const,
  collections: [{ id: 1, name: 'Default', noteCount: 1, isDefault: true }],
  notes: [
    {
      id: 1,
      collectionId: 1,
      displayOrder: 1,
      denomination: '5 Lei',
      issueDate: '1991',
      catalogNumber: 'P-98',
      gradingCompany: '',
      grade: '',
      watermark: '',
      serial: 'AB',
      url: '',
      notes: 'Loaded note',
      scrapeStatus: 'done',
      scrapeError: '',
      tags: [{ name: 'Romania' }],
      images: [],
      scrapedData: null,
    },
  ],
};

async function renderHook(repository: ViewerRepository) {
  const probe: { state: ViewerControllerState | null } = { state: null };

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <HookProbe repository={repository} onState={(state) => (probe.state = state)} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  return probe;
}

test('loads dataset asynchronously through the repository', async () => {
  const repository = new StubRepository(() => Promise.resolve(dataset));
  const probe = await renderHook(repository);

  expect(probe.state?.isLoading).toBe(false);
  expect(probe.state?.dataset?.noteCount).toBe(1);
  expect(probe.state?.activeCollection?.name).toBe('Default');
});

test('exposes sort key state defaulting to collection order', async () => {
  const twoNotes = {
    ...dataset,
    notes: [
      { ...dataset.notes[0], id: 1, displayOrder: 2, catalogNumber: 'P-98' },
      { ...dataset.notes[0], id: 2, displayOrder: 1, catalogNumber: 'P-12' },
    ],
  };
  const repository = new StubRepository(() => Promise.resolve(twoNotes));
  const probe = await renderHook(repository);

  expect(probe.state?.sortKey).toBe('displayOrder');
  expect(probe.state?.ascending).toBe(true);
  expect(probe.state?.filteredNotes.map((note) => note.id)).toEqual([2, 1]);

  await ReactTestRenderer.act(async () => {
    probe.state?.setSort('displayOrder');
  });
  expect(probe.state?.ascending).toBe(false);
  expect(probe.state?.filteredNotes.map((note) => note.id)).toEqual([1, 2]);

  await ReactTestRenderer.act(async () => {
    probe.state?.setSort('catalogNumber');
  });
  expect(probe.state?.sortKey).toBe('catalogNumber');
  expect(probe.state?.ascending).toBe(true);
});

test('exposes mutation actions that update loaded state', async () => {
  let currentDataset = dataset;
  const repository: ViewerRepository = {
    loadDataset: () => Promise.resolve(currentDataset),
    importArchive: () => Promise.resolve(currentDataset),
    deleteCollection: () => {
      currentDataset = {
        ...currentDataset,
        collections: [],
        notes: [],
        noteCount: 0,
      };
      return Promise.resolve(currentDataset);
    },
    setDefaultCollection: () => Promise.resolve(currentDataset),
    deleteImportedDataset: () => Promise.resolve(null),
  };
  const probe = await renderHook(repository);

  await ReactTestRenderer.act(async () => {
    await probe.state?.deleteCollection(1);
    await Promise.resolve();
  });

  expect(probe.state?.dataset?.noteCount).toBe(0);
});

test('captures mutation errors on controller state', async () => {
  const repository: ViewerRepository = {
    loadDataset: () => Promise.resolve(dataset),
    importArchive: () => Promise.reject(new Error('Import failed.')),
    deleteCollection: () => Promise.resolve(dataset),
    setDefaultCollection: () => Promise.resolve(dataset),
    deleteImportedDataset: () => Promise.resolve(null),
  };
  const probe = await renderHook(repository);

  await ReactTestRenderer.act(async () => {
    await probe.state?.importArchive('/bad.zip');
    await Promise.resolve();
  });

  expect(probe.state?.error).toBe('Import failed.');
  expect(probe.state?.isMutating).toBe(false);
});
