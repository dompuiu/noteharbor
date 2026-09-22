import { zipSync, strToU8 } from 'fflate';
import RNFS from 'react-native-fs';

import { FilesystemLocalArchiveImporter } from './localArchiveImporter';

jest.mock('./nativeImportedDatasetReader', () => ({
  nativeImportedDatasetReader: {
    readImportedDataset: jest.fn(),
  },
}));

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const { nativeImportedDatasetReader } = jest.requireMock('./nativeImportedDatasetReader') as {
  nativeImportedDatasetReader: {
    readImportedDataset: jest.Mock;
  };
};

function resetFsMocks() {
  mockedRNFS.exists.mockReset();
  mockedRNFS.mkdir.mockReset();
  mockedRNFS.readDir.mockReset();
  mockedRNFS.readFile.mockReset();
  mockedRNFS.unlink.mockReset();
  mockedRNFS.writeFile.mockReset();
  nativeImportedDatasetReader.readImportedDataset.mockReset();
}

beforeEach(() => {
  resetFsMocks();
  mockedRNFS.exists.mockImplementation((path: string) => {
    const normalized = String(path);
    return Promise.resolve(
      normalized === '/tmp/archive.zip' ||
        normalized.includes('/imports/import-') && normalized.endsWith('/nested/data/banknotes.db') ||
        normalized.includes('/imports/import-') && normalized.endsWith('/nested/data/images'),
    );
  });
  mockedRNFS.mkdir.mockResolvedValue(undefined as never);
  mockedRNFS.readDir.mockImplementation((path: string) => {
    const normalized = String(path);

    if (/\/imports\/import-[^/]+$/.test(normalized)) {
      return Promise.resolve([
        {
          isDirectory: () => true,
          path: `${normalized}/nested`,
        },
      ] as never);
    }

    if (normalized.endsWith('/nested')) {
      return Promise.resolve([
        {
          isDirectory: () => true,
          path: `${normalized}/data`,
        },
      ] as never);
    }

    return Promise.resolve([] as never);
  });
  mockedRNFS.unlink.mockResolvedValue(undefined as never);
  mockedRNFS.writeFile.mockResolvedValue(undefined as never);
});

test('extracts archive contents and delegates dataset reading to native reader', async () => {
  const importer = new FilesystemLocalArchiveImporter();
  const archiveBytes = zipSync({
    'nested/data/banknotes.db': strToU8('sqlite'),
    'nested/data/images/notes/1/front.jpg': strToU8('image'),
  });
  mockedRNFS.readFile.mockResolvedValue(Buffer.from(archiveBytes).toString('base64') as never);
  nativeImportedDatasetReader.readImportedDataset.mockResolvedValue({
    source: 'imported',
    collections: [],
    notes: [],
  });

  const snapshot = await importer.importArchive('/tmp/archive.zip');

  expect(nativeImportedDatasetReader.readImportedDataset).toHaveBeenCalledWith(
    expect.objectContaining({
      databasePath: expect.stringContaining('/nested/data/banknotes.db'),
      imagesDirectoryPath: expect.stringContaining('/nested/data/images'),
    }),
  );
  expect(mockedRNFS.writeFile).toHaveBeenCalled();
  expect(snapshot.source).toBe('imported');
});

test('uses the Windows filesystem module when running on windows', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn((path: string) => {
      const normalized = String(path);
      return Promise.resolve(
        normalized === 'C:\\tmp\\a.zip' ||
          normalized === 'C:/tmp/a.zip' ||
          (normalized.includes('/imports/import-') &&
            normalized.endsWith('/nested/data/banknotes.db')) ||
          (normalized.includes('/imports/import-') &&
            normalized.endsWith('/nested/data/images')),
      );
    }),
    mkdir: jest.fn(() => Promise.resolve()),
    readDir: jest.fn((path: string) => {
      const normalized = String(path);
      if (/\/imports\/import-[^/]+$/.test(normalized)) {
        return Promise.resolve([{ isDirectory: () => true, path: `${normalized}/nested` }]);
      }
      if (normalized.endsWith('/nested')) {
        return Promise.resolve([{ isDirectory: () => true, path: `${normalized}/data` }]);
      }
      return Promise.resolve([]);
    }),
    readFile: jest.fn(() =>
      Promise.resolve(Buffer.from(archiveBytesForWindows()).toString('base64')),
    ),
    unlink: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
  };
  reactNative.Platform.OS = 'windows';
  reactNative.NativeModules.NoteHarborFileSystem = windowsFs;
  try {
    const importer = new FilesystemLocalArchiveImporter();
    nativeImportedDatasetReader.readImportedDataset.mockResolvedValue({
      source: 'imported',
      collections: [],
      notes: [],
    });

    const snapshot = await importer.importArchive('C:\\tmp\\a.zip');

    expect(windowsFs.readFile).toHaveBeenCalled();
    expect(windowsFs.writeFile).toHaveBeenCalled();
    expect(nativeImportedDatasetReader.readImportedDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        databasePath: expect.stringContaining('/nested/data/banknotes.db'),
      }),
    );
    expect(snapshot.source).toBe('imported');
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

