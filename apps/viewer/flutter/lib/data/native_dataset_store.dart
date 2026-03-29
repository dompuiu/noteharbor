import 'native_dataset_store_stub.dart'
    if (dart.library.io) 'native_dataset_store_io.dart';

export 'native_dataset_store_stub.dart'
    if (dart.library.io) 'native_dataset_store_io.dart';

NativeDatasetStore createNativeDatasetStore() => createPlatformNativeDatasetStore();
