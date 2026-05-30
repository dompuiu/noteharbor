import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

import '../models/dataset_source.dart';
import '../models/note_record.dart';
import '../models/tag.dart';
import '../models/viewer_collection.dart';
import '../models/viewer_dataset.dart';
import 'native_dataset_store.dart';

class ImportedDatasetLoader {
  const ImportedDatasetLoader();

  Future<ViewerDataset> load(ImportedDatasetLocation location) async {
    final database = sqlite3.open(location.databasePath);

    try {
      final hasCollectionsTable = _tableExists(database, 'collections');
      final banknotesHasCollectionId =
          _columnExists(database, 'banknotes', 'collection_id');

      final defaultCollectionId = hasCollectionsTable
          ? _resolveDefaultCollectionId(database)
          : 1;

      final collections = hasCollectionsTable
          ? _loadCollections(database)
          : <ViewerCollection>[
              const ViewerCollection(
                id: 1,
                name: 'Default',
                noteCount: 0,
                isDefault: true,
              ),
            ];

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
          ${banknotesHasCollectionId ? 'collection_id,' : ''}
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
        ORDER BY ${banknotesHasCollectionId ? 'collection_id ASC,' : ''} display_order ASC, id ASC
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

        final collectionId = banknotesHasCollectionId
            ? (row['collection_id'] as int?) ?? defaultCollectionId
            : defaultCollectionId;

        notes.add(
          NoteRecord.fromJson({
            'id': noteId,
            'collectionId': collectionId,
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

      final notesPerCollection = <int, int>{
        for (final collection in collections) collection.id: 0,
      };
      for (final note in notes) {
        notesPerCollection[note.collectionId] =
            (notesPerCollection[note.collectionId] ?? 0) + 1;
      }

      final hydratedCollections = collections
          .map(
            (collection) => ViewerCollection(
              id: collection.id,
              name: collection.name,
              noteCount: notesPerCollection[collection.id] ?? collection.noteCount,
              isDefault: collection.isDefault,
            ),
          )
          .toList(growable: false);

      return ViewerDataset(
        generatedAt: _datasetTimestamp(location) ?? _latestUpdatedAt(noteRows),
        noteCount: notes.length,
        notes: notes,
        collections: hydratedCollections,
        source: DatasetSource.imported,
      );
    } finally {
      database.close();
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

bool _tableExists(Database database, String tableName) {
  final rows = database.select(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
    <Object?>['table', tableName],
  );
  return rows.isNotEmpty;
}

bool _columnExists(Database database, String tableName, String columnName) {
  final rows = database.select('PRAGMA table_info($tableName)');
  for (final row in rows) {
    if (_stringValue(row['name']).toLowerCase() == columnName.toLowerCase()) {
      return true;
    }
  }
  return false;
}

int _resolveDefaultCollectionId(Database database) {
  final hasDefaultColumn = _columnExists(database, 'collections', 'is_default');

  if (hasDefaultColumn) {
    final defaultRows = database.select('''
      SELECT id
      FROM collections
      WHERE is_default = 1
      ORDER BY id ASC
      LIMIT 1
    ''');

    if (defaultRows.isNotEmpty) {
      return (defaultRows.first['id'] as int?) ?? 1;
    }
  }

  final rows = database.select('''
    SELECT id
    FROM collections
    WHERE lower(name) = lower('Default')
    ORDER BY id ASC
    LIMIT 1
  ''');

  if (rows.isNotEmpty) {
    return (rows.first['id'] as int?) ?? 1;
  }

  final fallbackRows = database.select('''
    SELECT id
    FROM collections
    ORDER BY name COLLATE NOCASE ASC, id ASC
    LIMIT 1
  ''');

  return fallbackRows.isNotEmpty ? ((fallbackRows.first['id'] as int?) ?? 1) : 1;
}

List<ViewerCollection> _loadCollections(Database database) {
  final hasDefaultColumn = _columnExists(database, 'collections', 'is_default');
  final rows = database.select('''
    SELECT id, name${hasDefaultColumn ? ', is_default' : ''}
    FROM collections
    ORDER BY ${hasDefaultColumn ? 'is_default DESC, ' : ''}name COLLATE NOCASE ASC, id ASC
  ''');

  return rows
      .map(
        (row) => ViewerCollection(
          id: (row['id'] as int?) ?? 0,
          name: _stringValue(row['name']),
          noteCount: 0,
          isDefault: hasDefaultColumn ? ((row['is_default'] as int?) ?? 0) == 1 : false,
        ),
      )
      .where((collection) => collection.id > 0)
      .toList(growable: false);
}

ImportedDatasetLoader createPlatformImportedDatasetLoader() {
  return const ImportedDatasetLoader();
}
