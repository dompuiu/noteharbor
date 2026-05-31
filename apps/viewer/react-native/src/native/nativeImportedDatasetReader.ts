import type { LocalDatasetSnapshot } from './localDatasetStorage';

export interface NativeImportedDatasetLocation {
  databasePath: string;
  imagesDirectoryPath: string;
}

export interface NativeImportedDatasetReader {
  readImportedDataset(location: NativeImportedDatasetLocation): Promise<LocalDatasetSnapshot>;
}

type NativeImportedDatasetReaderModule = {
  readImportedDataset(location: NativeImportedDatasetLocation): Promise<LocalDatasetSnapshot>;
};

function resolveNativeModule(): NativeImportedDatasetReaderModule {
  let reactNative: {
    NativeModules?: Record<string, unknown>;
    Platform?: { OS?: string };
  };

  try {
    reactNative = require('react-native');
  } catch {
    if (typeof jest !== 'undefined') {
      return {
        readImportedDataset: () =>
          Promise.reject(new Error('Native dataset reader is not available.')),
      };
    }

    throw new Error('React Native runtime is not available.');
  }

  const nativeModule = reactNative.NativeModules?.NoteHarborImportedDatasetReader as
    | NativeImportedDatasetReaderModule
    | undefined;

  if (nativeModule) {
    return nativeModule;
  }

  if (typeof jest !== 'undefined') {
    return {
      readImportedDataset: () =>
        Promise.reject(new Error('Native dataset reader is not available.')),
    };
  }

  throw new Error(
    `Native imported dataset reader is not available on ${reactNative.Platform?.OS ?? 'unknown'}.`,
  );
}

export const nativeImportedDatasetReader: NativeImportedDatasetReader = {
  readImportedDataset(location) {
    return resolveNativeModule().readImportedDataset(location);
  },
};
