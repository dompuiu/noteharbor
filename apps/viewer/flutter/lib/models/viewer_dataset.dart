import 'dataset_source.dart';
import 'note_record.dart';
import 'viewer_collection.dart';

class ViewerDataset {
  const ViewerDataset({
    required this.generatedAt,
    required this.noteCount,
    required this.notes,
    required this.collections,
    required this.source,
  });

  final String? generatedAt;
  final int noteCount;
  final List<NoteRecord> notes;
  final List<ViewerCollection> collections;
  final DatasetSource source;

  factory ViewerDataset.fromJson(Map<String, dynamic> json) {
    final notes = (json['notes'] as List<dynamic>? ?? <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .map(NoteRecord.fromJson)
        .toList(growable: false);

    final collections = (json['collections'] as List<dynamic>? ?? <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .map(ViewerCollection.fromJson)
        .toList(growable: false);

    return ViewerDataset(
      generatedAt: json['generatedAt'] == null ? null : '${json['generatedAt']}',
      noteCount: (json['noteCount'] as num?)?.toInt() ?? notes.length,
      notes: notes,
      collections: collections,
      source: json['source'] == 'imported'
          ? DatasetSource.imported
          : DatasetSource.bundled,
    );
  }
}
