import { decode as decodeBase64, encode as encodeBase64 } from 'base-64';
import { Inflate, strFromU8, unzipSync } from 'fflate';

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
  readFileChunk?(path: string, offset: number, length: number, encoding: string): Promise<string>;
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
  readFileChunk?: (path: string, offset: number, length: number, encoding: string) => Promise<string>;
  extractArchive?: (archivePath: string, destDir: string) => Promise<void>;
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
    if (typeof live.readFileChunk === 'function') {
      const chunked = live.readFileChunk;
      resolved.readFileChunk = (path: string, offset: number, length: number, encoding: string) =>
        chunked(path, offset, length, encoding);
    }
    if (typeof live.extractArchive === 'function') {
      const extractor = live.extractArchive;
      resolved.extractArchive = (archivePath: string, destDir: string) =>
        extractor(archivePath, destDir);
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
  // Chunked conversion: per-byte concatenation is O(n^2) and
  // single-shot apply() blows the stack on multi-MB images.
  let binary = '';
  const step = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(offset, offset + step)),
    );
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

const streamChunkBytes = 4 * 1024 * 1024;

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

type ChunkedFileSystem = FileSystemModule & {
  readFileChunk: (path: string, offset: number, length: number, encoding: string) => Promise<string>;
};

interface CentralDirectoryEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
}

// React Native Windows delivers native rejections as plain objects
// ({code, message}) rather than Error instances — interpolating them yields
// "[object Object]" and instanceof checks miss. Unwrap every shape here so
// no catch site can mask tar/sqlite/filesystem failures again.
export function describeNativeRejection(value: unknown): string {
  if (value instanceof Error) {
    return value.message.length > 0 ? value.message : String(value);
  }
  if (typeof value === 'string') {
    return value.length > 0 ? value : 'Unknown error.';
  }
  if (value != null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message = record.message;
    if (typeof message === 'string' && message.length > 0) {
      const code = record.code;
      if (typeof code === 'string' && code.length > 0 && code !== 'EUNSPECIFIED') {
        return `${message} (${code})`;
      }
      return message;
    }
    const nested = record.error ?? record.userInfo ?? record.detail ?? record.reason;
    if (typeof nested === 'string' && nested.length > 0) {
      return nested;
    }
    if (nested != null && typeof nested === 'object') {
      const localized = (nested as Record<string, unknown>).NSLocalizedDescription;
      if (typeof localized === 'string' && localized.length > 0) {
        return localized;
      }
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== '{}' && serialized !== 'null') {
        return serialized;
      }
    } catch {
      // Fall through to the generic text below.
    }
  }
  if (value == null) {
    return 'Unknown error.';
  }
  return String(value);
}

function parseEndOfCentralDirectory(
  tail: Uint8Array,
  totalSize: number,
): { count: number; directorySize: number; directoryOffset: number } {
  // The end-of-central-directory record is 22 bytes plus an optional
  // comment (<= 64KB). Scan backwards for its signature so a comment
  // containing zip-like bytes cannot mislead us.
  const view = viewOf(tail);
  for (let pos = tail.length - 22; pos >= 0; pos -= 1) {
    if (view.getUint32(pos, true) !== 0x06054b50) {
      continue;
    }

    const diskNumber = view.getUint16(pos + 4, true);
    const directoryStartDisk = view.getUint16(pos + 6, true);
    const entriesOnDisk = view.getUint16(pos + 8, true);
    const count = view.getUint16(pos + 10, true);
    const directorySize = view.getUint32(pos + 12, true);
    const directoryOffset = view.getUint32(pos + 16, true);

    if (diskNumber !== 0 || directoryStartDisk !== 0 || entriesOnDisk !== count) {
      throw new Error('Multi-disk archives are not supported. Re-export as a single .zip file.');
    }
    if (
      count === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    ) {
      throw new Error('ZIP64 archives are not supported. Export an archive under 4GB.');
    }
    if (directoryOffset + directorySize > totalSize) {
      continue;
    }

    return { count, directorySize, directoryOffset };
  }

  throw new Error(
    'Archive directory could not be found (missing end-of-central-directory). The file may be incomplete.',
  );
}

