import type { ViewerDataset } from '../shared/viewer-core';

export interface ViewerRepository {
  loadDataset(): Promise<ViewerDataset>;
  importArchive(archivePath: string): Promise<ViewerDataset>;
  deleteCollection(collectionId: number): Promise<ViewerDataset>;
  setDefaultCollection(collectionId: number): Promise<ViewerDataset>;
  deleteImportedDataset(): Promise<ViewerDataset | null>;
}
