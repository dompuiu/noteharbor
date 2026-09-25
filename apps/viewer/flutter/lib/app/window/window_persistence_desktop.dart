import 'dart:async';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:screen_retriever/screen_retriever.dart';
import 'package:window_manager/window_manager.dart';

import 'window_geometry.dart';
import 'window_geometry_store.dart';

/// Restores the last settled window size and position, then keeps the saved
/// state up to date as the window is moved and resized.
///
/// Desktop only. On mobile the plugin has no implementation, so this returns
/// without touching the window.
Future<void> setupWindowPersistence() async {
  if (!_isDesktop) {
    return;
  }

  try {
    await windowManager.ensureInitialized();

    final store = createWindowGeometryStore();
    final displays = await _displayAreas();
    final geometry = (await store.load() ?? WindowGeometry.defaults)
        .clampToDisplays(displays);

    final minimumSize = const Size(
      WindowGeometry.minimumWidth,
      WindowGeometry.minimumHeight,
    );
    await windowManager.setMinimumSize(minimumSize);

    windowManager.addListener(
      _WindowGeometryListener(store: store, initial: geometry),
    );

    final options = WindowOptions(
      size: Size(geometry.width, geometry.height),
      minimumSize: minimumSize,
      center: false,
    );

    // Not awaited: the app renders while the native window is still hidden,
    // and the callback shows it once the restored bounds are in place.
    unawaited(
      windowManager.waitUntilReadyToShow(options, () async {
        try {
          await windowManager.setBounds(geometry.bounds);
          if (geometry.maximized) {
            await windowManager.maximize();
          }
          await windowManager.show();
          await windowManager.focus();
        } catch (error) {
          debugPrint('Failed to apply the saved window geometry: $error');
        }
      }),
    );
  } catch (error, stackTrace) {
    debugPrint('Window persistence is unavailable: $error\n$stackTrace');
  }
}

bool get _isDesktop =>
    Platform.isWindows || Platform.isMacOS || Platform.isLinux;

/// The visible area of every display, primary first, so off-screen windows
/// have a sensible place to land.
Future<List<Rect>> _displayAreas() async {
  final areas = <Rect>[];

  try {
    areas.add(_visibleArea(await screenRetriever.getPrimaryDisplay()));
  } catch (error) {
    debugPrint('Could not read the primary display: $error');
  }

  try {
    for (final display in await screenRetriever.getAllDisplays()) {
      final area = _visibleArea(display);
      if (!areas.contains(area)) {
        areas.add(area);
      }
    }
  } catch (error) {
    debugPrint('Could not read the display list: $error');
  }

  return areas;
}

Rect _visibleArea(Display display) {
  final position = display.visiblePosition ?? Offset.zero;
  final size = display.visibleSize ?? display.size;
  return Rect.fromLTWH(position.dx, position.dy, size.width, size.height);
}

/// Debounces move/resize events into occasional writes, and never records the
/// bounds of a maximized, fullscreen or minimized window: the file always
/// holds the last *normal* geometry.
///
/// Everything is saved while the window is live, so closing is not part of the
/// save path: [onWindowClose] never intercepts the close or delays it.
class _WindowGeometryListener with WindowListener {
  _WindowGeometryListener({
    required WindowGeometryStore store,
    required WindowGeometry initial,
  })  : _store = store,
        _lastNormal = initial;

  static const Duration _debounceDelay = Duration(milliseconds: 500);

  /// Bounds of the last window state worth remembering. Used when the window
  /// is minimized and the live bounds mean nothing.
  final WindowGeometryStore _store;
  WindowGeometry _lastNormal;
  Timer? _debounce;
  bool _saving = false;
  bool _pending = false;

  @override
  void onWindowResized() => _scheduleSave();

  @override
  void onWindowMoved() => _scheduleSave();

  @override
  void onWindowMaximize() => _scheduleSave();

  @override
  void onWindowUnmaximize() => _scheduleSave();

  @override
  void onWindowRestore() => _scheduleSave();

  @override
  void onWindowMinimize() => _scheduleSave();

  @override
  void onWindowClose() {
    // The close is never held: the geometry was already saved as the window
    // was moved and resized, and this listener does not call setPreventClose.
    // Keep the close callback trivial so shutdown stays instant; the window
    // must never be destroyed from here.
    _debounce?.cancel();
  }

  void _scheduleSave() {
    _debounce?.cancel();
    _debounce = Timer(_debounceDelay, () => unawaited(_persist()));
  }

  Future<void> _persist() async {
    if (_saving) {
      _pending = true;
      return;
    }

    _saving = true;
    try {
      final geometry = await _capture();
      await _store.save(geometry);
    } catch (error) {
      debugPrint('Could not save the window geometry: $error');
    } finally {
      _saving = false;
      if (_pending) {
        _pending = false;
        unawaited(_persist());
      }
    }
  }

  /// Reads the geometry worth remembering, updating the cached normal bounds
  /// only while the window is in its normal state.
  Future<WindowGeometry> _capture() async {
    if (await windowManager.isMinimized()) {
      return _lastNormal;
    }

    final maximized = await windowManager.isMaximized();
    final fullScreen = await windowManager.isFullScreen();
    if (!maximized && !fullScreen) {
      final bounds = await windowManager.getBounds();
      if (bounds.width > 0 && bounds.height > 0) {
        _lastNormal = WindowGeometry(
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
        );
      }
    }

    return _lastNormal.copyWith(
      maximized: WindowGeometry.remembersMaximizedState(
        isWindows: Platform.isWindows,
        maximized: maximized,
      ),
    );
  }
}
