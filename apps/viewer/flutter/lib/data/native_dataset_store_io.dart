import 'dart:convert';
import 'dart:io';

import 'package:archive/archive_io.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqlite3/sqlite3.dart';

class ImportedDatasetLocation {
  const ImportedDatasetLocation({
    required this.rootPath,
    required this.databasePath,
    required this.imagesDirectoryPath,
  });

  final String rootPath;
  final String databasePath;
  final String imagesDirectoryPath;
}

class NativeDatasetStore {
  const NativeDatasetStore();

  static const String _containerDirName = 'noteharbor_viewer';
  static const String _currentDirName = 'imported_dataset';
  static const String _imageApiPrefix = '/api/images/';

  bool get isSupported => true;

  Future<ImportedDatasetLocation?> getImportedDatasetLocation() async {
    final currentDir = await _currentDatasetDirectory();
    final databaseFile = File(p.join(currentDir.path, 'banknotes.db'));
    final imagesDir = Directory(p.join(currentDir.path, 'images'));
    if (!databaseFile.existsSync() || !imagesDir.existsSync()) {
      return null;
    }

    return ImportedDatasetLocation(
      rootPath: currentDir.path,
      databasePath: databaseFile.path,
      imagesDirectoryPath: imagesDir.path,
    );
  }

  Future<void> importArchive(String archivePath) async {
    final sourceArchive = File(archivePath);
    if (!sourceArchive.existsSync()) {
      throw StateError('The selected archive file no longer exists.');
    }

    final containerDir = await _containerDirectory();
    final extractionDir = Directory(
      p.join(containerDir.path, 'extract-${DateTime.now().microsecondsSinceEpoch}'),
    );
    final stagedDir = Directory(
      p.join(containerDir.path, 'stage-${DateTime.now().microsecondsSinceEpoch}'),
    );

    await extractionDir.create(recursive: true);

    try {
      final inputStream = InputFileStream(sourceArchive.path);
      try {
        final archive = ZipDecoder().decodeStream(inputStream);
        for (final entry in archive) {
          final normalizedPath = p.normalize(entry.name);
          if (p.isAbsolute(normalizedPath) ||
              normalizedPath == '..' ||
              normalizedPath.startsWith('../') ||
              normalizedPath.startsWith('..\\')) {
            throw StateError('Archive contains invalid file paths.');
          }

          final outputPath = p.join(extractionDir.path, normalizedPath);
          if (entry.isFile) {
            Directory(p.dirname(outputPath)).createSync(recursive: true);
            final outputStream = OutputFileStream(outputPath);
            try {
              entry.writeContent(outputStream);
            } finally {
              outputStream.closeSync();
            }
          } else {
            Directory(outputPath).createSync(recursive: true);
          }
        }
      } finally {
        inputStream.closeSync();
      }

      final archiveDataDir = _findArchiveDataDir(extractionDir);
      if (archiveDataDir == null) {
        throw StateError(
          'Archive must contain a banknotes.db file and an images directory.',
        );
      }

      final archiveDbPath = p.join(archiveDataDir.path, 'banknotes.db');
      final archiveImagesDir = Directory(p.join(archiveDataDir.path, 'images'));
      final currentDir = await _currentDatasetDirectory();

      if (currentDir.existsSync()) {
        await _copyDirectory(currentDir, stagedDir);
      } else {
        await stagedDir.create(recursive: true);
        await File(archiveDbPath).copy(p.join(stagedDir.path, 'banknotes.db'));
        await _copyDirectory(
          archiveImagesDir,
          Directory(p.join(stagedDir.path, 'images')),
        );
      }

      final stagedDatabaseFile = File(p.join(stagedDir.path, 'banknotes.db'));
      final stagedImagesDir = Directory(p.join(stagedDir.path, 'images'));
      await stagedImagesDir.create(recursive: true);

      _mergeArchiveIntoDataset(
        archiveDbPath: archiveDbPath,
        archiveImagesDir: archiveImagesDir.path,
        stagedDbPath: stagedDatabaseFile.path,
        stagedImagesDir: stagedImagesDir.path,
      );

      final backupDir = Directory(
        p.join(containerDir.path, 'backup-${DateTime.now().microsecondsSinceEpoch}'),
      );

      if (currentDir.existsSync()) {
        await currentDir.rename(backupDir.path);
      }

      try {
        await stagedDir.rename(currentDir.path);
        if (backupDir.existsSync()) {
          await backupDir.delete(recursive: true);
        }
      } catch (_) {
        if (currentDir.existsSync()) {
          await currentDir.delete(recursive: true);
        }
        if (backupDir.existsSync()) {
          await backupDir.rename(currentDir.path);
        }
        rethrow;
      }
    } finally {
      if (extractionDir.existsSync()) {
        await extractionDir.delete(recursive: true);
      }
      if (stagedDir.existsSync()) {
        await stagedDir.delete(recursive: true);
      }
    }
  }

