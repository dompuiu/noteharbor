import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

import '../models/dataset_source.dart';
import '../models/note_record.dart';
import '../models/tag.dart';
import '../models/viewer_dataset.dart';
import 'native_dataset_store.dart';

class ImportedDatasetLoader {
  const ImportedDatasetLoader();

  Future<ViewerDataset> load(ImportedDatasetLocation location) async {
    final database = sqlite3.open(location.databasePath);

    try {
      final tagMap = <int, List<Tag>>{};
      final tagRows = database.select('''
        SELECT bt.banknote_id, t.id, t.name
        FROM banknote_tags bt
        INNER JOIN tags t ON t.id = bt.tag_id
        ORDER BY t.name COLLATE NOCASE ASC
      ''');
      for (final row in tagRows) {
        final banknoteId = (row['banknote_id'] as int?) ?? 0;
        tagMap.putIfAbsent(banknoteId, () => <Tag>[]).add(
              Tag(
                id: (row['id'] as int?) ?? 0,
                name: _stringValue(row['name']),
              ),
            );
      }

      final noteRows = database.select('''
        SELECT
          id,
          display_order,
          denomination,
          issue_date,
          catalog_number,
          grading_company,
          grade,
          watermark,
          serial,
          url,
          notes,
          scraped_data,
          images,
          scrape_status,
          scrape_error,
          created_at,
          updated_at
        FROM banknotes
        ORDER BY display_order ASC, id ASC
      ''');

      final notes = <NoteRecord>[];
      for (var index = 0; index < noteRows.length; index += 1) {
        final row = noteRows[index];
        final noteId = (row['id'] as int?) ?? 0;
        final parsedImages = _parseJsonList(row['images']);
        final images = parsedImages
            .whereType<Map<String, dynamic>>()
            .map((image) => _mapImportedImage(image, location.imagesDirectoryPath))
            .whereType<Map<String, dynamic>>()
            .toList(growable: false);

        notes.add(
          NoteRecord.fromJson({
            'id': noteId,
            'displayOrder': (row['display_order'] as int?) ?? (index + 1),
            'denomination': _stringValue(row['denomination']),
            'issueDate': _stringValue(row['issue_date']),
            'catalogNumber': _stringValue(row['catalog_number']),
            'gradingCompany': _stringValue(row['grading_company']),
            'grade': _stringValue(row['grade']),
            'watermark': _stringValue(row['watermark']),
            'serial': _stringValue(row['serial']),
            'url': _stringValue(row['url']),
            'notes': _stringValue(row['notes']),
            'scrapeStatus': _stringValue(row['scrape_status']),
            'scrapeError': _stringValue(row['scrape_error']),
            'scrapedData': _parseJsonValue(row['scraped_data']),
            'tags': tagMap[noteId]
                    ?.map((tag) => {'id': tag.id, 'name': tag.name})
                    .toList(growable: false) ??
                <Map<String, dynamic>>[],
            'images': images,
          }),
        );
      }

      return ViewerDataset(
        generatedAt: _datasetTimestamp(location) ?? _latestUpdatedAt(noteRows),
        noteCount: notes.length,
        notes: notes,
        source: DatasetSource.imported,
      );
    } finally {
      database.dispose();
    }
  }
}

String? _datasetTimestamp(ImportedDatasetLocation location) {
  final file = File(location.databasePath);
  if (!file.existsSync()) {
    return null;
  }
  return file.lastModifiedSync().toUtc().toIso8601String();
}

String _stringValue(Object? value) => '${value ?? ''}'.trim();

Object? _parseJsonValue(Object? value) {
  final raw = _stringValue(value);
  if (raw.isEmpty) {
    return null;
  }

  try {
    return jsonDecode(raw);
  } catch (_) {
    return null;
  }
}

List<dynamic> _parseJsonList(Object? value) {
  final decoded = _parseJsonValue(value);
  return decoded is List<dynamic> ? decoded : <dynamic>[];
}

Map<String, dynamic>? _mapImportedImage(
  Map<String, dynamic> image,
  String imagesDirectoryPath,
) {
  final localPath = _stringValue(image['localPath']);
  const prefix = '/api/images/';
  if (!localPath.startsWith(prefix)) {
    return null;
  }

  final relativePath = localPath.substring(prefix.length);
  final filePath = p.joinAll(<String>[
    imagesDirectoryPath,
    ...p.posix.split(relativePath),
  ]);

  return {
    'type': _stringValue(image['type']),
    'variant': _stringValue(image['variant']),
    'filePath': filePath,
    'sourceUrl': _stringValue(image['sourceUrl']).isEmpty
        ? null
        : _stringValue(image['sourceUrl']),
  };
}

String? _latestUpdatedAt(ResultSet noteRows) {
  String? latest;
  for (final row in noteRows) {
    final candidate = _stringValue(row['updated_at']);
    if (candidate.isEmpty) {
      continue;
    }
    if (latest == null || candidate.compareTo(latest) > 0) {
      latest = candidate;
    }
  }
  return latest;
}

ImportedDatasetLoader createPlatformImportedDatasetLoader() {
  return const ImportedDatasetLoader();
}
