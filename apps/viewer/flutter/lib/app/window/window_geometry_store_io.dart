import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'window_geometry.dart';
import 'window_geometry_store.dart';

WindowGeometryStore createWindowGeometryStore() {
  return const _FileWindowGeometryStore();
}

/// Persists the window geometry as a small JSON file next to the imported
/// dataset, under the shared `noteharbor_viewer` application-support folder.
class _FileWindowGeometryStore implements WindowGeometryStore {
  const _FileWindowGeometryStore();

  static const String _containerDirName = 'noteharbor_viewer';
  static const String _fileName = 'window_state.json';

  @override
  Future<WindowGeometry?> load() async {
    try {
      final file = await _stateFile();
      if (!await file.exists()) {
        return null;
      }
      return WindowGeometry.tryFromJson(jsonDecode(await file.readAsString()));
    } catch (_) {
      // A missing or corrupt file simply means "use the defaults".
      return null;
    }
  }

  @override
  Future<void> save(WindowGeometry geometry) async {
    try {
      final file = await _stateFile();
      await file.writeAsString(jsonEncode(geometry.toJson()), flush: true);
    } catch (_) {
      // Best effort: failing to remember the window must never break the app.
    }
  }

  Future<File> _stateFile() async {
    final supportDir = await getApplicationSupportDirectory();
    final dir = Directory(p.join(supportDir.path, _containerDirName));
    await dir.create(recursive: true);
    return File(p.join(dir.path, _fileName));
  }
}
