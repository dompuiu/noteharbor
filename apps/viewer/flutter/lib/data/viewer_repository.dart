import 'package:flutter/foundation.dart';

import '../models/archive_preview.dart';
import '../models/viewer_dataset.dart';
import 'imported_dataset_loader.dart';
import 'native_dataset_store.dart';

/// No archive has been imported yet. This is a first-run state, not a load
/// failure: the app opens Import instead of an error card.
class NoImportedDatasetException implements Exception {
  const NoImportedDatasetException();

  @override
  String toString() => 'No imported dataset is installed.';
}

class ViewerRepository {
  ViewerRepository({NativeDatasetStore? nativeDatasetStore})
      : _nativeDatasetStore = nativeDatasetStore ?? createNativeDatasetStore(),
        _importedDatasetLoader = createImportedDatasetLoader();

  final NativeDatasetStore _nativeDatasetStore;
  final ImportedDatasetLoader _importedDatasetLoader;

  bool get canManageImportedDatasets => !kIsWeb && _nativeDatasetStore.isSupported;

  Future<ViewerDataset> loadDataset() async {
    final importedLocation = await _nativeDatasetStore.getImportedDatasetLocation();
    if (importedLocation == null) {
      throw const NoImportedDatasetException();
    }

    return _importedDatasetLoader.load(importedLocation);
  }

  /// The installed archive's folder, or null when this build cannot manage
  /// imported datasets or none is installed.
  Future<String?> importedArchiveDirectory() async {
    if (!canManageImportedDatasets) {
      return null;
    }
    final importedLocation = await _nativeDatasetStore.getImportedDatasetLocation();
    return importedLocation?.rootPath;
  }

  Future<void> importArchive(String archivePath) {
    return _nativeDatasetStore.importArchive(archivePath);
  }

  Future<ArchivePreview?> peekArchive(String archivePath) {
    return _nativeDatasetStore.peekArchive(archivePath);
  }

  Future<void> deleteCollection(int collectionId, {String? collectionName}) {
    return _nativeDatasetStore.deleteCollection(collectionId, collectionName: collectionName);
  }

  Future<void> deleteImportedDataset() {
    return _nativeDatasetStore.deleteImportedDataset();
  }
}