function parseCentralDirectory(
  bytes: Uint8Array,
  count: number,
): CentralDirectoryEntry[] {
  const view = viewOf(bytes);
  const entries: CentralDirectoryEntry[] = [];
  let offset = 0;

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Archive directory is corrupt (bad central directory entry).');
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
    // Mirror fflate: honor the UTF-8 flag, otherwise treat names as latin1.
    const name = strFromU8(nameBytes, !(flags & 0x800));

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error('ZIP64 archives are not supported. Export an archive under 4GB.');
    }

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function readArchiveRange(
  fileSystem: ChunkedFileSystem,
  archivePath: string,
  totalSize: number,
  offset: number,
  length: number,
  chunkSize: number,
): Promise<Uint8Array> {
  if (length <= 0) {
    return new Uint8Array(0);
  }

  const out = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    const want = Math.min(chunkSize, length - filled);
    let encoded: string;
    try {
      encoded = await fileSystem.readFileChunk(archivePath, offset + filled, want, 'base64');
    } catch (error) {
      const detail = describeNativeRejection(error);
      throw new Error(`Archive could not be read (${offset + filled} of ${totalSize} bytes read): ${detail}`);
    }
    const slice = base64ToBytes(encoded);
    if (slice.length === 0) {
      break;
    }
    out.set(slice.subarray(0, Math.min(slice.length, length - filled)), filled);
    filled += slice.length;
    if (slice.length < want) {
      break;
    }
  }

  return filled === length ? out : out.subarray(0, filled);
}

async function readCentralDirectoryEntries(
  fileSystem: ChunkedFileSystem,
  archivePath: string,
  totalSize: number,
  chunkSize: number = streamChunkBytes,
): Promise<CentralDirectoryEntry[]> {
  if (!(totalSize > 0)) {
    throw new Error(
      `Archive file is empty (0 bytes read, native reports ${totalSize} bytes).`,
    );
  }

  const head = await readArchiveRange(fileSystem, archivePath, totalSize, 0, 4, chunkSize);
  if (head.length < 4) {
    throw new Error(
      `Archive file is empty (0 bytes read, native reports ${totalSize} bytes).`,
    );
  }
  if (!hasZipSignature(head)) {
    throw new Error(
      `Archive is not a valid zip file (${totalSize} bytes, unexpected header).`,
    );
  }

  const tailLength = Math.min(totalSize, 22 + 65535 + 4);
  const tail = await readArchiveRange(
    fileSystem,
    archivePath,
    totalSize,
    totalSize - tailLength,
    tailLength,
    chunkSize,
  );
  if (tail.length < tailLength) {
    throw new Error(
      `Archive appears truncated (${tail.length} of ${totalSize} bytes readable): ` +
        `the export may be incomplete — re-export it from the editor and try again.`,
    );
  }
  const { count, directorySize, directoryOffset } = parseEndOfCentralDirectory(tail, totalSize);

  if (count === 0) {
    return [];
  }

  const directoryBytes = await readArchiveRange(
    fileSystem,
    archivePath,
    totalSize,
    directoryOffset,
    directorySize,
    chunkSize,
  );
  if (directoryBytes.length < directorySize) {
    throw new Error(
      `Archive appears truncated (directory unreadable at ${directoryOffset} of ${totalSize} bytes): ` +
        `the export may be incomplete — re-export it from the editor and try again.`,
    );
  }
  return parseCentralDirectory(directoryBytes, count);
}

// Strict gate for the native extractor: unlike the legacy path (which
// normalizes names), tar must never see absolute paths, drive letters, or
// parent segments — it writes to disk verbatim.
function assertSafeNativeEntryName(name: string) {
  const normalized = posixPath(name);

  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:(\/|$)/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error('Archive contains invalid file paths.');
  }
}

