import 'last_collection_store.dart';

LastCollectionStore createLastCollectionStore() {
  return const _NoopLastCollectionStore();
}

/// Web has no file-backed selection to remember, so the store is a no-op.
class _NoopLastCollectionStore implements LastCollectionStore {
  const _NoopLastCollectionStore();

  @override
  Future<LastCollectionSelection?> load() async => null;

  @override
  Future<void> save(LastCollectionSelection selection) async {}

  @override
  Future<void> clear() async {}
}
