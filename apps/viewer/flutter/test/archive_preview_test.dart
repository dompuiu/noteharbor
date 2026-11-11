import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

import 'package:note_harbor_viewer/data/native_dataset_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const pathProviderChannel = MethodChannel('plugins.flutter.io/path_provider');
  late Directory supportDir;

  setUp(() async {
    supportDir = await Directory.systemTemp.createTemp('noteharbor-preview-');
    // The store asks path_provider for its container; the plugin is absent
    // under flutter test, so answer on its channel with a temp root.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      pathProviderChannel,
      (call) async => supportDir.path,
    );
  });

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(pathProviderChannel, null);
    if (supportDir.existsSync()) {
      await supportDir.delete(recursive: true);
    }
  });

  test('reads collections, note counts, and the archive timestamp', () async {
    final archivePath = _writeArchive(
      supportDir,
      collections: const [('Romania', 2), ('Hungary', 0)],
    );
    final store = const NativeDatasetStore();

    final preview = await store.peekArchive(archivePath);
    final again = await store.peekArchive(archivePath);

    expect(preview, isNotNull);
    expect(preview!.generatedAt, '2026-03-28T12:00:00Z');
    expect(
      preview.collections
          .map((collection) => (collection.name, collection.noteCount)),
      [('Hungary', 0), ('Romania', 2)],
    );
    // The archive's own timestamp, not the preview run's clock.
    expect(again!.generatedAt, preview.generatedAt);
  });

  test('deletes its extraction directory', () async {
    final archivePath = _writeArchive(
      supportDir,
      collections: const [('Romania', 1)],
    );

    await const NativeDatasetStore().peekArchive(archivePath);

    final containerDir =
        Directory(p.join(supportDir.path, 'noteharbor_viewer'));
    expect(containerDir.listSync(), isEmpty);
  });

  test('returns null for a corrupt archive', () async {
    final archivePath = p.join(supportDir.path, 'corrupt.zip');
    File(archivePath).writeAsBytesSync(const [0, 1, 2, 3, 4]);

    expect(
      await const NativeDatasetStore().peekArchive(archivePath),
      isNull,
    );
  });

  test('returns null for a zip that is not a Note Harbor archive', () async {
    final archivePath = _writeZip(
      supportDir,
      'plain.zip',
      [ArchiveFile.string('readme.txt', 'not an archive')],
    );

    expect(
      await const NativeDatasetStore().peekArchive(archivePath),
      isNull,
    );
  });

  test('returns null for a corrupt database inside a valid archive', () async {
    final archivePath = _writeZip(supportDir, 'corrupt-db.zip', [
      ArchiveFile.bytes('banknotes.db', const [0, 1, 2, 3, 4]),
      ArchiveFile.directory('images/'),
    ]);

    expect(
      await const NativeDatasetStore().peekArchive(archivePath),
      isNull,
    );
  });

  test('returns null when the database lacks the needed tables', () async {
    final directory = Directory(p.join(supportDir.path, 'no-tables'));
    directory.createSync(recursive: true);
    final databaseFile = File(p.join(directory.path, 'banknotes.db'));
    sqlite3.open(databaseFile.path).close();

    final archivePath = _writeZip(supportDir, 'no-tables.zip', [
      ArchiveFile.bytes('banknotes.db', databaseFile.readAsBytesSync()),
      ArchiveFile.directory('images/'),
    ]);

    expect(
      await const NativeDatasetStore().peekArchive(archivePath),
      isNull,
    );
  });

  test('returns null when the archive has no collections', () async {
    final archivePath = _writeArchive(
      supportDir,
      collections: const [],
    );

    expect(
      await const NativeDatasetStore().peekArchive(archivePath),
      isNull,
    );
  });

  test('returns null for an archive with escaping paths', () async {
    final archivePath = _writeZip(supportDir, 'slip.zip', [
      ArchiveFile.string('../escape.txt', 'escaped'),
    ]);

    expect(
      await const NativeDatasetStore().peekArchive(archivePath),
      isNull,
    );
    expect(File(p.join(supportDir.path, 'escape.txt')).existsSync(), isFalse);
  });

  test('throws when the archive file is gone', () async {
    final store = const NativeDatasetStore();

    await expectLater(
      store.peekArchive(p.join(supportDir.path, 'missing.zip')),
      throwsStateError,
    );
  });
}

/// Writes a zip holding a Note Harbor data directory under `export/`, the
/// one-top-level-folder layout real exports use.
String _writeArchive(
  Directory root, {
  required List<(String, int)> collections,
}) {
  final stagingDir = Directory(p.join(root.path, 'staging'));
  stagingDir.createSync(recursive: true);
  final databaseFile = File(p.join(stagingDir.path, 'banknotes.db'));

  final database = sqlite3.open(databaseFile.path);
  try {
    database.execute(
      'CREATE TABLE collections (id INTEGER PRIMARY KEY, name TEXT, updated_at TEXT)',
    );
    database.execute(
      'CREATE TABLE banknotes (id INTEGER PRIMARY KEY, collection_id INTEGER, updated_at TEXT)',
    );

    var noteId = 1;
    for (var index = 0; index < collections.length; index += 1) {
      final (name, noteCount) = collections[index];
      final collectionId = index + 1;
      database.execute(
        "INSERT INTO collections (id, name, updated_at) VALUES (?, ?, '2026-03-27 09:30:00')",
        <Object?>[collectionId, name],
      );
      for (var note = 0; note < noteCount; note += 1) {
        database.execute(
          "INSERT INTO banknotes (id, collection_id, updated_at) VALUES (?, ?, '2026-03-28 12:00:00')",
          <Object?>[noteId, collectionId],
        );
        noteId += 1;
      }
    }
  } finally {
    database.close();
  }

  return _writeZip(root, 'archive.zip', [
    ArchiveFile.bytes(
      'export/banknotes.db',
      databaseFile.readAsBytesSync(),
    ),
    ArchiveFile.directory('export/images/'),
  ]);
}

String _writeZip(
  Directory root,
  String name,
  List<ArchiveFile> entries,
) {
  final archive = Archive();
  for (final entry in entries) {
    archive.addFile(entry);
  }

  final archivePath = p.join(root.path, name);
  File(archivePath).writeAsBytesSync(ZipEncoder().encode(archive));
  return archivePath;
}