async function streamArchiveEntries(
  outputDir: string,
  archivePath: string,
  fileSystem: ChunkedFileSystem,
  totalSize: number,
  chunkSize: number = streamChunkBytes,
): Promise<number> {
  // Fallback path when no native extractor exists: entry locations come
  // from the central directory, so each entry's exact byte range is read
  // and inflated directly without ever holding the whole zip in JS memory.
  const entries = await readCentralDirectoryEntries(fileSystem, archivePath, totalSize, chunkSize);

  let bytesRead = 0;

  for (const entry of entries) {
    const normalizedEntryPath = ensureSafeArchivePath(entry.name);
    if (entry.isDirectory) {
      await fileSystem.mkdir(`${outputDir}/${normalizedEntryPath}`);
      continue;
    }

    const entryOutputPath = `${outputDir}/${normalizedEntryPath}`;
    const entryDirectory = directoryName(normalizedEntryPath);
    if (entryDirectory.length > 0) {
      await fileSystem.mkdir(`${outputDir}/${entryDirectory}`);
    } else {
      await ensureParentDirectory(entryOutputPath);
    }

    // Data starts after the 30-byte local header plus its name/extra.
    const header = await readArchiveRange(
      fileSystem,
      archivePath,
      totalSize,
      entry.localHeaderOffset,
      30,
      chunkSize,
    );
    if (header.length < 30 || viewOf(header).getUint32(0, true) !== 0x04034b50) {
      throw new Error(`Archive entry has a bad local header (${entry.name}).`);
    }
    const headerView = viewOf(header);
    const dataStart =
      entry.localHeaderOffset + 30 + headerView.getUint16(26, true) + headerView.getUint16(28, true);
    if (dataStart + entry.compressedSize > totalSize) {
      throw new Error(
        `Archive entry extends past the end of the file (${entry.name}): ` +
          `the export may be incomplete — re-export it from the editor and try again.`,
      );
    }

    let entryBytes: Uint8Array;
    if (entry.method === 0) {
      entryBytes = await readArchiveRange(
        fileSystem,
        archivePath,
        totalSize,
        dataStart,
        entry.compressedSize,
        chunkSize,
      );
      if (entryBytes.length < entry.compressedSize) {
        throw new Error(
          `Archive entry ends early (${entry.name}, ${entryBytes.length} of ${entry.compressedSize} bytes): ` +
            `the export may be incomplete — re-export it from the editor and try again.`,
        );
      }
    } else if (entry.method === 8) {
      const inflater = new Inflate();
      const inflated: Uint8Array[] = [];
      // NB: sync Inflate.ondata is (data, final) — no error param (that is
      // the async flavor). Decode faults surface as push() throws.
      inflater.ondata = (data) => {
        inflated.push(data.slice());
      };
      let consumed = 0;
      let inflateError: unknown = null;
      while (consumed < entry.compressedSize) {
        const slice = await readArchiveRange(
          fileSystem,
          archivePath,
          totalSize,
          dataStart + consumed,
          Math.min(chunkSize, entry.compressedSize - consumed),
          chunkSize,
        );
        if (slice.length === 0) {
          throw new Error(
            `Archive entry ends early (${entry.name}, ${consumed} of ${entry.compressedSize} bytes): ` +
              `the export may be incomplete — re-export it from the editor and try again.`,
          );
        }
        consumed += slice.length;
        bytesRead += slice.length;
        try {
          inflater.push(slice, consumed >= entry.compressedSize);
        } catch (error) {
          inflateError = error;
          break;
        }
        // Yield so the blocking overlay paints during GB-scale imports.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (inflateError != null) {
        const detail = describeNativeRejection(inflateError);
        throw new Error(`Archive entry could not be decoded (${entry.name}): ${detail}`);
      }
      entryBytes = concatBytes(inflated);
      if (entryBytes.length !== entry.uncompressedSize) {
        throw new Error(
          `Archive entry size mismatch (${entry.name}, got ${entryBytes.length} of ${entry.uncompressedSize} bytes): ` +
            `the export may be corrupt — re-export it from the editor and try again.`,
        );
      }
    } else {
      throw new Error(
        `Archive entry uses unsupported compression (${entry.name}, method ${entry.method}).`,
      );
    }

    await fileSystem.writeFile(entryOutputPath, bytesToBase64(entryBytes), 'base64');
    // Yield every file so the blocking overlay paints during GB-scale imports.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return bytesRead;
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
    const detail = describeNativeRejection(error);
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
    const sized = fileSystem as WindowsFileSystemModule;
    const chunkedRead = fileSystem.readFileChunk;
    const sizeProbe = sized.getFileSize;
    if (typeof chunkedRead === 'function' && typeof sizeProbe === 'function') {
      // Windows GB-scale paths, picked by capability: native tar extraction
      // when available (bridge carries only KBs of directory reads),
      // otherwise JS streaming inflate (bridge carries every byte).
      // Both avoid the legacy full-file readFile, whose native base64
      // encode fails on GB-scale exports.
      let totalSize = -1;
      try {
        totalSize = sizeProbe(archivePath);
      } catch {
        totalSize = -1;
      }
      if (typeof totalSize === 'number' && totalSize >= 0) {
        const chunkedFileSystem: ChunkedFileSystem = { ...fileSystem, readFileChunk: chunkedRead };
        if (typeof sized.extractArchive === 'function') {
          // Fast path: entry names are validated over the bridge (KBs of
          // central directory), then the bytes are extracted on disk
          // natively — file contents never cross the bridge.
          const entries = await readCentralDirectoryEntries(
            chunkedFileSystem,
            archivePath,
            totalSize,
          );
          for (const entry of entries) {
            assertSafeNativeEntryName(entry.name);
          }
          try {
            await sized.extractArchive(archivePath, extractionDir);
          } catch (error) {
            const detail = describeNativeRejection(error);
            throw new Error(`Archive could not be extracted (${totalSize} bytes): ${detail}`);
          }
        } else {
          await streamArchiveEntries(
            extractionDir,
            archivePath,
            chunkedFileSystem,
            totalSize,
          );
        }

        const archiveDataDir = await findArchiveDataDir(extractionDir);
        if (archiveDataDir == null) {
          throw new Error('Archive must contain a banknotes.db file and an images directory.');
        }

        return await reader.readImportedDataset({
          databasePath: `${archiveDataDir}/banknotes.db`,
          imagesDirectoryPath: `${archiveDataDir}/images`,
        });
      }
    }

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
