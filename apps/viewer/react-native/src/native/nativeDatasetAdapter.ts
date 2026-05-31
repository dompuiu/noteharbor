import type { ViewerDataset } from '../shared/viewer-core';

export interface NativeDatasetAdapter {
  loadDataset(): Promise<ViewerDataset>;
  importArchive(archivePath: string): Promise<void>;
  deleteCollection(collectionId: number): Promise<void>;
  setDefaultCollection(collectionId: number): Promise<void>;
  deleteImportedDataset(): Promise<void>;
}
