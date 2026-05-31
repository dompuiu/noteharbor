export interface LocalDatasetSnapshot {
  generatedAt?: string | null;
  noteCount?: number;
  notes?: Array<Record<string, unknown>>;
  collections?: Array<Record<string, unknown>>;
  source?: string;
}

export interface LocalDatasetStorage {
  readImportedDataset(): Promise<LocalDatasetSnapshot | null>;
  writeImportedDataset(snapshot: LocalDatasetSnapshot): Promise<void>;
  deleteImportedDataset(): Promise<void>;
}

export class MissingLocalDatasetError extends Error {
  constructor() {
    super('No imported dataset is installed.');
  }
}
