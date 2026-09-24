/// Zoom stops for the Image popover.
///
/// Mirrors the Editor's `POPOVER_ZOOM_LEVELS` ([1, 1.25, 1.5, 2, 3, 4]), but
/// expressed as multiples of the image's natural (1:1) scale rather than as
/// absolute scales. The fit view is always the first stop, so the popover is
/// never shown smaller than fit.
const List<double> kImageZoomLevels = <double>[1, 1.25, 1.5, 2, 3, 4];

/// Zoom stops for an image whose natural 1:1 size is [realSizeScale] times its
/// fit size, capped at [maxScale].
///
/// Stops are clamped to `[fitScale, maxScale]`, deduplicated, and returned in
/// ascending order. When [realSizeScale] does not exceed [fitScale] the image
/// cannot be zoomed and the only stop is the fit view.
List<double> imageZoomStops({
  required double realSizeScale,
  required double maxScale,
  double fitScale = 1,
}) {
  final stops = <double>[fitScale];
  if (realSizeScale > fitScale) {
    for (final level in kImageZoomLevels) {
      stops.add(realSizeScale * level);
    }
  }
  return _normalizeStops(stops, minScale: fitScale, maxScale: maxScale);
}

/// The next stop above [currentScale], or null when already at the top stop.
double? nextImageZoomStop(
  List<double> stops,
  double currentScale, {
  double epsilon = 1e-3,
}) {
  for (final stop in stops) {
    if (stop > currentScale + epsilon) {
      return stop;
    }
  }
  return null;
}

/// The next stop below [currentScale], or null when already at the bottom stop.
double? previousImageZoomStop(
  List<double> stops,
  double currentScale, {
  double epsilon = 1e-3,
}) {
  double? result;
  for (final stop in stops) {
    if (stop < currentScale - epsilon) {
      result = stop;
    }
  }
  return result;
}

List<double> _normalizeStops(
  List<double> stops, {
  required double minScale,
  required double maxScale,
}) {
  final normalized = <double>[];
  for (final raw in stops) {
    final value = raw.clamp(minScale, maxScale);
    if (normalized.isEmpty || (value - normalized.last).abs() > 1e-6) {
      normalized.add(value);
    }
  }
  return normalized;
}
