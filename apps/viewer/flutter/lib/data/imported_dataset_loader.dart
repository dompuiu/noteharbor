import 'imported_dataset_loader_stub.dart'
    if (dart.library.io) 'imported_dataset_loader_io.dart';

export 'imported_dataset_loader_stub.dart'
    if (dart.library.io) 'imported_dataset_loader_io.dart';

ImportedDatasetLoader createImportedDatasetLoader() =>
    createPlatformImportedDatasetLoader();
