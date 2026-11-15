/// Zoom stops for the Image popover, as multiples of the fitted image.
///
/// Mirrors the Editor's ladder (`apps/editor/ui-react/src/components/
/// Slideshow.jsx`): the first step above fit grows the image by a quarter, so a
/// large scan is not thrown straight to 1:1. Actual size is not on the ladder;
/// the header's 1:1 stop lands on the scan's real size from any rung.
const List<double> kImageZoomLevels = <double>[1, 1.25, 1.5, 2, 3, 4];

/// The stops for a scan whose natural 1:1 size is [realSizeScale] times its
/// fit size.
///
/// A scan that fit already draws at or above its natural size has no more
/// pixels to reveal, so the fit view is its only stop.
List<double> imageZoomStops({required double realSizeScale}) {
  if (realSizeScale <= 1) {
    return const <double>[1];
  }
  return kImageZoomLevels;
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
