export 'last_collection_store_stub.dart'
    if (dart.library.io) 'last_collection_store_io.dart';

/// The last collection the user had selected, for restoring it on startup.
///
/// Both parts are persisted because archive re-imports churn collection IDs
/// (collections are deleted and re-inserted by name): the ID wins when it
/// still exists, otherwise the name is matched case-insensitively.
class LastCollectionSelection {
  const LastCollectionSelection({this.collectionId, this.collectionName});

  final int? collectionId;
  final String? collectionName;

  bool get isEmpty => collectionId == null && (collectionName == null || collectionName!.trim().isEmpty);
}

/// Reads and writes the last selected collection.
///
/// The io implementation stores a small JSON file; the web stub is a no-op.
abstract class LastCollectionStore {
  Future<LastCollectionSelection?> load();

  Future<void> save(LastCollectionSelection selection);

  Future<void> clear();
}
