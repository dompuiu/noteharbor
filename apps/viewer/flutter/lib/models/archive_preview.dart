import 'viewer_collection.dart';

/// What an archive holds, read before it is imported.
///
/// Mirrors the metadata of a loaded dataset: when the archive's data was last
/// updated and one entry per collection with its note count. Collections are
/// identified by the id they carry inside the archive, not by any installed id.
class ArchivePreview {
  const ArchivePreview({
    required this.generatedAt,
    required this.collections,
  });

  final String? generatedAt;
  final List<ViewerCollection> collections;
}
