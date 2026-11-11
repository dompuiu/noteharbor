import 'dart:io';
import 'dart:typed_data';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:path/path.dart' as p;

Future<String?> platformStageDroppedArchive({
  required String path,
  required List<int>? appleBookmark,
}) async {
  final bookmark = appleBookmark == null
      ? null
      : Uint8List.fromList(appleBookmark);
  var hasAccess = false;
  if (bookmark != null && bookmark.isNotEmpty) {
    try {
      hasAccess = await DesktopDrop.instance
          .startAccessingSecurityScopedResource(bookmark: bookmark);
    } catch (_) {
      // A missing bookmark grant is handled by the copy below.
    }
  }

  try {
    final directory = await Directory.systemTemp.createTemp('noteharbor-drop-');
    final target = File(p.join(directory.path, 'archive.zip'));
    await File(path).copy(target.path);
    return target.path;
  } catch (_) {
    return null;
  } finally {
    if (hasAccess && bookmark != null) {
      try {
        await DesktopDrop.instance.stopAccessingSecurityScopedResource(
          bookmark: bookmark,
        );
      } catch (_) {
        // The copy already finished; a failed release must not surface.
      }
    }
  }
}
