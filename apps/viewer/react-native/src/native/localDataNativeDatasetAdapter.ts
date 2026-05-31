import type {
  NoteImage,
  NoteRecord,
  Tag,
  ViewerCollection,
  ViewerDataset,
} from '../shared/viewer-core';

import {
  type LocalDatasetSnapshot,
  type LocalDatasetStorage,
  MissingLocalDatasetError,
} from './localDatasetStorage';
import {
  FilesystemLocalArchiveImporter,
  type LocalArchiveImporter,
  SeededLocalArchiveImporter,
} from './localArchiveImporter';
import type { NativeDatasetAdapter } from './nativeDatasetAdapter';

function toInt(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  return fallback;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : `${value ?? ''}`;
}

function toOptionalString(value: unknown) {
  const stringValue = toStringValue(value).trim();
  return stringValue.length > 0 ? stringValue : undefined;
}

function toTag(value: Record<string, unknown>): Tag {
  const id = toInt(value.id, 0);

  return {
    id: id > 0 ? id : undefined,
    name: toStringValue(value.name).trim(),
  };
}

function toNoteImage(value: Record<string, unknown>): NoteImage {
  return {
    assetPath: toOptionalString(value.assetPath),
    filePath: toOptionalString(value.filePath),
    type: toStringValue(value.type),
    variant: toStringValue(value.variant),
    sourceUrl: toOptionalString(value.sourceUrl),
  };
}

function toNoteRecord(value: Record<string, unknown>): NoteRecord {
  const scrapedData =
    value.scrapedData &&
    typeof value.scrapedData === 'object' &&
    !Array.isArray(value.scrapedData)
      ? (value.scrapedData as Record<string, unknown>)
      : null;

  return {
    id: toInt(value.id),
    collectionId: toInt(value.collectionId),
    displayOrder: toInt(value.displayOrder),
    denomination: toStringValue(value.denomination),
    issueDate: toStringValue(value.issueDate),
    catalogNumber: toStringValue(value.catalogNumber),
    gradingCompany: toStringValue(value.gradingCompany),
    grade: toStringValue(value.grade),
    watermark: toStringValue(value.watermark),
    serial: toStringValue(value.serial),
    url: toStringValue(value.url),
    notes: toStringValue(value.notes),
    scrapeStatus: toStringValue(value.scrapeStatus),
    scrapeError: toStringValue(value.scrapeError),
    tags: Array.isArray(value.tags)
      ? value.tags
          .filter(
            (tag): tag is Record<string, unknown> =>
              Boolean(tag && typeof tag === 'object'),
          )
          .map(toTag)
      : [],
    images: Array.isArray(value.images)
      ? value.images
          .filter(
            (image): image is Record<string, unknown> =>
              Boolean(image && typeof image === 'object'),
          )
          .map(toNoteImage)
      : [],
    scrapedData,
  };
}

function toCollection(value: Record<string, unknown>): ViewerCollection {
  return {
    id: toInt(value.id),
    name: toStringValue(value.name).trim(),
    noteCount: toInt(value.noteCount),
    isDefault: value.isDefault === true,
  };
}

function toDatasetSource(value: unknown): ViewerDataset['source'] {
  return value === 'bundled' ? 'bundled' : 'imported';
}

function normalizeSnapshot(snapshot: LocalDatasetSnapshot): ViewerDataset {
  const notes = Array.isArray(snapshot.notes)
    ? snapshot.notes
        .filter(
          (note): note is Record<string, unknown> =>
            Boolean(note && typeof note === 'object'),
        )
        .map(toNoteRecord)
    : [];
  const collections = Array.isArray(snapshot.collections)
    ? snapshot.collections
        .filter(
          (collection): collection is Record<string, unknown> =>
            Boolean(collection && typeof collection === 'object'),
        )
        .map(toCollection)
    : [];

  return {
    generatedAt: snapshot.generatedAt ?? null,
    noteCount:
      typeof snapshot.noteCount === 'number' ? snapshot.noteCount : notes.length,
    notes,
    collections,
    source: toDatasetSource(snapshot.source),
  };
}

function toSnapshot(dataset: ViewerDataset): LocalDatasetSnapshot {
  return JSON.parse(JSON.stringify(dataset)) as LocalDatasetSnapshot;
}

function sortCollectionNames(a: ViewerCollection, b: ViewerCollection) {
  return a.id - b.id;
}

function sortNotes(a: NoteRecord, b: NoteRecord) {
  if (a.collectionId !== b.collectionId) {
    return a.collectionId - b.collectionId;
  }

  if (a.displayOrder !== b.displayOrder) {
    return a.displayOrder - b.displayOrder;
  }

  return a.id - b.id;
}

function normalizeCollectionName(name: string) {
  return name.trim().toLowerCase();
}

function nextId(values: Array<{ id: number }>) {
  return values.reduce((maxId, value) => Math.max(maxId, value.id), 0) + 1;
}

function withCollectionCounts(
  dataset: ViewerDataset,
  preferredDefaultId: number | null = null,
): ViewerDataset {
  const fallbackDefaultId =
    preferredDefaultId ??
    dataset.collections.find((collection) => collection.isDefault)?.id ??
    dataset.collections[0]?.id ??
    null;

  return {
    ...dataset,
    noteCount: dataset.notes.length,
    collections: dataset.collections.map((collection) => ({
      ...collection,
      noteCount: dataset.notes.filter((note) => note.collectionId === collection.id).length,
      isDefault: fallbackDefaultId != null && collection.id === fallbackDefaultId,
    })),
  };
}