  Future<void> deleteCollection(int collectionId) async {
    final normalizedCollectionId = collectionId;
    if (normalizedCollectionId <= 0) {
      throw StateError('A valid collection ID is required.');
    }

    final currentDir = await _currentDatasetDirectory();
    final databasePath = p.join(currentDir.path, 'banknotes.db');
    if (!File(databasePath).existsSync()) {
      throw StateError('No imported dataset is installed.');
    }

    final database = sqlite3.open(databasePath);

    try {
      database.execute('PRAGMA foreign_keys = ON');

      final collectionRows = database.select(
        'SELECT id, is_default FROM collections WHERE id = ? LIMIT 1',
        <Object?>[normalizedCollectionId],
      );
      if (collectionRows.isEmpty) {
        throw StateError('Collection not found.');
      }

      final noteIdRows = database.select(
        'SELECT id FROM banknotes WHERE collection_id = ? ORDER BY id ASC',
        <Object?>[normalizedCollectionId],
      );
      final noteIds = noteIdRows
          .map((row) => (row['id'] as int?) ?? 0)
          .where((id) => id > 0)
          .toList(growable: false);

      database.execute('DELETE FROM collections WHERE id = ?', <Object?>[normalizedCollectionId]);

      final hasDefaultRows = database.select(
        'SELECT id FROM collections WHERE is_default = 1 LIMIT 1',
      );

      if (hasDefaultRows.isEmpty) {
        final fallbackRows = database.select(
          'SELECT id FROM collections ORDER BY name COLLATE NOCASE ASC, id ASC LIMIT 1',
        );

        if (fallbackRows.isNotEmpty) {
          final fallbackId = (fallbackRows.first['id'] as int?) ?? 0;
          if (fallbackId > 0) {
            database.execute('UPDATE collections SET is_default = 0 WHERE is_default = 1');
            database.execute(
              'UPDATE collections SET is_default = 1 WHERE id = ?',
              <Object?>[fallbackId],
            );
          }
        }
      }

      for (final noteId in noteIds) {
        final noteImagesDir = Directory(p.join(currentDir.path, 'images', 'notes', '$noteId'));
        if (noteImagesDir.existsSync()) {
          noteImagesDir.deleteSync(recursive: true);
        }
      }
    } finally {
      database.close();
    }
  }

  Future<void> setDefaultCollection(int collectionId) async {
    final currentDir = await _currentDatasetDirectory();
    final databasePath = p.join(currentDir.path, 'banknotes.db');
    if (!File(databasePath).existsSync()) {
      throw StateError('No imported dataset is installed.');
    }

    final database = sqlite3.open(databasePath);
    try {
      database.execute('UPDATE collections SET is_default = 0 WHERE is_default = 1');
      database.execute('UPDATE collections SET is_default = 1 WHERE id = ?', <Object?>[collectionId]);
    } finally {
      database.close();
    }
  }

  Future<void> deleteImportedDataset() async {
    final currentDir = await _currentDatasetDirectory();
    if (currentDir.existsSync()) {
      await currentDir.delete(recursive: true);
    }
  }

  Future<Directory> _containerDirectory() async {
    final supportDir = await getApplicationSupportDirectory();
    final dir = Directory(p.join(supportDir.path, _containerDirName));
    await dir.create(recursive: true);
    return dir;
  }

  Future<Directory> _currentDatasetDirectory() async {
    final containerDir = await _containerDirectory();
    return Directory(p.join(containerDir.path, _currentDirName));
  }
}

