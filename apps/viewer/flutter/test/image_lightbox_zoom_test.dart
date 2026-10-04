import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_lightbox.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  const imagePath = 'noteharbor-zoom-test.png';

  NoteRecord zoomNote({int id = 1, bool withImage = true}) {
    return NoteRecord.fromJson(<String, dynamic>{
      'id': id,
      'displayOrder': id,
      'denomination': 'Test',
      'issueDate': '',
      'catalogNumber': 'KB-$id',
      'gradingCompany': '',
      'grade': '',
      'watermark': '',
      'serial': '',
      'url': '',
      'notes': '',
      'scrapeStatus': 'done',
      'scrapeError': '',
      'tags': <dynamic>[],
      'images': withImage
          ? <dynamic>[
              <String, dynamic>{
                'type': 'front',
                'variant': 'full',
                'filePath': imagePath,
              },
            ]
          : <dynamic>[],
      'scrapedData': null,
    });
  }

  /// Seeds the image cache with a large in-memory image so the popover sees a
  /// natural size much larger than the test viewport, without touching disk.
  Future<void> seedLargeImage(WidgetTester tester) async {
    final image = await tester.runAsync(() => _solidImage(1600, 1000));
    PaintingBinding.instance.imageCache.putIfAbsent(
      FileImage(File(imagePath)),
      () => OneFrameImageStreamCompleter(
        Future<ImageInfo>.value(ImageInfo(image: image!)),
      ),
    );
  }

  Future<void> pumpPopover(WidgetTester tester) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await seedLargeImage(tester);

    final note = zoomNote();
    final items = <ImageSequenceItem>[
      ImageSequenceItem(note: note, image: note.fullFor('front')),
    ];

    await tester.pumpWidget(
      MaterialApp(home: _LightboxLauncher(items: items)),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Future<void> pumpMultiItemPopover(WidgetTester tester) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await seedLargeImage(tester);

    final notes = [zoomNote(id: 1), zoomNote(id: 2)];
    final items = <ImageSequenceItem>[
      for (final note in notes)
        ImageSequenceItem(note: note, image: note.fullFor('front')),
    ];

    await tester.pumpWidget(
      MaterialApp(home: _LightboxLauncher(items: items)),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  List<ImageSequenceItem> frontImageItems(List<NoteRecord> notes) => [
        for (final note in notes)
          ImageSequenceItem(note: note, image: note.fullFor('front')),
      ];

  Future<void> pumpSequence(
    WidgetTester tester,
    List<ImageSequenceItem> items, {
    int initialIndex = 0,
  }) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await seedLargeImage(tester);

    await tester.pumpWidget(
      MaterialApp(
        home: _LightboxLauncher(items: items, initialIndex: initialIndex),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  /// Opens the popover on a sequence of [count] imaged pages.
  Future<void> pumpManyItemPopover(
    WidgetTester tester,
    int count, {
    int initialIndex = 0,
  }) async {
    final notes = <NoteRecord>[
      for (var id = 1; id <= count; id++) zoomNote(id: id),
    ];
    await pumpSequence(
      tester,
      frontImageItems(notes),
      initialIndex: initialIndex,
    );
  }

  /// Opens the popover on a two-page sequence whose final page renders no
  /// image, mirroring a Note whose Note image is missing.
  Future<void> pumpPopoverEndingWithoutImage(WidgetTester tester) async {
    final notes = [zoomNote(id: 1), zoomNote(id: 2, withImage: false)];
    await pumpSequence(tester, frontImageItems(notes));
  }

  testWidgets('mouse wheel zooms in, and back out', (tester) async {
    await pumpPopover(tester);
    expect(_maxZoom(tester), closeTo(1.0, 0.001));

    final pointer = TestPointer(1, PointerDeviceKind.mouse);
    pointer.hover(tester.getCenter(find.byType(Image).first));
    await tester.sendEventToBinding(pointer.scroll(const Offset(0, -120)));
    await tester.pump();

    final zoomedIn = _maxZoom(tester);
    expect(zoomedIn, greaterThan(1.0));

    await tester.sendEventToBinding(pointer.scroll(const Offset(0, 120)));
    await tester.pump();
    expect(_maxZoom(tester), closeTo(1.0, 0.001));
  });

  testWidgets('plus and minus keys zoom in and out', (tester) async {
    await pumpPopover(tester);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.equal);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();
    expect(_maxZoom(tester), greaterThan(1.0));

    await tester.sendKeyEvent(LogicalKeyboardKey.minus);
    await tester.pump();
    expect(_maxZoom(tester), closeTo(1.0, 0.001));
  });

  testWidgets('a narrowing pinch that stops near fit snaps back to fit', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    await _zoomInWithKeyboard(tester);
    expect(_maxZoom(tester), greaterThan(1.0));

    final center = tester.getCenter(find.byType(PageView));
    final first = await tester.startGesture(
      center + const Offset(-200, 0),
      pointer: 1,
    );
    final second = await tester.startGesture(
      center + const Offset(200, 0),
      pointer: 2,
    );

    // Draw the fingers together until the image is within the snap margin of
    // fit but not all the way: without the snap this rests just above 1 and
    // leaves the sequence unswipeable until a double tap.
    await first.moveTo(center + const Offset(-95, 0));
    await second.moveTo(center + const Offset(95, 0));
    await tester.pump();

    expect(_maxZoom(tester), closeTo(1.0, 0.001));

    await first.up();
    await second.up();
    await tester.pumpAndSettle();

    // The sequence is swipeable again without a reset.
    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);
  });

  testWidgets('a narrowing pinch can still stop at a real zoom stop', (
    tester,
  ) async {
    await pumpPopover(tester);
    await _zoomInWithKeyboard(tester);
    expect(_maxZoom(tester), greaterThan(1.0));

    final center = tester.getCenter(find.byType(PageView));
    // Start wider so the pinch lands well outside the snap margin.
    final first = await tester.startGesture(
      center + const Offset(-200, 0),
      pointer: 1,
    );
    final second = await tester.startGesture(
      center + const Offset(200, 0),
      pointer: 2,
    );
    await first.moveTo(center + const Offset(-150, 0));
    await second.moveTo(center + const Offset(150, 0));
    await tester.pump();
    await first.up();
    await second.up();
    await tester.pumpAndSettle();

    expect(_maxZoom(tester), greaterThan(1 + 0.1));
  });

  testWidgets('dragging a zoomed image pans it', (tester) async {
    await pumpPopover(tester);
    await _zoomInWithKeyboard(tester);

    final before = _imageTranslation(tester);
    await tester.drag(find.byType(Image).first, const Offset(-60, 0));
    await tester.pumpAndSettle();
    final after = _imageTranslation(tester);

    expect(after.dx, lessThan(before.dx));
  });

  testWidgets('every interchangeable modifier pans with any arrow or alias', (
    tester,
  ) async {
    // (direction key, whether the pan is horizontal, whether the image's
    // translation grows along that axis)
    const directions = <(LogicalKeyboardKey, bool, bool)>[
      (LogicalKeyboardKey.arrowLeft, true, true),
      (LogicalKeyboardKey.keyH, true, true),
      (LogicalKeyboardKey.arrowRight, true, false),
      (LogicalKeyboardKey.keyL, true, false),
      (LogicalKeyboardKey.arrowUp, false, true),
      (LogicalKeyboardKey.keyK, false, true),
      (LogicalKeyboardKey.arrowDown, false, false),
      (LogicalKeyboardKey.keyJ, false, false),
    ];
    const modifiers = <LogicalKeyboardKey>[
      LogicalKeyboardKey.shiftLeft,
      LogicalKeyboardKey.controlLeft,
      LogicalKeyboardKey.metaLeft,
    ];

    await pumpPopover(tester);
    await _zoomInWithKeyboard(tester);

    for (final modifier in modifiers) {
      for (final (key, horizontal, grows) in directions) {
        final before = _imageTranslation(tester);
        await _pressWithModifier(tester, modifier, key);
        final after = _imageTranslation(tester);
        final delta = horizontal ? after.dx - before.dx : after.dy - before.dy;

        expect(
          grows ? delta > 0 : delta < 0,
          isTrue,
          reason: '$modifier + $key',
        );
      }
    }
  });

  testWidgets('h/l page between images', (tester) async {
    await pumpMultiItemPopover(tester);
    expect(find.text('1 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyH);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
  });

  testWidgets('modified horizontal keys page in fit view, vertical stay put', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    expect(find.text('1 / 2'), findsOneWidget);

    // Vertical modified presses pan nothing and page nothing.
    for (final modifier in const [
      LogicalKeyboardKey.shiftLeft,
      LogicalKeyboardKey.controlLeft,
      LogicalKeyboardKey.metaLeft,
    ]) {
      for (final key in const [
        LogicalKeyboardKey.arrowUp,
        LogicalKeyboardKey.arrowDown,
        LogicalKeyboardKey.keyK,
        LogicalKeyboardKey.keyJ,
      ]) {
        await _pressWithModifier(tester, modifier, key);
        expect(find.text('1 / 2'), findsOneWidget, reason: '$modifier + $key');
      }
    }

    // Every modifier carries both horizontal arrows and their aliases to the
    // neighbouring image, forwards and back.
    for (final modifier in const [
      LogicalKeyboardKey.shiftLeft,
      LogicalKeyboardKey.controlLeft,
      LogicalKeyboardKey.metaLeft,
    ]) {
      for (final (next, previous) in const [
        (LogicalKeyboardKey.arrowRight, LogicalKeyboardKey.arrowLeft),
        (LogicalKeyboardKey.keyL, LogicalKeyboardKey.keyH),
      ]) {
        await _pressWithModifier(tester, modifier, next);
        expect(find.text('2 / 2'), findsOneWidget, reason: '$modifier + $next');

        await _pressWithModifier(tester, modifier, previous);
        expect(
          find.text('1 / 2'),
          findsOneWidget,
          reason: '$modifier + $previous',
        );
      }
    }
  });

  testWidgets('plain Left and Right page in both directions', (tester) async {
    await pumpManyItemPopover(tester, 3, initialIndex: 1);
    expect(find.text('2 / 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('2 / 3'), findsOneWidget);
  });

  testWidgets('alt + any arrow or h/j/k/l stays inert', (tester) async {
    const altKeys = [
      LogicalKeyboardKey.arrowLeft,
      LogicalKeyboardKey.arrowRight,
      LogicalKeyboardKey.arrowUp,
      LogicalKeyboardKey.arrowDown,
      LogicalKeyboardKey.keyH,
      LogicalKeyboardKey.keyJ,
      LogicalKeyboardKey.keyK,
      LogicalKeyboardKey.keyL,
    ];

    await pumpMultiItemPopover(tester);
    expect(find.text('1 / 2'), findsOneWidget);

    // In fit view even the keys that would page stay inert.
    for (final key in altKeys) {
      await _pressWithModifier(tester, LogicalKeyboardKey.altLeft, key);
      expect(find.text('1 / 2'), findsOneWidget, reason: 'fit, alt + $key');
    }

    await _zoomInWithKeyboard(tester);
    final before = _imageTranslation(tester);

    for (final key in altKeys) {
      await _pressWithModifier(tester, LogicalKeyboardKey.altLeft, key);
      expect(_imageTranslation(tester), before, reason: 'zoom, alt + $key');
      expect(find.text('1 / 2'), findsOneWidget, reason: 'zoom, alt + $key');
    }
  });

  testWidgets('escape resets zoom before closing the popover', (tester) async {
    await pumpPopover(tester);
    await _zoomInWithKeyboard(tester);
    expect(_maxZoom(tester), greaterThan(1.0));

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(_maxZoom(tester), closeTo(1.0, 0.001));
    expect(find.text('Back'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('arrow left on the first image wraps to the last image', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    expect(find.text('1 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);
  });

  testWidgets('arrow right on the last image wraps to the first image', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
  });

  testWidgets('home jumps to the first page', (tester) async {
    await pumpManyItemPopover(tester, 5, initialIndex: 4);
    expect(find.text('5 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();

    expect(find.text('1 / 5'), findsOneWidget);
    expect(find.text('Test - KB-1'), findsOneWidget);
  });

  testWidgets('end jumps to the last page', (tester) async {
    await pumpManyItemPopover(tester, 5);
    expect(find.text('1 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('5 / 5'), findsOneWidget);
    expect(find.text('Test - KB-5'), findsOneWidget);
  });

  testWidgets('end lands on the last page even when it renders no image', (
    tester,
  ) async {
    await pumpPopoverEndingWithoutImage(tester);
    expect(find.text('1 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('2 / 2'), findsOneWidget);
    expect(find.text('Test - KB-2'), findsOneWidget);
    expect(find.text('No image'), findsOneWidget);
  });

  testWidgets('end reaches the last page in one frame, not an animation', (
    tester,
  ) async {
    // A collection large enough that animating to the end would be obvious.
    await pumpManyItemPopover(tester, 40);
    expect(find.text('1 / 40'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    // A single frame: an animated transition would still be in flight and the
    // index pill would not have moved to the endpoint yet.
    await tester.pump();
    expect(find.text('40 / 40'), findsOneWidget);
  });

  testWidgets('a wrap-around glides across the seam like a swipe', (
    tester,
  ) async {
    await pumpManyItemPopover(tester, 3);
    expect(find.text('1 / 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    // A single frame: the wrap animates across the seam, so the index pill has
    // not reached the wrapped page yet (a jump would have moved it).
    await tester.pump();
    expect(find.text('1 / 3'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.text('Test - KB-3'), findsOneWidget);
  });

  testWidgets('an adjacent arrow step animates rather than jumping', (
    tester,
  ) async {
    await pumpManyItemPopover(tester, 3, initialIndex: 1);
    expect(find.text('2 / 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    // A single frame: the animated step is still in flight, so the index pill
    // has not reached the next page yet (a jump would have moved it).
    await tester.pump();
    expect(find.text('2 / 3'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('3 / 3'), findsOneWidget);
  });

  testWidgets('home and end still move between pages while zoomed', (
    tester,
  ) async {
    await pumpManyItemPopover(tester, 3);
    await _zoomInWithKeyboard(tester);
    expect(_maxZoom(tester), greaterThan(1.0));

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.text('Test - KB-3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
    expect(find.text('Test - KB-1'), findsOneWidget);
  });

  testWidgets('home on the first page changes nothing', (tester) async {
    await pumpManyItemPopover(tester, 5);
    expect(find.text('1 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();

    expect(find.text('1 / 5'), findsOneWidget);
  });

  testWidgets('end on the last page changes nothing', (tester) async {
    await pumpManyItemPopover(tester, 5, initialIndex: 4);
    expect(find.text('5 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('5 / 5'), findsOneWidget);
  });

  testWidgets('home and end change nothing with a single page', (
    tester,
  ) async {
    await pumpPopover(tester);
    expect(find.text('1 / 1'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('1 / 1'), findsOneWidget);
  });

  testWidgets('modified home and end do nothing', (tester) async {
    await pumpManyItemPopover(tester, 5, initialIndex: 2);
    expect(find.text('3 / 5'), findsOneWidget);

    for (final modifier in const [
      LogicalKeyboardKey.controlLeft,
      LogicalKeyboardKey.metaLeft,
      LogicalKeyboardKey.altLeft,
    ]) {
      await tester.sendKeyDownEvent(modifier);
      await tester.sendKeyEvent(LogicalKeyboardKey.home);
      await tester.sendKeyEvent(LogicalKeyboardKey.end);
      await tester.sendKeyUpEvent(modifier);
      await tester.pumpAndSettle();

      expect(find.text('3 / 5'), findsOneWidget);
    }
  });
}

Future<void> _zoomInWithKeyboard(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.equal);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pump();
}

Future<void> _pressWithModifier(
  WidgetTester tester,
  LogicalKeyboardKey modifier,
  LogicalKeyboardKey key,
) async {
  await tester.sendKeyDownEvent(modifier);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(modifier);
  await tester.pumpAndSettle();
}

Future<ui.Image> _solidImage(int width, int height) async {
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  canvas.drawRect(
    ui.Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    ui.Paint()..color = const ui.Color(0xFF3366AA),
  );
  final picture = recorder.endRecording();
  return picture.toImage(width, height);
}

double _maxZoom(WidgetTester tester) {
  var maxZoom = 1.0;
  for (final element in find.byType(Transform).evaluate()) {
    final transform = (element.widget as Transform).transform;
    maxZoom = math.max(maxZoom, transform.getMaxScaleOnAxis());
  }
  return maxZoom;
}

Offset _imageTranslation(WidgetTester tester) {
  final transforms = tester.widgetList<Transform>(
    find.ancestor(
      of: find.byType(Image).first,
      matching: find.byType(Transform),
    ),
  );
  for (final transform in transforms) {
    if ((transform.transform.getMaxScaleOnAxis() - 1).abs() < 0.001) {
      final translation = transform.transform.getTranslation();
      return Offset(translation.x, translation.y);
    }
  }
  return Offset.zero;
}

class _LightboxLauncher extends StatelessWidget {
  const _LightboxLauncher({required this.items, this.initialIndex = 0});

  final List<ImageSequenceItem> items;
  final int initialIndex;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<int>(
              builder: (_) =>
                  ImageLightbox(items: items, initialIndex: initialIndex),
            ),
          ),
          child: const Text('open'),
        ),
      ),
    );
  }
}
