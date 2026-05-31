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
