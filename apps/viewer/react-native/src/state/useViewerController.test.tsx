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

test('loads dataset asynchronously through the repository', async () => {
  let latestState: ViewerControllerState | null = null;
  const repository = new StubRepository(() => Promise.resolve(dataset));

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <HookProbe repository={repository} onState={(state) => (latestState = state)} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(latestState?.isLoading).toBe(false);
  expect(latestState?.dataset?.noteCount).toBe(1);
  expect(latestState?.activeCollection?.name).toBe('Default');
});

test('exposes mutation actions that update loaded state', async () => {
  let currentDataset = dataset;
  let latestState: ViewerControllerState | null = null;
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

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <HookProbe repository={repository} onState={(state) => (latestState = state)} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  await ReactTestRenderer.act(async () => {
    await latestState?.deleteCollection(1);
    await Promise.resolve();
  });

  expect(latestState?.dataset?.noteCount).toBe(0);
});

test('captures mutation errors on controller state', async () => {
  let latestState: ViewerControllerState | null = null;
  const repository: ViewerRepository = {
    loadDataset: () => Promise.resolve(dataset),
    importArchive: () => Promise.reject(new Error('Import failed.')),
    deleteCollection: () => Promise.resolve(dataset),
    setDefaultCollection: () => Promise.resolve(dataset),
    deleteImportedDataset: () => Promise.resolve(null),
  };

  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(
      <HookProbe repository={repository} onState={(state) => (latestState = state)} />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  await ReactTestRenderer.act(async () => {
    await latestState?.importArchive('/bad.zip');
    await Promise.resolve();
  });

  expect(latestState?.error).toBe('Import failed.');
  expect(latestState?.isMutating).toBe(false);
});