function archiveBytesForWindows() {
  return zipSync({
    'nested/data/banknotes.db': strToU8('sqlite'),
    'nested/data/images/notes/1/front.jpg': strToU8('image'),
  });
}

test('falls back to the sync path method when the constant is empty', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const windowsFs = {
    DocumentDirectoryPath: '',
    getDocumentDirectoryPath: jest.fn(() => 'C:/mock/documents'),
    exists: jest.fn((path: string) => {
      const normalized = String(path);
      return Promise.resolve(
        normalized === 'C:\\tmp\\a.zip' ||
          (normalized.includes('/imports/import-') &&
            normalized.endsWith('/nested/data/banknotes.db')) ||
          (normalized.includes('/imports/import-') &&
            normalized.endsWith('/nested/data/images')),
      );
    }),
    mkdir: jest.fn(() => Promise.resolve()),
    readDir: jest.fn((path: string) => {
      const normalized = String(path);
      if (/\/imports\/import-[^/]+$/.test(normalized)) {
        return Promise.resolve([{ isDirectory: () => true, path: `${normalized}/nested` }]);
      }
      if (normalized.endsWith('/nested')) {
        return Promise.resolve([{ isDirectory: () => true, path: `${normalized}/data` }]);
      }
      return Promise.resolve([]);
    }),
    readFile: jest.fn(() =>
      Promise.resolve(Buffer.from(archiveBytesForWindows()).toString('base64')),
    ),
    unlink: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
  };
  reactNative.Platform.OS = 'windows';
  reactNative.NativeModules.NoteHarborFileSystem = windowsFs;
  try {
    const importer = new FilesystemLocalArchiveImporter();
    nativeImportedDatasetReader.readImportedDataset.mockResolvedValue({
      source: 'imported',
      collections: [],
      notes: [],
    });

    const snapshot = await importer.importArchive('C:\\tmp\\a.zip');

    expect(windowsFs.getDocumentDirectoryPath).toHaveBeenCalled();
    expect(snapshot.source).toBe('imported');
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('rejects empty archive reads with a byte count', async () => {
  const importer = new FilesystemLocalArchiveImporter();
  mockedRNFS.readFile.mockResolvedValue('' as never);

  await expect(importer.importArchive('/tmp/archive.zip')).rejects.toThrow(
    '0 bytes read',
  );
});

test('rejects non-zip payloads by signature', async () => {
  const importer = new FilesystemLocalArchiveImporter();
  mockedRNFS.readFile.mockResolvedValue(
    Buffer.from('hello, not a zip').toString('base64') as never,
  );

  await expect(importer.importArchive('/tmp/archive.zip')).rejects.toThrow(
    'not a valid zip file',
  );
});

test('reports the byte count when unzip fails', async () => {
  const importer = new FilesystemLocalArchiveImporter();
  const full = zipSync({ 'nested/data/banknotes.db': strToU8('sqlite') });
  const truncated = Buffer.from(full).subarray(0, Math.floor(full.length / 2));
  mockedRNFS.readFile.mockResolvedValue(truncated.toString('base64') as never);

  await expect(importer.importArchive('/tmp/archive.zip')).rejects.toThrow(
    new RegExp(`could not be unzipped \\(${truncated.length} bytes read\\)`),
  );
});

test('reports the native file size when the read comes back empty', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    getFileSize: jest.fn(() => 12345),
    exists: jest.fn(() => Promise.resolve(true)),
    mkdir: jest.fn(() => Promise.resolve()),
    readDir: jest.fn(() => Promise.resolve([])),
    readFile: jest.fn(() => Promise.resolve('')),
    unlink: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
  };
  reactNative.Platform.OS = 'windows';
  reactNative.NativeModules.NoteHarborFileSystem = windowsFs;
  try {
    const importer = new FilesystemLocalArchiveImporter();
    await expect(importer.importArchive('C:\\tmp\\a.zip')).rejects.toThrow(
      '0 bytes read, native reports 12345 bytes',
    );
    expect(windowsFs.getFileSize).toHaveBeenCalledWith('C:\\tmp\\a.zip');
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('rejects archives with missing dataset payload', async () => {
  const importer = new FilesystemLocalArchiveImporter();
  const archiveBytes = zipSync({
    'nested/readme.txt': strToU8('hello'),
  });
  mockedRNFS.readFile.mockResolvedValue(Buffer.from(archiveBytes).toString('base64') as never);
  mockedRNFS.exists.mockImplementation((path: string) => {
    const normalized = String(path);
    return Promise.resolve(normalized === '/tmp/archive.zip');
  });
  mockedRNFS.readDir.mockImplementation((path: string) => {
    const normalized = String(path);

    if (normalized.endsWith('/archive')) {
      return Promise.resolve([
        {
          isDirectory: () => true,
          path: `${normalized}/nested`,
        },
      ] as never);
    }

    if (normalized.endsWith('/nested')) {
      return Promise.resolve([] as never);
    }

    return Promise.resolve([] as never);
  });

  await expect(importer.importArchive('/tmp/archive.zip')).rejects.toThrow(
    'Archive must contain a banknotes.db file and an images directory.',
  );
});
