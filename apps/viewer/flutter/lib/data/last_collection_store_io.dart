import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'last_collection_store.dart';

LastCollectionStore createLastCollectionStore() {
  return const _FileLastCollectionStore();
}

/// Persists the last selected collection as a small JSON file next to the
/// imported dataset, under the shared `noteharbor_viewer` support folder.
class _FileLastCollectionStore implements LastCollectionStore {
  const _FileLastCollectionStore();

  static const String _containerDirName = 'noteharbor_viewer';
  static const String _fileName = 'viewer_state.json';

  @override
  Future<LastCollectionSelection?> load() async {
    try {
      final file = await _stateFile();
      if (!await file.exists()) {
        return null;
      }
      final json = jsonDecode(await file.readAsString());
      if (json is! Map<String, dynamic>) {
        return null;
      }
      final selection = LastCollectionSelection.fromJson(json);
      return selection.isEmpty ? null : selection;
    } catch (_) {
      // A missing or corrupt file simply means "no remembered selection".
      return null;
    }
  }

  @override
  Future<void> save(LastCollectionSelection selection) async {
    try {
      final file = await _stateFile();
      await file.writeAsString(
        jsonEncode(selection.toJson()),
        flush: true,
      );
    } catch (_) {
      // Best effort: failing to remember the selection must never break the app.
    }
  }

  @override
  Future<void> clear() async {
    try {
      final file = await _stateFile();
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {
      // Best effort.
    }
  }

  Future<File> _stateFile() async {
    final supportDir = await getApplicationSupportDirectory();
    final dir = Directory(p.join(supportDir.path, _containerDirName));
    await dir.create(recursive: true);
    return File(p.join(dir.path, _fileName));
  }
}
