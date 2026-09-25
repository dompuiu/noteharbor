import 'window_geometry.dart';
import 'window_geometry_store.dart';

WindowGeometryStore createWindowGeometryStore() {
  return const _NoopWindowGeometryStore();
}

/// Web has no desktop window to remember, so the store silently does nothing.
class _NoopWindowGeometryStore implements WindowGeometryStore {
  const _NoopWindowGeometryStore();

  @override
  Future<WindowGeometry?> load() async => null;

  @override
  Future<void> save(WindowGeometry geometry) async {}
}
