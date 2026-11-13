export 'last_collection_store_stub.dart'
    if (dart.library.io) 'last_collection_store_io.dart';

/// The last collection the user had selected, for restoring it on startup.
///
/// Both parts are persisted because archive re-imports churn collection IDs
/// (collections are deleted and re-inserted by name): the ID wins when it
/// still exists, otherwise the name is matched case-insensitively.
///
/// [allCollections] records whether the Viewer was showing All notes, stored
/// beside the collection so the scope survives a restart. It defaults to
/// false, so files written before the flag existed still load.
class LastCollectionSelection {
  const LastCollectionSelection({
    this.collectionId,
    this.collectionName,
    this.allCollections = false,
  });

  final int? collectionId;
  final String? collectionName;
  final bool allCollections;

  bool get isEmpty =>
      !allCollections &&
      collectionId == null &&
      (collectionName == null || collectionName!.trim().isEmpty);

  /// Reads the stored shape. A missing or non-boolean [allCollections] means
  /// off, so state files written before the flag existed keep working.
  factory LastCollectionSelection.fromJson(Map<String, dynamic> json) {
    final rawId = json['lastCollectionId'];
    final rawName = json['lastCollectionName'];
    final id = rawId is num ? rawId.toInt() : null;
    final name = rawName == null ? null : '$rawName'.trim();
    return LastCollectionSelection(
      collectionId: id != null && id > 0 ? id : null,
      collectionName: name == null || name.isEmpty ? null : name,
      allCollections: json['allCollections'] == true,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'lastCollectionId': collectionId,
      'lastCollectionName': collectionName,
      'allCollections': allCollections,
    };
  }
}

/// Reads and writes the last selected collection.
///
/// The io implementation stores a small JSON file; the web stub is a no-op.
abstract class LastCollectionStore {
  Future<LastCollectionSelection?> load();

  Future<void> save(LastCollectionSelection selection);

  Future<void> clear();
}
