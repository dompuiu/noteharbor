import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_zoom_levels.dart';

void main() {
  group('imageZoomStops', () {
    test('offers only the fit view when the image cannot be magnified', () {
      expect(
        imageZoomStops(realSizeScale: 1, maxScale: 12),
        <double>[1],
      );
      expect(
        imageZoomStops(realSizeScale: 0.5, maxScale: 12),
        <double>[1],
      );
    });

    test('places natural size after fit, then the editor levels', () {
      expect(
        imageZoomStops(realSizeScale: 4, maxScale: 12),
        <double>[1, 4, 5, 6, 8, 12],
      );
    });

    test('clamps and deduplicates stops above the cap', () {
      expect(
        imageZoomStops(realSizeScale: 6, maxScale: 12),
        <double>[1, 6, 7.5, 9, 12],
      );
    });

    test('never drops below the fit view', () {
      final stops = imageZoomStops(realSizeScale: 3, maxScale: 12);
      expect(stops.first, 1);
      expect(stops, <double>[1, 3, 3.75, 4.5, 6, 9, 12]);
    });
  });

  group('stop stepping', () {
    const stops = <double>[1, 4, 5, 6, 8, 12];

    test('next steps up through the stops', () {
      expect(nextImageZoomStop(stops, 1), 4);
      expect(nextImageZoomStop(stops, 4), 5);
      expect(nextImageZoomStop(stops, 11), 12);
      expect(nextImageZoomStop(stops, 12), isNull);
    });

    test('previous steps down through the stops', () {
      expect(previousImageZoomStop(stops, 12), 8);
      expect(previousImageZoomStop(stops, 4), 1);
      expect(previousImageZoomStop(stops, 1), isNull);
    });

    test('steps from off-stop scales (pinch/double-tap) to the nearest', () {
      expect(nextImageZoomStop(stops, 4.5), 5);
      expect(previousImageZoomStop(stops, 4.5), 4);
    });
  });
}
