import 'dart:io';

import 'package:archive/archive.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

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
      final archive = ZipDecoder().decodeBytes(await sourceArchive.readAsBytes());
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
          File(outputPath)
            ..parent.createSync(recursive: true)
            ..writeAsBytesSync(entry.content as List<int>);
        } else {
          Directory(outputPath).createSync(recursive: true);
        }
      }

      final archiveDataDir = _findArchiveDataDir(extractionDir);
      if (archiveDataDir == null) {
        throw StateError(
          'Archive must contain a banknotes.db file and an images directory.',
        );
      }

      await stagedDir.create(recursive: true);
      await File(p.join(archiveDataDir.path, 'banknotes.db')).copy(
        p.join(stagedDir.path, 'banknotes.db'),
      );
      await _copyDirectory(
        Directory(p.join(archiveDataDir.path, 'images')),
        Directory(p.join(stagedDir.path, 'images')),
      );

      final currentDir = await _currentDatasetDirectory();
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

NativeDatasetStore createPlatformNativeDatasetStore() {
  return const NativeDatasetStore();
}
