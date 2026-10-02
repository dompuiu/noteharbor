import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_lightbox.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  const imagePath = 'noteharbor-pointer-test.png';

  NoteRecord pointerNote({required int id}) {
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

  /// Seeds the image cache with a large in-memory image so the zoomable page
  /// resolves without touching disk (mirrors the zoom tests).
  Future<void> seedLargeImage(WidgetTester tester) async {
    final image = await tester.runAsync(() => _solidImage(1600, 1000));
    PaintingBinding.instance.imageCache.putIfAbsent(
      FileImage(File(imagePath)),
      () => OneFrameImageStreamCompleter(
        Future<ImageInfo>.value(ImageInfo(image: image!)),
      ),
    );
  }

  Future<void> pumpLightbox(
    WidgetTester tester, {
    required int count,
    int initialIndex = 0,
  }) async {
    tester.view.physicalSize = const Size(800, 600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await seedLargeImage(tester);

    final notes = [for (var id = 1; id <= count; id++) pointerNote(id: id)];
    final items = <ImageSequenceItem>[
      for (final note in notes)
        ImageSequenceItem(note: note, image: note.fullFor('front')),
    ];

    await tester.pumpWidget(
      MaterialApp(
        home: _LightboxLauncher(items: items, initialIndex: initialIndex),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Future<void> mouseDrag(WidgetTester tester, Offset delta) async {
    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(PageView)),
      kind: PointerDeviceKind.mouse,
    );
    await gesture.moveBy(delta);
    await gesture.up();
    await tester.pumpAndSettle();
  }

  testWidgets('a mouse drag left and right pages between images', (
    WidgetTester tester,
  ) async {
    await pumpLightbox(tester, count: 3, initialIndex: 1);
    expect(find.text('2 / 3'), findsOneWidget);

    await mouseDrag(tester, const Offset(-600, 0));
    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.text('Test - KB-3'), findsOneWidget);

    await mouseDrag(tester, const Offset(600, 0));
    expect(find.text('2 / 3'), findsOneWidget);
    expect(find.text('Test - KB-2'), findsOneWidget);
  });

  testWidgets('a rightward mouse drag wraps from the first to the last image', (
    WidgetTester tester,
  ) async {
    await pumpLightbox(tester, count: 3);
    expect(find.text('1 / 3'), findsOneWidget);

    await mouseDrag(tester, const Offset(600, 0));

    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.text('Test - KB-3'), findsOneWidget);
  });

  testWidgets('a leftward mouse drag wraps from the last to the first image', (
    WidgetTester tester,
  ) async {
    await pumpLightbox(tester, count: 3, initialIndex: 2);
    expect(find.text('3 / 3'), findsOneWidget);

    await mouseDrag(tester, const Offset(-600, 0));

    expect(find.text('1 / 3'), findsOneWidget);
    expect(find.text('Test - KB-1'), findsOneWidget);
  });

  testWidgets('a touch swipe wraps at both ends', (WidgetTester tester) async {
    await pumpLightbox(tester, count: 3);
    expect(find.text('1 / 3'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(600, 0));
    await tester.pumpAndSettle();
    expect(find.text('3 / 3'), findsOneWidget);

    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
  });
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
