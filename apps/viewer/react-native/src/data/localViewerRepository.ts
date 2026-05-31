import type { ViewerDataset } from '../shared/viewer-core';

import { LocalDataNativeDatasetAdapter } from '../native/localDataNativeDatasetAdapter';
import { SeededLocalDatasetStorage } from '../native/seededLocalDatasetStorage';
import type { NativeDatasetAdapter } from '../native/nativeDatasetAdapter';
import type { ViewerRepository } from './viewerRepository';

export class LocalViewerRepository implements ViewerRepository {
  constructor(
    private readonly adapter: NativeDatasetAdapter = new LocalDataNativeDatasetAdapter(
      new SeededLocalDatasetStorage(),
    ),
  ) {}

  async loadDataset(): Promise<ViewerDataset> {
    return this.adapter.loadDataset();
  }

  async importArchive(archivePath: string): Promise<ViewerDataset> {
    await this.adapter.importArchive(archivePath);
    return this.adapter.loadDataset();
  }

  async deleteCollection(collectionId: number): Promise<ViewerDataset> {
    await this.adapter.deleteCollection(collectionId);
    return this.adapter.loadDataset();
  }

  async setDefaultCollection(collectionId: number): Promise<ViewerDataset> {
    await this.adapter.setDefaultCollection(collectionId);
    return this.adapter.loadDataset();
  }

  async deleteImportedDataset(): Promise<ViewerDataset | null> {
    await this.adapter.deleteImportedDataset();
    return null;
  }
}