function mergeImportedDataset(
  currentDataset: ViewerDataset | null,
  importedDataset: ViewerDataset,
): ViewerDataset {
  const normalizedImported = withCollectionCounts(importedDataset);
  if (currentDataset == null) {
    return normalizedImported;
  }

  const remainingCollections = [...currentDataset.collections];
  let remainingNotes = [...currentDataset.notes];

  for (const importedCollection of normalizedImported.collections) {
    const existingCollection = remainingCollections.find(
      (collection) =>
        normalizeCollectionName(collection.name) ===
        normalizeCollectionName(importedCollection.name),
    );

    if (!existingCollection) {
      continue;
    }

    remainingNotes = remainingNotes.filter(
      (note) => note.collectionId !== existingCollection.id,
    );

    const collectionIndex = remainingCollections.findIndex(
      (collection) => collection.id === existingCollection.id,
    );
    if (collectionIndex >= 0) {
      remainingCollections.splice(collectionIndex, 1);
    }
  }

  let nextCollectionId = nextId(remainingCollections);
  let nextNoteId = nextId(remainingNotes);
  const collectionIdMap = new Map<number, number>();
  const importedCollections = normalizedImported.collections
    .slice()
    .sort(sortCollectionNames)
    .map((collection) => {
      const id = nextCollectionId;
      nextCollectionId += 1;
      collectionIdMap.set(collection.id, id);

      return {
        ...collection,
        id,
        noteCount: 0,
        isDefault: false,
      };
    });

  const importedNotes = normalizedImported.notes
    .slice()
    .sort(sortNotes)
    .map((note) => ({
      ...note,
      id: nextNoteId++,
      collectionId: collectionIdMap.get(note.collectionId) ?? note.collectionId,
    }));

  const orderedCollections = [...remainingCollections, ...importedCollections];
  const nextCollections = orderedCollections.map((collection) => ({
    ...collection,
    noteCount: 0,
    isDefault: false,
  }));
  const nextNotes = [...remainingNotes, ...importedNotes]
    .sort(sortNotes)
    .map((note) => note);

  const importedDefaultCollection = normalizedImported.collections
    .slice()
    .sort(sortCollectionNames)
    .find((collection) => collection.isDefault);
  const preferredDefaultId = importedDefaultCollection
    ? collectionIdMap.get(importedDefaultCollection.id) ?? null
    : currentDataset.collections.find((collection) => collection.isDefault)?.id ?? null;

  return withCollectionCounts(
    {
      ...currentDataset,
      generatedAt: normalizedImported.generatedAt,
      source: normalizedImported.source,
      collections: nextCollections,
      notes: nextNotes,
    },
    preferredDefaultId,
  );
}

function ensureDataset(dataset: ViewerDataset | null): ViewerDataset {
  if (dataset == null) {
    throw new MissingLocalDatasetError();
  }

  return dataset;
}

export class LocalDataNativeDatasetAdapter implements NativeDatasetAdapter {
  constructor(
    private readonly storage: LocalDatasetStorage,
    private readonly archiveImporter: LocalArchiveImporter =
      typeof jest !== 'undefined'
        ? new SeededLocalArchiveImporter()
        : new FilesystemLocalArchiveImporter(),
  ) {}

  async loadDataset(): Promise<ViewerDataset> {
    const snapshot = await this.storage.readImportedDataset();
    if (snapshot == null) {
      throw new MissingLocalDatasetError();
    }

    return normalizeSnapshot(snapshot);
  }

  async importArchive(archivePath: string): Promise<void> {
    const importedSnapshot = await this.archiveImporter.importArchive(archivePath);
    const currentDataset = await this.tryLoadDataset();
    const nextDataset = mergeImportedDataset(
      currentDataset,
      normalizeSnapshot(importedSnapshot),
    );

    await this.storage.writeImportedDataset(toSnapshot(nextDataset));
  }

  async deleteCollection(collectionId: number): Promise<void> {
    const dataset = ensureDataset(await this.tryLoadDataset());

    const remainingCollections = dataset.collections.filter(
      (collection) => collection.id !== collectionId,
    );
    if (remainingCollections.length === dataset.collections.length) {
      throw new Error('Collection not found.');
    }

    const remainingNotes = dataset.notes.filter(
      (note) => note.collectionId !== collectionId,
    );
    const nextDefaultId =
      remainingCollections.find((collection) => collection.isDefault)?.id ??
      remainingCollections[0]?.id ??
      null;

    const nextDataset: ViewerDataset = {
      ...dataset,
      noteCount: remainingNotes.length,
      notes: remainingNotes,
      collections: remainingCollections.map((collection) => ({
        ...collection,
        noteCount: remainingNotes.filter(
          (note) => note.collectionId === collection.id,
        ).length,
        isDefault: nextDefaultId != null && collection.id === nextDefaultId,
      })),
    };

    await this.storage.writeImportedDataset(toSnapshot(nextDataset));
  }

  async setDefaultCollection(collectionId: number): Promise<void> {
    const dataset = ensureDataset(await this.tryLoadDataset());
    if (!dataset.collections.some((collection) => collection.id === collectionId)) {
      throw new Error('Collection not found.');
    }

    const nextDataset: ViewerDataset = {
      ...dataset,
      collections: dataset.collections.map((collection) => ({
        ...collection,
        isDefault: collection.id === collectionId,
      })),
    };

    await this.storage.writeImportedDataset(toSnapshot(nextDataset));
  }

  async deleteImportedDataset(): Promise<void> {
    await this.storage.deleteImportedDataset();
  }

  private async tryLoadDataset() {
    const snapshot = await this.storage.readImportedDataset();
    return snapshot == null ? null : normalizeSnapshot(snapshot);
  }
}
