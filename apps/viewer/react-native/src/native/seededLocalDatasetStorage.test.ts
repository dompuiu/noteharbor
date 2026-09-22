import { SeededLocalDatasetStorage } from './seededLocalDatasetStorage';

describe('seeded local dataset storage on windows', () => {
  it('persists snapshots to the Windows filesystem instead of memory only', async () => {
    const reactNative = require('react-native') as {
      Platform: { OS: string };
      NativeModules: Record<string, unknown>;
    };
    const previousOS = reactNative.Platform.OS;
    const previousWindowsFs = reactNative.NativeModules.NoteHarborFileSystem;
    const files = new Map<string, string>();
    const windowsFs = {
      DocumentDirectoryPath: 'C:/mock/documents',
      exists: jest.fn((path: string) => Promise.resolve(files.has(String(path)))),
      mkdir: jest.fn(() => Promise.resolve()),
      readFile: jest.fn((path: string) => Promise.resolve(files.get(String(path)) ?? '')),
      unlink: jest.fn((path: string) => {
        files.delete(String(path));
        return Promise.resolve();
      }),
      writeFile: jest.fn((path: string, contents: string) => {
        files.set(String(path), String(contents));
        return Promise.resolve();
      }),
    };
    reactNative.Platform.OS = 'windows';
    reactNative.NativeModules.NoteHarborFileSystem = windowsFs;
    try {
      const storage = new SeededLocalDatasetStorage();
      await storage.writeImportedDataset({
        generatedAt: '2026-06-01T00:00:00.000Z',
        notes: [],
        collections: [{ id: 1, name: 'Default', noteCount: 0, isDefault: true }],
        source: 'imported',
      });

      expect(windowsFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('dataset.json'),
        expect.stringContaining('Default'),
        'utf8',
      );

      const fresh = new SeededLocalDatasetStorage();
      const snapshot = await fresh.readImportedDataset();
      expect(snapshot?.collections?.[0]).toMatchObject({ name: 'Default' });
    } finally {
      reactNative.Platform.OS = previousOS;
      if (previousWindowsFs === undefined) {
        delete reactNative.NativeModules.NoteHarborFileSystem;
      } else {
        reactNative.NativeModules.NoteHarborFileSystem = previousWindowsFs;
      }
    }
  });
});
