import { zipSync, strToU8, unzipSync } from 'fflate';
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

test('streams large archives on Windows via chunked reads instead of one base64 blob', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const full = Buffer.from(
    zipSync({
      'nested/data/banknotes.db': strToU8('sqlite'),
      'nested/data/images/notes/1/front.jpg': strToU8('image-bytes'),
    }),
  );
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn((path: string) => {
      const normalized = String(path);
      return Promise.resolve(
        normalized === 'C:\\tmp\\big.zip' ||
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
    readFile: jest.fn(() => Promise.reject(new Error('must not read whole file'))),
    readFileChunk: jest.fn((path: string, offset: number, length: number) =>
      Promise.resolve(full.subarray(offset, offset + length).toString('base64')),
    ),
    getFileSize: jest.fn(() => full.length),
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

    const snapshot = await importer.importArchive('C:\\tmp\\big.zip');

    expect(snapshot.source).toBe('imported');
    expect(windowsFs.getFileSize).toHaveBeenCalledWith('C:\\tmp\\big.zip');
    expect(windowsFs.readFileChunk).toHaveBeenCalled();
    expect(windowsFs.readFile).not.toHaveBeenCalled();
    expect(windowsFs.writeFile).toHaveBeenCalled();
    expect(nativeImportedDatasetReader.readImportedDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        databasePath: expect.stringContaining('/nested/data/banknotes.db'),
        imagesDirectoryPath: expect.stringContaining('/nested/data/images'),
      }),
    );
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('streams multi-chunk archives on Windows without loading the whole file', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  // Incompressible payload (xorshift PRNG) so the zip stays above one 4MB chunk.
  const bigImage = new Uint8Array(4_600_000);
  let prng = 0x12345678;
  for (let i = 0; i < bigImage.length; i += 1) {
    prng ^= prng << 13;
    prng ^= prng >>> 17;
    prng ^= prng << 5;
    bigImage[i] = prng & 0xff;
  }
  const full = Buffer.from(
    zipSync({
      'nested/data/banknotes.db': strToU8('sqlite'),
      'nested/data/images/notes/1/front.jpg': bigImage,
    }),
  );
  expect(full.length).toBeGreaterThan(4 * 1024 * 1024);
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn((path: string) => {
      const normalized = String(path);
      return Promise.resolve(
        normalized === 'C:\\tmp\\huge.zip' ||
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
    readFile: jest.fn(() => Promise.reject(new Error('must not read whole file'))),
    readFileChunk: jest.fn((path: string, offset: number, length: number) =>
      Promise.resolve(full.subarray(offset, offset + length).toString('base64')),
    ),
    getFileSize: jest.fn(() => full.length),
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

    const snapshot = await importer.importArchive('C:\\tmp\\huge.zip');

    expect(snapshot.source).toBe('imported');
    expect(windowsFs.readFileChunk.mock.calls.length).toBeGreaterThan(1);
    expect(windowsFs.readFile).not.toHaveBeenCalled();
    const writeCalls = windowsFs.writeFile.mock.calls as unknown[][];
    const writtenFront = writeCalls.find((call) =>
      String(call[0]).endsWith('/nested/data/images/notes/1/front.jpg'),
    );
    expect(writtenFront).toBeDefined();
    expect(
      Buffer.from(String(writtenFront?.[1]), 'base64').equals(Buffer.from(bigImage)),
    ).toBe(true);
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('extracts entries whose compressed bytes mimic a data descriptor (PK\\x07\\x08)', async () => {
  // Regression: signature-scanning streaming parsers truncate an entry at
  // the first PK\x07\x08-like bytes (~1-in-4-billion per window, expected
  // somewhere in GBs of deflated JPEGs). Central-directory sizes are immune.
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  let prng = 0x87654321;
  const bigImage = new Uint8Array(200_000);
  for (let i = 0; i < bigImage.length; i += 1) {
    prng ^= prng << 13;
    prng ^= prng >>> 17;
    prng ^= prng << 5;
    bigImage[i] = prng & 0xff;
  }
  const full = Buffer.from(
    zipSync({
      'nested/data/banknotes.db': strToU8('sqlite'),
      'nested/data/images/notes/1/front.jpg': bigImage,
    }),
  );
  // Land inside front.jpg's compressed data (db entry + headers are tiny,
  // front.jpg is ~200KB of incompressible bytes).
  const poisonAt = 100_000;
  full[poisonAt] = 0x50;
  full[poisonAt + 1] = 0x4b;
  full[poisonAt + 2] = 0x07;
  full[poisonAt + 3] = 0x08;
  // Trap is armed: the signature occurs in the raw zip bytes...
  expect(full.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]))).toBeGreaterThanOrEqual(0);
  // ...yet central-directory readers are unaffected.
  const expected = unzipSync(new Uint8Array(full)) as unknown as Record<string, Uint8Array>;
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn((path: string) => {
      const normalized = String(path);
      return Promise.resolve(
        normalized === 'C:\\tmp\\poison.zip' ||
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
    readFile: jest.fn(() => Promise.reject(new Error('must not read whole file'))),
    readFileChunk: jest.fn((path: string, offset: number, length: number) =>
      Promise.resolve(full.subarray(offset, offset + length).toString('base64')),
    ),
    getFileSize: jest.fn(() => full.length),
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

    const snapshot = await importer.importArchive('C:\\tmp\\poison.zip');

    expect(snapshot.source).toBe('imported');
    expect(windowsFs.readFile).not.toHaveBeenCalled();
    const writeCalls = windowsFs.writeFile.mock.calls as unknown[][];
    const writtenDb = writeCalls.find((call) =>
      String(call[0]).endsWith('/nested/data/banknotes.db'),
    );
    expect(Buffer.from(String(writtenDb?.[1]), 'base64').toString()).toBe('sqlite');
    const writtenFront = writeCalls.find((call) =>
      String(call[0]).endsWith('/nested/data/images/notes/1/front.jpg'),
    );
    const frontBytes = Buffer.from(String(writtenFront?.[1]), 'base64');
    expect(frontBytes.equals(Buffer.from(expected['nested/data/images/notes/1/front.jpg']))).toBe(true);
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('extracts natively on Windows without moving file contents over the bridge', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const full = Buffer.from(
    zipSync({
      'nested/data/banknotes.db': strToU8('sqlite'),
      'nested/data/images/notes/1/front.jpg': strToU8('image-bytes'),
    }),
  );
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn((path: string) => {
      const normalized = String(path);
      return Promise.resolve(
        normalized === 'C:\\tmp\\native.zip' ||
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
    readFile: jest.fn(() => Promise.reject(new Error('must not read whole file'))),
    readFileChunk: jest.fn((path: string, offset: number, length: number) =>
      Promise.resolve(full.subarray(offset, offset + length).toString('base64')),
    ),
    getFileSize: jest.fn(() => full.length),
    extractArchive: jest.fn(() => Promise.resolve()),
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

    const snapshot = await importer.importArchive('C:\\tmp\\native.zip');

    expect(snapshot.source).toBe('imported');
    expect(windowsFs.extractArchive).toHaveBeenCalledWith(
      'C:\\tmp\\native.zip',
      expect.stringContaining('/imports/import-'),
    );
    expect(windowsFs.readFile).not.toHaveBeenCalled();
    expect(windowsFs.writeFile).not.toHaveBeenCalled();
    expect(nativeImportedDatasetReader.readImportedDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        databasePath: expect.stringContaining('/nested/data/banknotes.db'),
        imagesDirectoryPath: expect.stringContaining('/nested/data/images'),
      }),
    );
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('surfaces object-shaped native extraction failures instead of [object Object]', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const full = Buffer.from(
    zipSync({
      'nested/data/banknotes.db': strToU8('sqlite'),
      'nested/data/images/notes/1/front.jpg': strToU8('image-bytes'),
    }),
  );
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn(() => Promise.resolve(true)),
    mkdir: jest.fn(() => Promise.resolve()),
    readDir: jest.fn(() => Promise.resolve([])),
    readFileChunk: jest.fn((path: string, offset: number, length: number) =>
      Promise.resolve(full.subarray(offset, offset + length).toString('base64')),
    ),
    getFileSize: jest.fn(() => full.length),
    // React Native Windows rejects with plain {code, message} objects,
    // not Error instances.
    extractArchive: jest.fn(() =>
      Promise.reject({ code: 'EUNSPECIFIED', message: 'Unable to extract archive (tar exited 1). boom' }),
    ),
    unlink: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
  };
  reactNative.Platform.OS = 'windows';
  reactNative.NativeModules.NoteHarborFileSystem = windowsFs;
  try {
    const importer = new FilesystemLocalArchiveImporter();
    await expect(importer.importArchive('C:\\tmp\\native.zip')).rejects.toThrow(
      'Unable to extract archive (tar exited 1). boom',
    );
    await expect(importer.importArchive('C:\\tmp\\native.zip')).rejects.not.toThrow(
      '[object Object]',
    );
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('refuses unsafe entry names before native extraction', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const full = Buffer.from(
    zipSync({
      '../evil.txt': strToU8('escape'),
      'nested/data/banknotes.db': strToU8('sqlite'),
      'nested/data/images/notes/1/front.jpg': strToU8('image-bytes'),
    }),
  );
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn(() => Promise.resolve(true)),
    mkdir: jest.fn(() => Promise.resolve()),
    readDir: jest.fn(() => Promise.resolve([])),
    readFileChunk: jest.fn((path: string, offset: number, length: number) =>
      Promise.resolve(full.subarray(offset, offset + length).toString('base64')),
    ),
    getFileSize: jest.fn(() => full.length),
    extractArchive: jest.fn(() => Promise.resolve()),
    unlink: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
  };
  reactNative.Platform.OS = 'windows';
  reactNative.NativeModules.NoteHarborFileSystem = windowsFs;
  try {
    const importer = new FilesystemLocalArchiveImporter();
    await expect(importer.importArchive('C:\\tmp\\evil.zip')).rejects.toThrow(
      'Archive contains invalid file paths.',
    );
    expect(windowsFs.extractArchive).not.toHaveBeenCalled();
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

test('reports truncation with byte counts instead of a raw unexpected EOF', async () => {
  const reactNative = require('react-native') as {
    Platform: { OS: string };
    NativeModules: Record<string, unknown>;
  };
  const previousOS = reactNative.Platform.OS;
  const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
  const full = Buffer.from(
    zipSync({
      'nested/data/banknotes.db': strToU8('sqlite'),
      'nested/data/images/notes/1/front.jpg': strToU8('image-bytes'),
    }),
  );
  const windowsFs = {
    DocumentDirectoryPath: 'C:/mock/documents',
    exists: jest.fn(() => Promise.resolve(true)),
    mkdir: jest.fn(() => Promise.resolve()),
    readDir: jest.fn(() => Promise.resolve([])),
    readFileChunk: jest.fn((path: string, offset: number, length: number) =>
      Promise.resolve(full.subarray(offset, offset + length).toString('base64')),
    ),
    // Overstated probe: slices run dry before the promised size.
    getFileSize: jest.fn(() => full.length + 500),
    unlink: jest.fn(() => Promise.resolve()),
    writeFile: jest.fn(() => Promise.resolve()),
  };
  reactNative.Platform.OS = 'windows';
  reactNative.NativeModules.NoteHarborFileSystem = windowsFs;
  try {
    const importer = new FilesystemLocalArchiveImporter();
    await expect(importer.importArchive('C:\\tmp\\cut.zip')).rejects.toThrow(
      /truncated.*of .* bytes read/,
    );
  } finally {
    reactNative.Platform.OS = previousOS;
    if (previousWindowsFs === undefined) {
      delete reactNative.NativeModules.NoteHarborFileSystem;
    } else {
      reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
    }
  }
});

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
