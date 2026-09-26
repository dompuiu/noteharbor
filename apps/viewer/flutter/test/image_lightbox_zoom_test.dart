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

  NoteRecord zoomNote({int id = 1}) {
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
      'images': <dynamic>[
        <String, dynamic>{
          'type': 'front',
          'variant': 'full',
          'filePath': imagePath,
        },
      ],
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
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();
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
}

Future<void> _zoomInWithKeyboard(WidgetTester tester) async {
  await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
  await tester.sendKeyEvent(LogicalKeyboardKey.equal);
  await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
  await tester.pump();
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
  const _LightboxLauncher({required this.items});

  final List<ImageSequenceItem> items;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<int>(
              builder: (_) => ImageLightbox(items: items, initialIndex: 0),
            ),
          ),
          child: const Text('open'),
        ),
      ),
    );
  }
}
