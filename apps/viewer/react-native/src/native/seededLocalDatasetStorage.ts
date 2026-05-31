import RNFS from 'react-native-fs';

import { mockDataset } from '../data/mockDataset';
import type { LocalDatasetSnapshot, LocalDatasetStorage } from './localDatasetStorage';

function cloneSnapshot(snapshot: LocalDatasetSnapshot): LocalDatasetSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as LocalDatasetSnapshot;
}

export class SeededLocalDatasetStorage implements LocalDatasetStorage {
  private readonly rootDirectoryPath = `${RNFS.DocumentDirectoryPath}/noteharbor-viewer`;
  private readonly snapshotPath = `${this.rootDirectoryPath}/dataset.json`;
  private readonly importsDirectoryPath = `${this.rootDirectoryPath}/imports`;
  private snapshot: LocalDatasetSnapshot | null | undefined;

  async readImportedDataset(): Promise<LocalDatasetSnapshot | null> {
    if (this.snapshot !== undefined) {
      return this.snapshot ? cloneSnapshot(this.snapshot) : null;
    }

    const diskSnapshot = await this.readFromDisk();
    if (diskSnapshot != null) {
      this.snapshot = diskSnapshot;
      return cloneSnapshot(diskSnapshot);
    }

    this.snapshot = cloneSnapshot(mockDataset);
    await this.writeToDisk(this.snapshot);
    return cloneSnapshot(this.snapshot);
  }

  async writeImportedDataset(snapshot: LocalDatasetSnapshot): Promise<void> {
    this.snapshot = cloneSnapshot(snapshot);
    await this.writeToDisk(this.snapshot);
  }

  async deleteImportedDataset(): Promise<void> {
    this.snapshot = null;

    if (await RNFS.exists(this.importsDirectoryPath)) {
      await RNFS.unlink(this.importsDirectoryPath);
    }

    await RNFS.mkdir(this.rootDirectoryPath);
    await RNFS.writeFile(this.snapshotPath, 'null', 'utf8');
  }

  private async readFromDisk() {
    if (!(await RNFS.exists(this.snapshotPath))) {
      return null;
    }

    const parsed = JSON.parse(await RNFS.readFile(this.snapshotPath, 'utf8')) as LocalDatasetSnapshot | null;
    return parsed;
  }

  private async writeToDisk(snapshot: LocalDatasetSnapshot) {
    await RNFS.mkdir(this.rootDirectoryPath);
    await RNFS.writeFile(this.snapshotPath, JSON.stringify(snapshot), 'utf8');
  }
}
