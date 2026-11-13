import 'package:url_launcher/url_launcher.dart';

/// Opens a file path in the OS file manager; false means the system refused.
typedef RevealFolder = Future<bool> Function(String path);

/// Opens [path] in the OS file manager. False means the system refused the
/// request, so the caller can report it instead of the tap doing nothing.
Future<bool> revealInFolder(String path) async {
  try {
    return await launchUrl(
      Uri.file(path),
      mode: LaunchMode.externalApplication,
    );
  } catch (_) {
    return false;
  }
}
