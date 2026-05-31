import type { ViewerDataset } from '../shared/viewer-core';

import { mockDataset } from '../data/mockDataset';
import type { NativeDatasetAdapter } from './nativeDatasetAdapter';

function cloneDataset(dataset: ViewerDataset) {
  return JSON.parse(JSON.stringify(dataset)) as ViewerDataset;
}

function defaultImportedDataset(): ViewerDataset {
  return cloneDataset(mockDataset);
}

export class MockNativeDatasetAdapter implements NativeDatasetAdapter {
  private dataset: ViewerDataset | null = defaultImportedDataset();

  async loadDataset(): Promise<ViewerDataset> {
    await Promise.resolve();

    if (this.dataset == null) {
      throw new Error('No imported dataset is installed.');
    }

    return cloneDataset(this.dataset);
  }

  async importArchive(_archivePath: string): Promise<void> {
    await Promise.resolve();
    this.dataset = defaultImportedDataset();
  }

  async deleteCollection(collectionId: number): Promise<void> {
    await Promise.resolve();

    if (this.dataset == null) {
      throw new Error('No imported dataset is installed.');
    }

    const remainingCollections = this.dataset.collections.filter(
      (collection) => collection.id !== collectionId,
    );
    if (remainingCollections.length === this.dataset.collections.length) {
      throw new Error('Collection not found.');
    }

    const remainingNotes = this.dataset.notes.filter(
      (note) => note.collectionId !== collectionId,
    );
    const fallbackDefaultId = remainingCollections[0]?.id ?? null;

    this.dataset = {
      ...this.dataset,
      noteCount: remainingNotes.length,
      notes: remainingNotes,
      collections: remainingCollections.map((collection) => ({
        ...collection,
        noteCount: remainingNotes.filter((note) => note.collectionId === collection.id).length,
        isDefault:
          remainingCollections.some((candidate) => candidate.isDefault) && collection.isDefault
            ? true
            : fallbackDefaultId != null && collection.id === fallbackDefaultId,
      })),
    };
  }

  async setDefaultCollection(collectionId: number): Promise<void> {
    await Promise.resolve();

    if (this.dataset == null) {
      throw new Error('No imported dataset is installed.');
    }

    if (!this.dataset.collections.some((collection) => collection.id === collectionId)) {
      throw new Error('Collection not found.');
    }

    this.dataset = {
      ...this.dataset,
      collections: this.dataset.collections.map((collection) => ({
        ...collection,
        isDefault: collection.id === collectionId,
      })),
    };
  }

  async deleteImportedDataset(): Promise<void> {
    await Promise.resolve();
    this.dataset = null;
  }
}
