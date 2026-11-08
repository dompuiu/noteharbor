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
    final window = WindowManager.instance.getCurrent();
    if (window == null) {
      debugPrint('Window persistence is unavailable: no window to restore.');
      return;
    }

    final store = createWindowGeometryStore();
    final displays = _displayAreas();
    final geometry = (await store.load() ?? WindowGeometry.defaults)
        .clampToDisplays(displays);

    window.minimumSize = const Size(
      WindowGeometry.minimumWidth,
      WindowGeometry.minimumHeight,
    ).toNative();
    window.bounds = geometry.bounds.toNative();

    if (geometry.maximized) {
      // The runner shows the window itself on the first frame. Marking it
      // maximized here makes nativeapi answer that show with a maximized one,
      // instead of the runner's plain `SW_SHOWNORMAL` restoring it.
      window.maximize();
    }

    // Registered after the restored bounds are in place: restoring them must
    // not schedule a save of the geometry that was just written.
    _WindowGeometryListener(store, window, initial: geometry).listen();
  } catch (error, stackTrace) {
    debugPrint('Window persistence is unavailable: $error\n$stackTrace');
  }
}

bool get _isDesktop =>
    Platform.isWindows || Platform.isMacOS || Platform.isLinux;

/// The visible area of every display, primary first, so off-screen windows
/// have a sensible place to land.
List<Rect> _displayAreas() {
  final areas = <Rect>[];

  try {
    final primary = DisplayManager.instance.getPrimary();
    if (primary != null) {
      areas.add(primary.workArea.toRect());
    }
  } catch (error) {
    debugPrint('Could not read the primary display: $error');
  }

  try {
    for (final display in DisplayManager.instance.getAll()) {
      final area = display.workArea.toRect();
      if (!areas.contains(area)) {
        areas.add(area);
      }
    }
  } catch (error) {
    debugPrint('Could not read the display list: $error');
  }

  return areas;
}

/// Debounces move/resize events into occasional writes, and never records the
/// bounds of a maximized, fullscreen or minimized window: the file always
/// holds the last *normal* geometry.
///
/// Everything is saved while the window is live, so closing is not part of the
/// save path: the listener never intercepts the close or delays it.
class _WindowGeometryListener {
  _WindowGeometryListener(
    this._store,
    this._window, {
    required WindowGeometry initial,
  }) : _lastNormal = initial;

  static const Duration _debounceDelay = Duration(milliseconds: 500);

  final WindowGeometryStore _store;
  final Window _window;

  /// Bounds of the last window state worth remembering. Used when the window
  /// is minimized and the live bounds mean nothing.
  WindowGeometry _lastNormal;
  Timer? _debounce;
  bool _saving = false;
  bool _pending = false;

  /// Starts listening to [Window] events. The app keeps this listener for its
  /// whole lifetime, so its [ListenerId] is not retained.
  void listen() => _window.addListener(_onWindowEvent);

  void _onWindowEvent(WindowEvent event) {
    switch (event) {
      case WindowResizedEvent():
      case WindowMovedEvent():
      case WindowMaximizedEvent():
      case WindowRestoredEvent():
      case WindowMinimizedEvent():
        _scheduleSave();
      case WindowCloseRequestedEvent():
      case WindowClosedEvent():
        // The close is never held: the geometry was already saved as the
        // window was moved and resized. Keep the close path trivial so
        // shutdown stays instant.
        _debounce?.cancel();
      case WindowFocusedEvent():
      case WindowBlurredEvent():
      case WindowCreatedEvent():
      case WindowEnteredFullScreenEvent():
      case WindowExitedFullScreenEvent():
      case WindowDockedEvent():
      case WindowUndockedEvent():
      case WindowOcclusionChangedEvent():
      case WindowPropertyChangedEvent():
        break;
    }
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
      await _store.save(_capture());
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
  WindowGeometry _capture() {
    if (_window.isMinimized) {
      return _lastNormal;
    }

    final maximized = _window.isMaximized;
    final fullScreen = _window.isFullScreen;
    if (!maximized && !fullScreen) {
      final bounds = _window.bounds.toRect();
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
