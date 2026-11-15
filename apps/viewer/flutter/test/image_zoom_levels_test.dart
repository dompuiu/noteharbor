import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_zoom_levels.dart';

void main() {
  group('imageZoomStops', () {
    test('steps up from the fitted image in the Editor ladder', () {
      expect(
        imageZoomStops(maxScale: 12),
        <double>[1, 1.25, 1.5, 2, 3, 4],
      );
    });

    test('caps the ladder and folds every higher stop onto the cap', () {
      expect(
        imageZoomStops(maxScale: 3),
        <double>[1, 1.25, 1.5, 2, 3],
      );
      expect(imageZoomStops(maxScale: 1.5), <double>[1, 1.25, 1.5]);
    });

    test('never drops below the fit view', () {
      expect(imageZoomStops(maxScale: 0.5), <double>[1]);
    });
  });

  group('stop stepping', () {
    const stops = <double>[1, 1.25, 1.5, 2, 3, 4];

    test('next steps up through the stops', () {
      expect(nextImageZoomStop(stops, 1), 1.25);
      expect(nextImageZoomStop(stops, 1.25), 1.5);
      expect(nextImageZoomStop(stops, 3), 4);
      expect(nextImageZoomStop(stops, 4), isNull);
    });

    test('previous steps down through the stops', () {
      expect(previousImageZoomStop(stops, 4), 3);
      expect(previousImageZoomStop(stops, 1.25), 1);
      expect(previousImageZoomStop(stops, 1), isNull);
    });

    test('steps from off-stop scales (pinch/1:1) to the nearest', () {
      expect(nextImageZoomStop(stops, 2.5), 3);
      expect(previousImageZoomStop(stops, 2.5), 2);
    });
  });
}