Directory? _findArchiveDataDir(Directory rootDir) {
  final queue = <Directory>[rootDir];

  while (queue.isNotEmpty) {
    final currentDir = queue.removeAt(0);
    final databaseFile = File(p.join(currentDir.path, 'banknotes.db'));
    final imagesDir = Directory(p.join(currentDir.path, 'images'));

    if (databaseFile.existsSync() && imagesDir.existsSync()) {
      return currentDir;
    }

    for (final entry in currentDir.listSync(followLinks: false)) {
      if (entry is Directory) {
        queue.add(entry);
      }
    }
  }

  return null;
}

Future<void> _copyDirectory(Directory source, Directory target) async {
  await target.create(recursive: true);

  for (final entry in source.listSync(followLinks: false)) {
    final destinationPath = p.join(target.path, p.basename(entry.path));
    if (entry is File) {
      await entry.copy(destinationPath);
    } else if (entry is Directory) {
      await _copyDirectory(entry, Directory(destinationPath));
    }
  }
}

bool _tableExists(Database database, String tableName) {
  final rows = database.select(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1',
    <Object?>['table', tableName],
  );
  return rows.isNotEmpty;
}

List<Map<String, Object?>> _loadArchiveCollections(Database database) {
  if (!_tableExists(database, 'collections')) {
    throw StateError('Archive must include collections metadata.');
  }

  final rows = database.select('''
    SELECT id, name, COALESCE(is_default, 0) AS is_default
    FROM collections
    ORDER BY id ASC
  ''');

  final normalizedRows = rows
      .map(
        (row) => <String, Object?>{
          'id': (row['id'] as int?) ?? 0,
          'name': '${row['name'] ?? ''}'.trim(),
          'is_default': ((row['is_default'] as int?) ?? 0) == 1 ? 1 : 0,
        },
      )
      .where((row) => (row['id'] as int) > 0 && ('${row['name']}'.trim().isNotEmpty))
      .toList(growable: false);

  if (normalizedRows.isEmpty) {
    throw StateError('Archive contains no collections.');
  }

  return normalizedRows;
}

List<Map<String, Object?>> _parseImageRecords(Object? rawImages) {
  if (rawImages == null) {
    return const <Map<String, Object?>>[];
  }

  final raw = '$rawImages'.trim();
  if (raw.isEmpty) {
    return const <Map<String, Object?>>[];
  }

  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) {
      return const <Map<String, Object?>>[];
    }

    return decoded
        .whereType<Map>()
        .map(
          (entry) => entry.map(
            (key, value) => MapEntry('$key', value),
          ),
        )
        .toList(growable: false);
  } catch (_) {
    return const <Map<String, Object?>>[];
  }
}

({List<Map<String, Object?>> images, List<({String fromRelative, String toRelative})> copyPlan})
    _rewriteImageRecordsForImportedNote(
  List<Map<String, Object?>> images,
  int archiveNoteId,
  int stagedNoteId,
) {
  final rewritten = <Map<String, Object?>>[];
  final copyPlan = <({String fromRelative, String toRelative})>[];

  for (final image in images) {
    final localPath = '${image['localPath'] ?? ''}'.trim();
    if (!localPath.startsWith(NativeDatasetStore._imageApiPrefix)) {
      rewritten.add(image);
      continue;
    }

    final relativePath = p.posix.normalize(
      localPath.substring(NativeDatasetStore._imageApiPrefix.length),
    );
    final notePrefix = 'notes/$archiveNoteId/';
    final targetRelativePath = relativePath.startsWith(notePrefix)
        ? 'notes/$stagedNoteId/${relativePath.substring(notePrefix.length)}'
        : relativePath;

    copyPlan.add((fromRelative: relativePath, toRelative: targetRelativePath));
    rewritten.add({
      ...image,
      'localPath': '${NativeDatasetStore._imageApiPrefix}$targetRelativePath',
    });
  }

  return (images: rewritten, copyPlan: copyPlan);
}

