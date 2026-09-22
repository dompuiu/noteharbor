import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { unzipSync } from 'fflate';

import { mockDataset } from '../data/mockDataset';
import type { LocalDatasetSnapshot } from './localDatasetStorage';
import {
  type NativeImportedDatasetReader,
  nativeImportedDatasetReader,
} from './nativeImportedDatasetReader';

interface FileSystemDirectoryEntry {
  isDirectory: boolean | (() => boolean);
  path: string;
}

function isDirectoryEntry(entry: FileSystemDirectoryEntry): boolean {
  return typeof entry.isDirectory === 'function' ? entry.isDirectory() : !!entry.isDirectory;
}

interface FileSystemModule {
  DocumentDirectoryPath?: string;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<FileSystemDirectoryEntry[]>;
  readFile(path: string, encoding: string): Promise<string>;
  unlink(path: string): Promise<void>;
  writeFile(path: string, contents: string, encoding: string): Promise<void>;
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

interface WindowsFileSystemModule extends FileSystemModule {
  getDocumentDirectoryPath?: () => string;
  getFileSize?: (path: string) => number;
}

let cachedWindowsDocumentDir: string | null = null;

function resolveWindowsFileSystem(): FileSystemModule | null {
  try {
    const reactNative = require('react-native') as {
      NativeModules?: Record<string, WindowsFileSystemModule | undefined>;
    };
    const live = reactNative.NativeModules?.NoteHarborFileSystem;
    if (!live) {
      return null;
    }
    let dir = live.DocumentDirectoryPath;
    if (!dir) {
      if (cachedWindowsDocumentDir) {
        dir = cachedWindowsDocumentDir;
      } else if (typeof live.getDocumentDirectoryPath === 'function') {
        try {
          const fetched = live.getDocumentDirectoryPath();
          if (!fetched) {
            return null;
          }
          cachedWindowsDocumentDir = fetched;
          dir = fetched;
        } catch {
          return null;
        }
      } else {
        return null;
      }
    }
    // Delegate explicitly instead of spreading: native module proxies
    // may not expose their methods as own enumerable properties.
    const resolved: WindowsFileSystemModule = {
      DocumentDirectoryPath: dir,
      exists: (path) => live.exists(path),
      mkdir: (path) => live.mkdir(path),
      readDir: (path) => live.readDir(path),
      readFile: (path, encoding) => live.readFile(path, encoding),
      unlink: (path) => live.unlink(path),
      writeFile: (path, contents, encoding) => live.writeFile(path, contents, encoding),
    };
    if (typeof live.getDocumentDirectoryPath === 'function') {
      resolved.getDocumentDirectoryPath = () => (live.getDocumentDirectoryPath as () => string)();
    }
    if (typeof live.getFileSize === 'function') {
      resolved.getFileSize = (path: string) => (live.getFileSize as (path: string) => number)(path);
    }
    return resolved;
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

function fileSystemUnavailableError() {
  if (currentPlatform() === 'windows') {
    try {
      const reactNative = require('react-native') as {
        NativeModules?: Record<string, FileSystemModule | undefined>;
      };
      const module = reactNative.NativeModules?.NoteHarborFileSystem;
      if (!module) {
        return new Error(
          'Archive import is not available because the NoteHarborFileSystem native module is missing.',
        );
      }
      if (!module.DocumentDirectoryPath) {
        return new Error(
          'Archive import is not available because the NoteHarborFileSystem module returned no document directory.',
        );
      }
    } catch {
      // Fall through to the generic error below.
    }
  }
  return new Error('Archive import is not available because react-native-fs is unavailable.');
}

function getImportRootDirectoryPath() {
  const fileSystem = resolveFileSystem();
  if (!fileSystem) {
    throw fileSystemUnavailableError();
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

function describeNativeSize(fileSystem: FileSystemModule, archivePath: string): string {
  try {
    const sized = fileSystem as WindowsFileSystemModule;
    if (typeof sized.getFileSize !== 'function') {
      return 'no native size probe';
    }
    const size = sized.getFileSize(archivePath);
    return typeof size === 'number' && size >= 0 ? `${size} bytes` : 'unknown size';
  } catch {
    return 'unknown size';
  }
}

function hasZipSignature(bytes: Uint8Array): boolean {
  // Local file header (PK\x03\x04), empty archive (PK\x05\x06), or
  // spanned archive (PK\x07\x08).
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
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
    throw fileSystemUnavailableError();
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
    throw fileSystemUnavailableError();
  }

  let archive: ReturnType<typeof unzipSync>;
  try {
    archive = unzipSync(archiveBytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : `${error}`;
    throw new Error(`Archive could not be unzipped (${archiveBytes.length} bytes read): ${detail}`);
  }

  // Yield to the event loop every few writes so the blocking overlay paints.
  const yieldEveryEntries = 8;
  let writtenEntries = 0;
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

    writtenEntries += 1;
    if (writtenEntries % yieldEveryEntries === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}

async function findArchiveDataDir(rootDir: string): Promise<string | null> {
  const fileSystem = resolveFileSystem();
  if (!fileSystem) {
    throw fileSystemUnavailableError();
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
      if (isDirectoryEntry(entry)) {
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
    throw fileSystemUnavailableError();
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
    if (archiveBytes.length === 0) {
      throw new Error(
        `Archive file is empty (0 bytes read, native reports ${describeNativeSize(fileSystem, archivePath)}).`,
      );
    }
    if (!hasZipSignature(archiveBytes)) {
      throw new Error(
        `Archive is not a valid zip file (${archiveBytes.length} bytes read, unexpected header).`,
      );
    }
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
