import 'dart:ui';

/// Persisted window geometry for the desktop viewer.
///
/// This type is deliberately free of any `window_manager`, `dart:io` or
/// plugin imports: it is pure Dart so it can be unit tested and safely
/// compiled for the web build.
class WindowGeometry {
  const WindowGeometry({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.maximized = false,
  });

  /// Bump when the persisted shape changes so older files degrade to
  /// [defaults] instead of being misread.
  static const int schemaVersion = 1;

  /// First-run size, matching an iPhone 15/16 in portrait.
  static const double defaultWidth = 393;
  static const double defaultHeight = 852;
  static const double defaultX = 10;
  static const double defaultY = 10;

  /// Floor that keeps the notes table usable when the window is dragged small.
  static const double minimumWidth = 320;
  static const double minimumHeight = 480;

  static const WindowGeometry defaults = WindowGeometry(
    x: defaultX,
    y: defaultY,
    width: defaultWidth,
    height: defaultHeight,
  );

  final double x;
  final double y;
  final double width;
  final double height;

  /// Windows-only: whether the window was maximized when it was last saved.
  /// macOS ignores this and always restores the saved position and size.
  final bool maximized;

  Rect get bounds => Rect.fromLTWH(x, y, width, height);

  WindowGeometry copyWith({
    double? x,
    double? y,
    double? width,
    double? height,
    bool? maximized,
  }) {
    return WindowGeometry(
      x: x ?? this.x,
      y: y ?? this.y,
      width: width ?? this.width,
      height: height ?? this.height,
      maximized: maximized ?? this.maximized,
    );
  }

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'version': schemaVersion,
      'x': x,
      'y': y,
      'width': width,
      'height': height,
      'maximized': maximized,
    };
  }

  /// Parses a persisted geometry, returning `null` for anything that is not a
  /// well-formed, current-version payload. Callers fall back to [defaults].
  static WindowGeometry? tryFromJson(Object? json) {
    if (json is! Map) {
      return null;
    }

    final map = json.map((key, value) => MapEntry('$key', value));
    if (map['version'] != schemaVersion) {
      return null;
    }

    final x = _readFiniteDouble(map['x']);
    final y = _readFiniteDouble(map['y']);
    final width = _readFiniteDouble(map['width']);
    final height = _readFiniteDouble(map['height']);
    if (x == null || y == null || width == null || height == null) {
      return null;
    }
    if (width <= 0 || height <= 0) {
      return null;
    }

    return WindowGeometry(
      x: x,
      y: y,
      width: width,
      height: height,
      maximized: map['maximized'] == true,
    );
  }

  /// Reconciles a saved geometry with the displays that currently exist.
  ///
  /// The window is kept on whichever display it most overlaps, resized to fit
  /// that display and nudged until it is fully visible. When it overlaps no
  /// display at all (a disconnected monitor, a resolution change) it is placed
  /// at the default position on the first available display.
  WindowGeometry clampToDisplays(List<Rect> displays) {
    final usable = displays
        .where((display) => display.width > 0 && display.height > 0)
        .toList(growable: false);
    if (usable.isEmpty) {
      return this;
    }

    Rect? target;
    var bestArea = 0.0;
    for (final display in usable) {
      final overlap = bounds.intersect(display);
      if (overlap.isEmpty) {
        continue;
      }
      final area = overlap.width * overlap.height;
      if (area > bestArea) {
        bestArea = area;
        target = display;
      }
    }

    final offScreen = target == null;
    target ??= usable.first;

    final clampedWidth = _clampDimension(width, minimumWidth, target.width);
    final clampedHeight = _clampDimension(height, minimumHeight, target.height);

    final desiredX = offScreen ? defaultX : x;
    final desiredY = offScreen ? defaultY : y;

    final maxX = target.right - clampedWidth;
    final maxY = target.bottom - clampedHeight;

    return copyWith(
      x: desiredX.clamp(target.left, maxX).toDouble(),
      y: desiredY.clamp(target.top, maxY).toDouble(),
      width: clampedWidth,
      height: clampedHeight,
    );
  }

  @override
  bool operator ==(Object other) {
    return other is WindowGeometry &&
        other.x == x &&
        other.y == y &&
        other.width == width &&
        other.height == height &&
        other.maximized == maximized;
  }

  @override
  int get hashCode => Object.hash(x, y, width, height, maximized);

  @override
  String toString() {
    return 'WindowGeometry(x: $x, y: $y, width: $width, height: $height, '
        'maximized: $maximized)';
  }
}

/// Reads and writes a persisted window geometry.
///
/// The IO implementation stores a small JSON file; the web stub is a no-op.
abstract class WindowGeometryStore {
  Future<WindowGeometry?> load();

  Future<void> save(WindowGeometry geometry);
}

double? _readFiniteDouble(Object? value) {
  if (value is num && value.isFinite) {
    return value.toDouble();
  }
  return null;
}

/// Clamps [value] into `[minimum, maximum]`, degrading gracefully when the
/// display is smaller than the agreed minimum.
double _clampDimension(double value, double minimum, double maximum) {
  if (maximum <= 0) {
    return minimum;
  }
  final lower = minimum <= maximum ? minimum : maximum;
  return value.clamp(lower, maximum).toDouble();
}
