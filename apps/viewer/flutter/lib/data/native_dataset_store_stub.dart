class ImportedDatasetLocation {
  const ImportedDatasetLocation({
    required this.rootPath,
    required this.databasePath,
    required this.imagesDirectoryPath,
  });

  final String rootPath;
  final String databasePath;
  final String imagesDirectoryPath;
}

class NativeDatasetStore {
  const NativeDatasetStore();

  bool get isSupported => false;

  Future<ImportedDatasetLocation?> getImportedDatasetLocation() async => null;

  Future<void> importArchive(String archivePath) async {
    throw UnsupportedError('Archive import is only available on native builds.');
  }

  Future<void> deleteImportedDataset() async {}
}

NativeDatasetStore createPlatformNativeDatasetStore() {
  return const NativeDatasetStore();
}
