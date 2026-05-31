import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { unzipSync } from 'fflate';
import RNFS from 'react-native-fs';

import { mockDataset } from '../data/mockDataset';
import type { LocalDatasetSnapshot } from './localDatasetStorage';
import {
  type NativeImportedDatasetReader,
  nativeImportedDatasetReader,
} from './nativeImportedDatasetReader';

function resolveFileSystem() {
  return RNFS && RNFS.DocumentDirectoryPath ? RNFS : null;
}

function getImportRootDirectoryPath() {
  const fileSystem = resolveFileSystem();
  if (!fileSystem) {
    throw new Error('Archive import is not available because react-native-fs is unavailable.');
  }

  return `${fileSystem.DocumentDirectoryPath}/noteharbor-viewer/imports`;
}

function cloneSnapshot(snapshot: LocalDatasetSnapshot): LocalDatasetSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as LocalDatasetSnapshot;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return encodeBase64(binary);
}

function base64ToBytes(value: string) {
  const binary = decodeBase64(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function posixPath(value: string) {
  return value.replace(/\\/g, '/');
}

function normalizeArchivePath(value: string) {
  return posixPath(value).replace(/^\/+/, '');
}

function ensureSafeArchivePath(relativePath: string) {
  const normalized = normalizeArchivePath(relativePath);

  if (
    normalized.length === 0 ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error('Archive contains invalid file paths.');
  }

  return normalized;
}

function directoryName(relativePath: string) {
  const index = relativePath.lastIndexOf('/');
  return index >= 0 ? relativePath.slice(0, index) : '';
}

async function ensureParentDirectory(targetPath: string) {
  const fileSystem = resolveFileSystem();
  if (!fileSystem) {
    throw new Error('Archive import is not available because react-native-fs is unavailable.');
  }

  const lastSlashIndex = targetPath.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return;
  }

  await fileSystem.mkdir(targetPath.slice(0, lastSlashIndex));
}

async function writeArchiveEntries(outputDir: string, archiveBytes: Uint8Array) {
  const fileSystem = resolveFileSystem();
  if (!fileSystem) {
    throw new Error('Archive import is not available because react-native-fs is unavailable.');
  }

  const archive = unzipSync(archiveBytes);

  for (const [entryName, entryBytes] of Object.entries(archive)) {
    const normalizedEntryPath = ensureSafeArchivePath(entryName);
    const entryOutputPath = `${outputDir}/${normalizedEntryPath}`;

    if (entryName.endsWith('/')) {
      await fileSystem.mkdir(entryOutputPath);
      continue;
    }

    const entryDirectory = directoryName(normalizedEntryPath);
    if (entryDirectory.length > 0) {
      await fileSystem.mkdir(`${outputDir}/${entryDirectory}`);
    } else {
      await ensureParentDirectory(entryOutputPath);
    }

    await fileSystem.writeFile(entryOutputPath, bytesToBase64(entryBytes), 'base64');
  }
}

async function findArchiveDataDir(rootDir: string): Promise<string | null> {
  const fileSystem = resolveFileSystem();
  if (!fileSystem) {
    throw new Error('Archive import is not available because react-native-fs is unavailable.');
  }

  const queue = [rootDir];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir || visited.has(currentDir)) {
      continue;
    }

    visited.add(currentDir);

    const [dbExists, imagesExists] = await Promise.all([
      fileSystem.exists(`${currentDir}/banknotes.db`),
      fileSystem.exists(`${currentDir}/images`),
    ]);

    if (dbExists && imagesExists) {
      return currentDir;
    }

    const entries = await fileSystem.readDir(currentDir);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(entry.path);
      }
    }
  }

  return null;
}

async function importArchiveSnapshot(
  archivePath: string,
  reader: NativeImportedDatasetReader,
): Promise<LocalDatasetSnapshot> {
  const fileSystem = resolveFileSystem();
  if (!fileSystem) {
    throw new Error('Archive import is not available because react-native-fs is unavailable.');
  }

  if (!archivePath.trim().toLowerCase().endsWith('.zip')) {
    throw new Error('Archive must be a .zip file.');
  }

  const archiveExists = await fileSystem.exists(archivePath);
  if (!archiveExists) {
    throw new Error('The selected archive file no longer exists.');
  }

  const extractionDir = `${getImportRootDirectoryPath()}/import-${Date.now()}`;

  await fileSystem.mkdir(getImportRootDirectoryPath());
  await fileSystem.mkdir(extractionDir);

  try {
    const archiveBytes = base64ToBytes(await fileSystem.readFile(archivePath, 'base64'));
    await writeArchiveEntries(extractionDir, archiveBytes);

    const archiveDataDir = await findArchiveDataDir(extractionDir);
    if (archiveDataDir == null) {
      throw new Error('Archive must contain a banknotes.db file and an images directory.');
    }

    return await reader.readImportedDataset({
      databasePath: `${archiveDataDir}/banknotes.db`,
      imagesDirectoryPath: `${archiveDataDir}/images`,
    });
  } catch (error) {
    await fileSystem.unlink(extractionDir).catch(() => undefined);
    throw error;
  }
}

export interface LocalArchiveImporter {
  importArchive(archivePath: string): Promise<LocalDatasetSnapshot>;
}

export class SeededLocalArchiveImporter implements LocalArchiveImporter {
  async importArchive(archivePath: string): Promise<LocalDatasetSnapshot> {
    await Promise.resolve();

    if (!archivePath.trim().toLowerCase().endsWith('.zip')) {
      throw new Error('Archive must be a .zip file.');
    }

    return cloneSnapshot(mockDataset);
  }
}

export class FilesystemLocalArchiveImporter implements LocalArchiveImporter {
  constructor(
    private readonly reader: NativeImportedDatasetReader = nativeImportedDatasetReader,
  ) {}

  async importArchive(archivePath: string): Promise<LocalDatasetSnapshot> {
    return importArchiveSnapshot(archivePath, this.reader);
  }
}
