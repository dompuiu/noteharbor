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

  testWidgets('dragging a zoomed image pans it', (tester) async {
    await pumpPopover(tester);
    await _zoomInWithKeyboard(tester);

    final before = _imageTranslation(tester);
    await tester.drag(find.byType(Image).first, const Offset(-60, 0));
    await tester.pumpAndSettle();
    final after = _imageTranslation(tester);

    expect(after.dx, lessThan(before.dx));
  });

  testWidgets('shift + arrow keys pan a zoomed image', (tester) async {
    await pumpPopover(tester);
    await _zoomInWithKeyboard(tester);

    final before = _imageTranslation(tester);
    await _panWithKeyboard(tester, LogicalKeyboardKey.arrowRight);
    final after = _imageTranslation(tester);

    expect(after.dx, lessThan(before.dx));
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

  testWidgets('shift + arrow keys do not navigate while in fit view', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    expect(find.text('1 / 2'), findsOneWidget);

    await _panWithKeyboard(tester, LogicalKeyboardKey.arrowRight);
    expect(find.text('1 / 2'), findsOneWidget);

    await _panWithKeyboard(tester, LogicalKeyboardKey.arrowLeft);
    expect(find.text('1 / 2'), findsOneWidget);
  });

  testWidgets('arrow left on the first image stays on the first image', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    expect(find.text('1 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
  });

  testWidgets('arrow right on the last image stays on the last image', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);
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

Future<void> _panWithKeyboard(
  WidgetTester tester,
  LogicalKeyboardKey key,
) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(key);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
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
