import { mockDataset } from '../data/mockDataset';
import type { LocalDatasetSnapshot, LocalDatasetStorage } from './localDatasetStorage';

interface FileSystemModule {
  DocumentDirectoryPath?: string;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readFile(path: string, encoding: string): Promise<string>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, contents: string, encoding: string): Promise<void>;
  moveFile?(src: string, dest: string): Promise<void>;
}

function cloneSnapshot(snapshot: LocalDatasetSnapshot): LocalDatasetSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as LocalDatasetSnapshot;
}

function fileSystemUnavailableError() {
  return new Error('Local filesystem storage is not available on this platform.');
}

function currentPlatform() {
  try {
    const reactNative = require('react-native') as {
      Platform?: { OS?: string };
    };
    return reactNative.Platform?.OS ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveWindowsFileSystem(): FileSystemModule | null {
  try {
    const reactNative = require('react-native') as {
      NativeModules?: Record<string, FileSystemModule | undefined>;
    };
    const module = reactNative.NativeModules?.NoteHarborFileSystem;
    return module && module.DocumentDirectoryPath ? module : null;
  } catch {
    return null;
  }
}

function resolveFileSystem() {
  if (currentPlatform() === 'windows') {
    return resolveWindowsFileSystem();
  }

  try {
    const module = require('react-native-fs') as FileSystemModule | null;
    return module && module.DocumentDirectoryPath ? module : null;
  } catch {
    return null;
  }
}

export class SeededLocalDatasetStorage implements LocalDatasetStorage {
  private snapshot: LocalDatasetSnapshot | null | undefined;

  private getPaths() {
    const fileSystem = resolveFileSystem();
    if (!fileSystem) {
      return null;
    }

    const rootDirectoryPath = `${fileSystem.DocumentDirectoryPath}/noteharbor-viewer`;
    return {
      fileSystem,
      rootDirectoryPath,
      snapshotPath: `${rootDirectoryPath}/dataset.json`,
      importsDirectoryPath: `${rootDirectoryPath}/imports`,
    };
  }

  async readImportedDataset(): Promise<LocalDatasetSnapshot | null> {
    if (this.snapshot !== undefined) {
      return this.snapshot ? cloneSnapshot(this.snapshot) : null;
    }

    if (!this.getPaths()) {
      this.snapshot = cloneSnapshot(mockDataset);
      return cloneSnapshot(this.snapshot);
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
    if (!this.getPaths()) {
      return;
    }

    await this.writeToDisk(this.snapshot);
  }

  async deleteImportedDataset(): Promise<void> {
    this.snapshot = null;

    const paths = this.getPaths();
    if (!paths) {
      return;
    }

    if (await paths.fileSystem.exists(paths.importsDirectoryPath)) {
      await paths.fileSystem.unlink(paths.importsDirectoryPath);
    }

    await paths.fileSystem.mkdir(paths.rootDirectoryPath);
    await paths.fileSystem.writeFile(paths.snapshotPath, 'null', 'utf8');
  }

  private async readFromDisk() {
    const paths = this.getPaths();
    if (!paths) {
      return null;
    }

    if (!(await paths.fileSystem.exists(paths.snapshotPath))) {
      return null;
    }

    const parsed = JSON.parse(
      await paths.fileSystem.readFile(paths.snapshotPath, 'utf8'),
    ) as LocalDatasetSnapshot | null;
    return parsed;
  }

  private async writeToDisk(snapshot: LocalDatasetSnapshot) {
    const paths = this.getPaths();
    if (!paths) {
      throw fileSystemUnavailableError();
    }

    await paths.fileSystem.mkdir(paths.rootDirectoryPath);
    const payload = JSON.stringify(snapshot);
    const tmpPath = `${paths.snapshotPath}.tmp`;
    await paths.fileSystem.writeFile(tmpPath, payload, 'utf8');
    try {
      if (paths.fileSystem.moveFile) {
        await paths.fileSystem.moveFile(tmpPath, paths.snapshotPath);
      } else {
        await paths.fileSystem.writeFile(paths.snapshotPath, payload, 'utf8');
        await paths.fileSystem.unlink(tmpPath).catch(() => undefined);
      }
    } catch {
      await paths.fileSystem.writeFile(paths.snapshotPath, payload, 'utf8');
      await paths.fileSystem.unlink(tmpPath).catch(() => undefined);
    }
  }
}
