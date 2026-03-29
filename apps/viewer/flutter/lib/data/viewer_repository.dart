import 'package:flutter/foundation.dart';

import '../models/viewer_dataset.dart';
import 'imported_dataset_loader.dart';
import 'native_dataset_store.dart';

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
      throw StateError('No imported dataset is installed.');
    }

    return _importedDatasetLoader.load(importedLocation);
  }

  Future<void> importArchive(String archivePath) {
    return _nativeDatasetStore.importArchive(archivePath);
  }

  Future<void> deleteImportedDataset() {
    return _nativeDatasetStore.deleteImportedDataset();
  }
}