void _copyPlannedImages({
  required String sourceImagesDir,
  required String stagedImagesDir,
  required List<({String fromRelative, String toRelative})> copyPlan,
}) {
  for (final plan in copyPlan) {
    final sourcePath = p.joinAll(<String>[
      sourceImagesDir,
      ...p.posix.split(plan.fromRelative),
    ]);
    final sourceFile = File(sourcePath);
    if (!sourceFile.existsSync()) {
      continue;
    }

    final targetPath = p.joinAll(<String>[
      stagedImagesDir,
      ...p.posix.split(plan.toRelative),
    ]);
    final targetFile = File(targetPath);
    targetFile.parent.createSync(recursive: true);
    sourceFile.copySync(targetPath);
  }
}

void _mergeArchiveIntoDataset({
  required String archiveDbPath,
  required String archiveImagesDir,
  required String stagedDbPath,
  required String stagedImagesDir,
}) {
  final archiveDatabase = sqlite3.open(archiveDbPath, mode: OpenMode.readOnly);
  final stagedDatabase = sqlite3.open(stagedDbPath);
  final statements = <PreparedStatement>[];

  final removedNoteIds = <int>[];
  final copyPlan = <({String fromRelative, String toRelative})>[];

  try {
    stagedDatabase.execute('PRAGMA foreign_keys = ON');

    final archiveCollections = _loadArchiveCollections(archiveDatabase);

    final findCollectionByName = statements._track(stagedDatabase.prepare('''
      SELECT id
      FROM collections
      WHERE lower(name) = lower(?)
      ORDER BY id ASC
      LIMIT 1
    '''));
    final listNoteIdsByCollection = statements._track(stagedDatabase.prepare('''
      SELECT id
      FROM banknotes
      WHERE collection_id = ?
      ORDER BY id ASC
    '''));
    final deleteCollection = statements._track(
      stagedDatabase.prepare('DELETE FROM collections WHERE id = ?'),
    );
    final insertCollection = statements._track(stagedDatabase.prepare('''
      INSERT INTO collections (name, is_default, created_at, updated_at)
      VALUES (?, 0, datetime('now'), datetime('now'))
    '''));
    final archiveTagsByCollection = statements._track(archiveDatabase.prepare('''
      SELECT bt.banknote_id AS banknote_id, t.name AS name
      FROM banknote_tags bt
      INNER JOIN tags t ON t.id = bt.tag_id
      INNER JOIN banknotes b ON b.id = bt.banknote_id
      WHERE b.collection_id = ?
      ORDER BY bt.banknote_id ASC, t.name COLLATE NOCASE ASC
    '''));
    final archiveNotesByCollection = statements._track(archiveDatabase.prepare('''
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
      WHERE collection_id = ?
      ORDER BY display_order ASC, id ASC
    '''));
    final insertNote = statements._track(stagedDatabase.prepare('''
      INSERT INTO banknotes (
        collection_id,
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
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
    '''));
    final updateNoteImages = statements._track(stagedDatabase.prepare('''
      UPDATE banknotes
      SET images = ?,
          updated_at = datetime('now')
      WHERE id = ?
    '''));
    final insertTag = statements._track(stagedDatabase.prepare(
      'INSERT OR IGNORE INTO tags (name, collection_id) VALUES (?, ?)',
    ));
    final getTagByName = statements._track(stagedDatabase.prepare('''
      SELECT id
      FROM tags
      WHERE collection_id = ?
        AND lower(name) = lower(?)
      ORDER BY id ASC
      LIMIT 1
    '''));
    final linkTag = statements._track(stagedDatabase.prepare(
      'INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id) VALUES (?, ?)',
    ));

    final importedDefaults = <({int archiveId, int stagedId})>[];

    for (final archiveCollection in archiveCollections) {
      final archiveCollectionId = archiveCollection['id'] as int;
      final archiveCollectionName = '${archiveCollection['name']}';
      final archiveIsDefault = (archiveCollection['is_default'] as int?) == 1;

      final existingRows = findCollectionByName.select(<Object?>[archiveCollectionName]);
      if (existingRows.isNotEmpty) {
        final existingCollectionId = (existingRows.first['id'] as int?) ?? 0;
        if (existingCollectionId > 0) {
          final noteRows = listNoteIdsByCollection.select(<Object?>[existingCollectionId]);
          removedNoteIds.addAll(
            noteRows
                .map((row) => (row['id'] as int?) ?? 0)
                .where((id) => id > 0),
          );
          deleteCollection.execute(<Object?>[existingCollectionId]);
        }
      }

      insertCollection.execute(<Object?>[archiveCollectionName]);
      final stagedCollectionId = stagedDatabase.lastInsertRowId;

      if (archiveIsDefault) {
        importedDefaults.add((archiveId: archiveCollectionId, stagedId: stagedCollectionId));
      }

      final tagsByNoteId = <int, List<String>>{};
      for (final row in archiveTagsByCollection.select(<Object?>[archiveCollectionId])) {
        final noteId = (row['banknote_id'] as int?) ?? 0;
        final tagName = '${row['name'] ?? ''}'.trim();
        if (noteId <= 0 || tagName.isEmpty) {
          continue;
        }

        tagsByNoteId.putIfAbsent(noteId, () => <String>[]).add(tagName);
      }

      var nextDisplayOrder = 1;
      for (final noteRow in archiveNotesByCollection.select(<Object?>[archiveCollectionId])) {
        final archiveNoteId = (noteRow['id'] as int?) ?? 0;
        if (archiveNoteId <= 0) {
          continue;
        }

        insertNote.execute(<Object?>[
          stagedCollectionId,
          nextDisplayOrder,
          noteRow['denomination'],
          noteRow['issue_date'],
          noteRow['catalog_number'],
          noteRow['grading_company'],
          noteRow['grade'],
          noteRow['watermark'],
          noteRow['serial'],
          noteRow['url'],
          noteRow['notes'],
          noteRow['scraped_data'],
          '[]',
          noteRow['scrape_status'] ?? 'pending',
          noteRow['scrape_error'],
          noteRow['created_at'],
          noteRow['updated_at'],
        ]);

        final stagedNoteId = stagedDatabase.lastInsertRowId;
        final imageRecords = _parseImageRecords(noteRow['images']);
        final rewrittenImages = _rewriteImageRecordsForImportedNote(
          imageRecords,
          archiveNoteId,
          stagedNoteId,
        );
        copyPlan.addAll(rewrittenImages.copyPlan);
        updateNoteImages.execute(<Object?>[
          jsonEncode(rewrittenImages.images),
          stagedNoteId,
        ]);

        final tagNames = tagsByNoteId[archiveNoteId] ?? const <String>[];
        for (final tagName in tagNames) {
          insertTag.execute(<Object?>[tagName, stagedCollectionId]);
          final tagRows = getTagByName.select(<Object?>[stagedCollectionId, tagName]);
          if (tagRows.isEmpty) {
            continue;
          }

          final tagId = (tagRows.first['id'] as int?) ?? 0;
          if (tagId > 0) {
            linkTag.execute(<Object?>[stagedNoteId, tagId]);
          }
        }

        nextDisplayOrder += 1;
      }
    }

    if (importedDefaults.isNotEmpty) {
      importedDefaults.sort((a, b) => a.archiveId.compareTo(b.archiveId));
      stagedDatabase.execute('UPDATE collections SET is_default = 0 WHERE is_default = 1');
      stagedDatabase.execute(
        'UPDATE collections SET is_default = 1 WHERE id = ?',
        <Object?>[importedDefaults.first.stagedId],
      );
    }
  } finally {
    for (final statement in statements.reversed) {
      statement.close();
    }
    archiveDatabase.close();
    stagedDatabase.close();
  }

  for (final noteId in removedNoteIds) {
    final noteImagesDir = Directory(p.join(stagedImagesDir, 'notes', '$noteId'));
    if (noteImagesDir.existsSync()) {
      noteImagesDir.deleteSync(recursive: true);
    }
  }

  _copyPlannedImages(
    sourceImagesDir: archiveImagesDir,
    stagedImagesDir: stagedImagesDir,
    copyPlan: copyPlan,
  );
}

NativeDatasetStore createPlatformNativeDatasetStore() {
  return const NativeDatasetStore();
}

extension on List<PreparedStatement> {
  PreparedStatement _track(PreparedStatement statement) {
    add(statement);
    return statement;
  }
}
