/// Zoom stops for the Image popover, as multiples of the fitted image.
///
/// Mirrors the Editor's `POPOVER_ZOOM_LEVELS` ([1, 1.25, 1.5, 2, 3, 4]): the
/// first step above the fit view grows the image by a quarter, so a scan that
/// fits at a fraction of its natural size is not thrown straight to 1:1. The
/// fit view is always the first stop, so the popover is never shown smaller
/// than fit. Actual size is not on this ladder; the header's own 1:1 stop
/// lands on the scan's real size from wherever the ladder is.
const List<double> kImageZoomLevels = <double>[1, 1.25, 1.5, 2, 3, 4];

/// The ladder capped at [maxScale], in ascending order.
///
/// A stop above the cap is folded onto the cap and deduplicated, so the
/// stepper never offers a scale the pinch's own limit would refuse.
List<double> imageZoomStops({required double maxScale}) {
  final ceiling = maxScale < 1 ? 1.0 : maxScale;
  final stops = <double>[];
  for (final level in kImageZoomLevels) {
    final value = level < ceiling ? level : ceiling;
    if (stops.isEmpty || (value - stops.last).abs() > 1e-6) {
      stops.add(value);
    }
  }
  return stops;
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
