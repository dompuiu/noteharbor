export interface ArchivePickResult {
  archivePath: string;
  name: string | null;
}

interface PickerResult {
  uri: string;
  name: string | null;
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

export function isArchivePickerAvailable(platform: string = currentPlatform()) {
  return platform === 'windows' || platform === 'ios' || platform === 'macos' || platform === 'android';
}

function loadWindowsPickerModule() {
  const reactNative = require('react-native') as {
    NativeModules?: {
      NoteHarborArchivePicker?: {
        pickArchiveFile: () => Promise<ArchivePickResult | null>;
      };
    };
  };
  const nativeModule = reactNative.NativeModules?.NoteHarborArchivePicker;
  if (!nativeModule) {
    throw new Error('Windows archive picker is not available.');
  }
  return nativeModule;
}

function loadPickerModule() {
  return require('@react-native-documents/picker') as {
    pick: (options: unknown) => Promise<PickerResult[]>;
    types: { zip: string };
    isErrorWithCode: (error: unknown) => error is { code: string };
    errorCodes: { OPERATION_CANCELED: string };
  };
}

export async function pickArchiveFile(
  deps: {
    platform?: string;
    pick?: (options: unknown) => Promise<PickerResult[]>;
    zipType?: string;
    isCancel?: (error: unknown) => boolean;
    windowsPick?: () => Promise<ArchivePickResult | null>;
  } = {},
): Promise<ArchivePickResult | null> {
  const platform = deps.platform ?? currentPlatform();
  if (platform === 'windows') {
    const windowsPick =
      deps.windowsPick ?? (() => loadWindowsPickerModule().pickArchiveFile());
    return windowsPick();
  }
  if (!isArchivePickerAvailable(platform)) {
    return null;
  }

  // Each default lazily requires the real module so injected fakes never
  // trigger a native-module load (keeps unit tests hermetic).
  const pick =
    deps.pick ?? ((options: unknown) => loadPickerModule().pick(options));
  const zipType = deps.zipType ?? loadPickerModule().types.zip;
  const isCancel =
    deps.isCancel ??
    ((error: unknown) => {
      const picker = loadPickerModule();
      return (
        picker.isErrorWithCode(error) &&
        error.code === picker.errorCodes.OPERATION_CANCELED
      );
    });

  let results: PickerResult[];
  try {
    results = await pick({ type: [zipType] });
  } catch (error) {
    return isCancel(error) ? null : Promise.reject(error);
  }

  const [first] = results ?? [];
  if (!first) {
    return null;
  }

  return {
    archivePath: decodeURIComponent(first.uri.replace(/^file:\/\//, '')),
    name: first.name,
  };
}
