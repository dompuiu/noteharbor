import 'archive_staging_stub.dart'
    if (dart.library.io) 'archive_staging_io.dart';

/// Copies a dropped archive to a stable temporary path before the page starts
/// a confirm dialog, so a macOS sandbox grant is still active during the copy.
/// Returns null when the file cannot be read.
Future<String?> stageDroppedArchive(String path, List<int>? appleBookmark) =>
    platformStageDroppedArchive(path: path, appleBookmark: appleBookmark);
