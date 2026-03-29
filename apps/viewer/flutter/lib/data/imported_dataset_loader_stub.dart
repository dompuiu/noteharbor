import '../models/viewer_dataset.dart';
import 'native_dataset_store.dart';

class ImportedDatasetLoader {
  const ImportedDatasetLoader();

  Future<ViewerDataset> load(ImportedDatasetLocation location) async {
    throw UnsupportedError('Imported datasets are only available on native builds.');
  }
}

ImportedDatasetLoader createPlatformImportedDatasetLoader() {
  return const ImportedDatasetLoader();
}
