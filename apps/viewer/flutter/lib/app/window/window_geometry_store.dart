export 'window_geometry_store_stub.dart'
    if (dart.library.io) 'window_geometry_store_io.dart';

import 'window_geometry.dart';

/// Reads and writes a persisted window geometry.
///
/// The io implementation stores a small JSON file; the web stub is a no-op.
abstract class WindowGeometryStore {
  Future<WindowGeometry?> load();

  Future<void> save(WindowGeometry geometry);
}
