import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/window/window_geometry.dart';

void main() {
  // A typical dual-monitor desktop: primary at the origin, a second display
  // to its right. Taskbars/borders are already accounted for in the visible
  // rects, mirroring what screen_retriever reports.
  final primary = Rect.fromLTWH(0, 0, 1920, 1040);
  final secondary = Rect.fromLTWH(1920, 0, 1920, 1040);

  group('defaults', () {
    test('use an iPhone-sized portrait window at (10, 10)', () {
      expect(WindowGeometry.defaults.width, 393);
      expect(WindowGeometry.defaults.height, 852);
      expect(WindowGeometry.defaults.x, 10);
      expect(WindowGeometry.defaults.y, 10);
      expect(WindowGeometry.defaults.maximized, isFalse);
    });

    test('expose the agreed minimum size', () {
      expect(WindowGeometry.minimumWidth, 320);
      expect(WindowGeometry.minimumHeight, 480);
    });
  });

  group('maximized platform rule', () {
    test('is remembered on Windows only while maximized', () {
      expect(
        WindowGeometry.remembersMaximizedState(
          isWindows: true,
          maximized: true,
        ),
        isTrue,
      );
      expect(
        WindowGeometry.remembersMaximizedState(
          isWindows: true,
          maximized: false,
        ),
        isFalse,
      );
    });

    test('is ignored on macOS even while maximized', () {
      expect(
        WindowGeometry.remembersMaximizedState(
          isWindows: false,
          maximized: true,
        ),
        isFalse,
      );
    });
  });

  group('json codec', () {
    test('round-trips a geometry', () {
      const geometry = WindowGeometry(
        x: 120,
        y: 80,
        width: 640,
        height: 900,
        maximized: true,
      );

      final decoded = WindowGeometry.tryFromJson(geometry.toJson());

      expect(decoded, geometry);
    });

    test('writes a schema version', () {
      expect(WindowGeometry.defaults.toJson()['version'], 1);
    });

    test('returns null for a non-map payload', () {
      expect(WindowGeometry.tryFromJson(null), isNull);
      expect(WindowGeometry.tryFromJson('not json'), isNull);
      expect(WindowGeometry.tryFromJson(<Object?>[]), isNull);
    });

    test('returns null when a required key is missing', () {
      expect(
        WindowGeometry.tryFromJson(<String, Object?>{
          'version': 1,
          'x': 10,
          'y': 10,
          'width': 393,
        }),
        isNull,
      );
    });

    test('returns null for wrong value types', () {
      expect(
        WindowGeometry.tryFromJson(<String, Object?>{
          'version': 1,
          'x': 'ten',
          'y': 10,
          'width': 393,
          'height': 852,
        }),
        isNull,
      );
    });

    test('returns null for a non-positive size', () {
      expect(
        WindowGeometry.tryFromJson(<String, Object?>{
          'version': 1,
          'x': 10,
          'y': 10,
          'width': 0,
          'height': 852,
        }),
        isNull,
      );
    });

    test('returns null for an unknown schema version', () {
      expect(
        WindowGeometry.tryFromJson(<String, Object?>{
          'version': 99,
          'x': 10,
          'y': 10,
          'width': 393,
          'height': 852,
        }),
        isNull,
      );
    });

    test('treats a missing maximized flag as false', () {
      final decoded = WindowGeometry.tryFromJson(<String, Object?>{
        'version': 1,
        'x': 10,
        'y': 10,
        'width': 393,
        'height': 852,
      });

      expect(decoded?.maximized, isFalse);
    });

    test('returns null for a non-boolean maximized flag', () {
      expect(
        WindowGeometry.tryFromJson(<String, Object?>{
          'version': 1,
          'x': 10,
          'y': 10,
          'width': 393,
          'height': 852,
          'maximized': 'true',
        }),
        isNull,
      );
    });
  });

  group('clampToDisplays', () {
    test('falls back to the default position when nothing is known', () {
      // A display lookup failure must not re-apply a possibly off-screen
      // position saved on a monitor that is no longer attached.
      const geometry = WindowGeometry(
        x: 5000,
        y: 5000,
        width: 393,
        height: 852,
        maximized: true,
      );

      final clamped = geometry.clampToDisplays(const <Rect>[]);

      expect(clamped.x, WindowGeometry.defaultX);
      expect(clamped.y, WindowGeometry.defaultY);
      expect(clamped.width, 393);
      expect(clamped.height, 852);
      expect(clamped.maximized, isTrue);
    });

    test('leaves an on-screen window untouched', () {
      const geometry = WindowGeometry(x: 100, y: 100, width: 393, height: 852);

      expect(geometry.clampToDisplays(<Rect>[primary, secondary]), geometry);
    });

    test('pulls a partly off-screen window back inside the display', () {
      const geometry = WindowGeometry(x: 1800, y: 100, width: 393, height: 852);

      final clamped = geometry.clampToDisplays(<Rect>[primary]);

      expect(clamped.x, 1920 - 393);
      expect(clamped.y, 100);
      expect(clamped.width, 393);
      expect(clamped.height, 852);
    });

    test('enforces the minimum size', () {
      const geometry = WindowGeometry(x: 50, y: 50, width: 100, height: 100);

      final clamped = geometry.clampToDisplays(<Rect>[primary]);

      expect(clamped.width, 320);
      expect(clamped.height, 480);
      expect(clamped.x, 50);
      expect(clamped.y, 50);
    });

    test('shrinks a window larger than the display', () {
      const geometry = WindowGeometry(x: 0, y: 0, width: 3000, height: 2000);

      final clamped = geometry.clampToDisplays(<Rect>[primary]);

      expect(clamped.width, 1920);
      expect(clamped.height, 1040);
      expect(clamped.x, 0);
      expect(clamped.y, 0);
    });

    test('relocates a window saved beyond every display', () {
      const geometry = WindowGeometry(x: 5000, y: 5000, width: 393, height: 852);

      final clamped = geometry.clampToDisplays(<Rect>[primary]);

      expect(clamped.x, 10);
      expect(clamped.y, 10);
      expect(clamped.width, 393);
      expect(clamped.height, 852);
    });

    test('relocates a window from a disconnected second display', () {
      // Saved on a monitor that no longer exists; only the primary remains.
      const geometry = WindowGeometry(x: 2000, y: 100, width: 393, height: 852);

      final clamped = geometry.clampToDisplays(<Rect>[primary]);

      expect(clamped.x, 10);
      expect(clamped.y, 10);
    });

    test('keeps a window on its second display when it still exists', () {
      const geometry = WindowGeometry(x: 2000, y: 100, width: 393, height: 852);

      final clamped = geometry.clampToDisplays(<Rect>[primary, secondary]);

      expect(clamped, geometry);
    });

    test('preserves the maximized flag', () {
      const geometry = WindowGeometry(
        x: 5000,
        y: 5000,
        width: 393,
        height: 852,
        maximized: true,
      );

      expect(geometry.clampToDisplays(<Rect>[primary]).maximized, isTrue);
    });

    test('ignores zero-sized displays', () {
      const geometry = WindowGeometry(x: 100, y: 100, width: 393, height: 852);

      final clamped = geometry.clampToDisplays(<Rect>[
        Rect.fromLTWH(0, 0, 0, 0),
        primary,
      ]);

      expect(clamped, geometry);
    });
  });
}
