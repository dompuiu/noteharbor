import { LocalDataNativeDatasetAdapter } from './localDataNativeDatasetAdapter';
import { MissingLocalDatasetError } from './localDatasetStorage';

function createMemoryStorage(snapshot: Record<string, unknown> | null) {
  let current = snapshot;

  return {
    readImportedDataset: () => Promise.resolve(current as any),
    writeImportedDataset: (nextSnapshot: Record<string, unknown>) => {
      current = JSON.parse(JSON.stringify(nextSnapshot));
      return Promise.resolve();
    },
    deleteImportedDataset: () => {
      current = null;
      return Promise.resolve();
    },
    getSnapshot: () => current,
  };
}

test('loads and normalizes a local dataset snapshot', async () => {
  const storage = createMemoryStorage({
    generatedAt: '2026-05-30T00:00:00.000Z',
    source: 'imported',
    collections: [{ id: '1', name: ' Default ', noteCount: '2', isDefault: true }],
    notes: [
      {
        id: '1',
        collectionId: '1',
        displayOrder: '2',
        denomination: '5 Lei',
        issueDate: '1991',
        catalogNumber: 'P-98',
        gradingCompany: 'PMG',
        grade: '64',
        watermark: '',
        serial: 'AB123',
        url: '',
        notes: 'Loaded from storage',
        scrapeStatus: 'done',
        scrapeError: '',
        tags: [{ id: '7', name: 'Romania' }],
        images: [{ type: 'front', variant: 'full', filePath: '/tmp/front.jpg' }],
        scrapedData: { raw: true },
      },
    ],
  });
  const adapter = new LocalDataNativeDatasetAdapter(storage);

  const dataset = await adapter.loadDataset();

  expect(dataset.collections[0]).toEqual({
    id: 1,
    name: 'Default',
    noteCount: 2,
    isDefault: true,
  });
  expect(dataset.notes[0].id).toBe(1);
  expect(dataset.notes[0].tags[0]).toEqual({ id: 7, name: 'Romania' });
  expect(dataset.notes[0].images[0].filePath).toBe('/tmp/front.jpg');
});

test('throws a missing dataset error when no snapshot exists', async () => {
  const adapter = new LocalDataNativeDatasetAdapter(createMemoryStorage(null));

  await expect(adapter.loadDataset()).rejects.toBeInstanceOf(
    MissingLocalDatasetError,
  );
});

test('sets a new default collection and persists it', async () => {
  const storage = createMemoryStorage({
    source: 'imported',
    collections: [
      { id: 1, name: 'Default', noteCount: 1, isDefault: true },
      { id: 2, name: 'Specimens', noteCount: 1, isDefault: false },
    ],
    notes: [],
  });
  const adapter = new LocalDataNativeDatasetAdapter(storage);

  await adapter.setDefaultCollection(2);

  const persisted = storage.getSnapshot() as any;
  expect(persisted.collections).toEqual([
    { id: 1, name: 'Default', noteCount: 1, isDefault: false },
    { id: 2, name: 'Specimens', noteCount: 1, isDefault: true },
  ]);
});

test('deletes a collection and reassigns default when needed', async () => {
  const storage = createMemoryStorage({
    source: 'imported',
    collections: [
      { id: 1, name: 'Default', noteCount: 2, isDefault: true },
      { id: 2, name: 'Specimens', noteCount: 1, isDefault: false },
    ],
    notes: [
      { id: 1, collectionId: 1, displayOrder: 1 },
      { id: 2, collectionId: 1, displayOrder: 2 },
      { id: 3, collectionId: 2, displayOrder: 1 },
    ],
  });
  const adapter = new LocalDataNativeDatasetAdapter(storage);

  await adapter.deleteCollection(1);

  const persisted = storage.getSnapshot() as any;
  expect(persisted.collections).toEqual([
    { id: 2, name: 'Specimens', noteCount: 1, isDefault: true },
  ]);
  expect(persisted.notes).toEqual([
    expect.objectContaining({ id: 3, collectionId: 2, displayOrder: 1 }),
  ]);
  expect(persisted.noteCount).toBe(1);
});

test('deletes the imported dataset snapshot', async () => {
  const storage = createMemoryStorage({ source: 'imported', collections: [], notes: [] });
  const adapter = new LocalDataNativeDatasetAdapter(storage);

  await adapter.deleteImportedDataset();

  expect(storage.getSnapshot()).toBeNull();
});

test('imports an archive into empty storage', async () => {
  const storage = createMemoryStorage(null);
  const adapter = new LocalDataNativeDatasetAdapter(storage, {
    importArchive: () =>
      Promise.resolve({
        generatedAt: '2026-06-01T00:00:00.000Z',
        source: 'imported',
        collections: [{ id: 5, name: 'Imported', noteCount: 1, isDefault: true }],
        notes: [{ id: 9, collectionId: 5, displayOrder: 3, denomination: '20 Lei' }],
      }),
  });

  await adapter.importArchive('/tmp/archive.zip');

  const persisted = storage.getSnapshot() as any;
  expect(persisted.generatedAt).toBe('2026-06-01T00:00:00.000Z');
  expect(persisted.collections).toEqual([
    { id: 5, name: 'Imported', noteCount: 1, isDefault: true },
  ]);
  expect(persisted.notes).toEqual([
    expect.objectContaining({ id: 9, collectionId: 5, displayOrder: 3, denomination: '20 Lei' }),
  ]);
});

test('imports an archive by replacing matching collection names and preserving others', async () => {
  const storage = createMemoryStorage({
    generatedAt: '2026-05-30T00:00:00.000Z',
    source: 'imported',
    collections: [
      { id: 1, name: 'Default', noteCount: 1, isDefault: true },
      { id: 2, name: 'Keep Me', noteCount: 1, isDefault: false },
    ],
    notes: [
      { id: 10, collectionId: 1, displayOrder: 1, denomination: 'Old Default' },
      { id: 11, collectionId: 2, displayOrder: 1, denomination: 'Keep Note' },
    ],
  });
  const adapter = new LocalDataNativeDatasetAdapter(storage, {
    importArchive: () =>
      Promise.resolve({
        generatedAt: '2026-06-02T00:00:00.000Z',
        source: 'imported',
        collections: [
          { id: 7, name: ' default ', noteCount: 1, isDefault: true },
          { id: 8, name: 'Fresh Import', noteCount: 1, isDefault: false },
        ],
        notes: [
          { id: 20, collectionId: 7, displayOrder: 9, denomination: 'New Default' },
          { id: 21, collectionId: 8, displayOrder: 4, denomination: 'Fresh Note' },
        ],
      }),
  });

  await adapter.importArchive('/tmp/archive.zip');

  const persisted = storage.getSnapshot() as any;
  expect(persisted.generatedAt).toBe('2026-06-02T00:00:00.000Z');
  expect(persisted.noteCount).toBe(3);
  expect(persisted.collections).toEqual([
    { id: 2, name: 'Keep Me', noteCount: 1, isDefault: false },
    { id: 3, name: 'default', noteCount: 1, isDefault: true },
    { id: 4, name: 'Fresh Import', noteCount: 1, isDefault: false },
  ]);
  expect(persisted.notes).toEqual([
    expect.objectContaining({ id: 11, collectionId: 2, denomination: 'Keep Note' }),
    expect.objectContaining({ id: 12, collectionId: 3, denomination: 'New Default' }),
    expect.objectContaining({ id: 13, collectionId: 4, denomination: 'Fresh Note' }),
  ]);
});
