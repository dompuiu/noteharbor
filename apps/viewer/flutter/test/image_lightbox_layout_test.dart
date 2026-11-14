import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_lightbox.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

/// The Image popover's composition, not its chrome: where the mat sits on the
/// stage. A portrait window hugs the scan with a white plate and 16px of
/// padding; a room window keeps the whole-note fit on a mat that fills the
/// stage.
void main() {
  const landscapePath = 'noteharbor-layout-landscape.png';
  const portraitPath = 'noteharbor-layout-portrait.png';

  NoteRecord layoutNote({String file = landscapePath}) {
    return NoteRecord.fromJson(<String, dynamic>{
      'id': 1,
      'displayOrder': 1,
      'denomination': 'Test',
      'issueDate': '',
      'catalogNumber': 'KB-1',
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
        <String, dynamic>{'type': 'front', 'variant': 'full', 'filePath': file},
      ],
      'scrapedData': null,
    });
  }

  /// Seeds the image cache so the page can measure a scan without touching
  /// disk. The real dataset is nearly all 3:2 landscape; the tall scan proves
  /// the plate still fits a portrait artifact whole.
  Future<void> seedImage(
    WidgetTester tester,
    String path,
    int width,
    int height,
  ) async {
    final image = await tester.runAsync(() => _solidImage(width, height));
    PaintingBinding.instance.imageCache.putIfAbsent(
      FileImage(File(path)),
      () => OneFrameImageStreamCompleter(
        Future<ImageInfo>.value(ImageInfo(image: image!)),
      ),
    );
  }

  Future<void> pumpPopover(
    WidgetTester tester,
    Size size, {
    String file = landscapePath,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await seedImage(tester, landscapePath, 1600, 1000);
    await seedImage(tester, portraitPath, 800, 2000);

    final note = layoutNote(file: file);
    await tester.pumpWidget(
      MaterialApp(
        key: ValueKey<String>('$size-$file'),
        home: _LightboxLauncher(
          items: [
            ImageSequenceItem(
              note: note,
              image: note.fullFor('front'),
              face: 'front',
            ),
          ],
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Finder plate() => find.byKey(const ValueKey('imagePlate'));

  /// The box a page fits its scan into: the stage minus the page's own 12px
  /// side and 4px top padding, on the stage as measured.
  Size fitBox(WidgetTester tester, {required bool plateHugs}) {
    final stage = tester.getRect(find.byType(PageView));
    final width = stage.width - 24 - (plateHugs ? 32 : 0);
    final height = stage.height - 4 - (plateHugs ? 32 : 0);
    return Size(width, height);
  }

  Size fittedScan(Size box, Size scan) {
    final scale = math.min(box.width / scan.width, box.height / scan.height);
    return Size(scan.width * scale, scan.height * scale);
  }

  for (final size in const [Size(578, 1096), Size(390, 844)]) {
    testWidgets('a portrait window at $size hugs the mat to the scan', (
      tester,
    ) async {
      await pumpPopover(tester, size);

      final imageRect = tester.getRect(find.byType(Image).first);
      final plateRect = tester.getRect(plate().first);
      final expected = fittedScan(
        fitBox(tester, plateHugs: true),
        const Size(1600, 1000),
      );

      // The scan is fitted into the stage inside the plate's padding.
      expect(imageRect.width, closeTo(expected.width, 0.5));
      expect(imageRect.height, closeTo(expected.height, 0.5));
      expect(imageRect.width / imageRect.height, closeTo(1.6, 0.001));

      // The plate is the artifact plus 16px on every side, not the stage.
      expect(plateRect.width, closeTo(imageRect.width + 32, 0.5));
      expect(plateRect.height, closeTo(imageRect.height + 32, 0.5));
      expect(plateRect.center, offsetMoreOrLessEquals(imageRect.center));
      expect(plateRect.center.dx, closeTo(size.width / 2, 1));

      // The room's mat is not the whole stage: this is the regression the
      // task fixes, a note no longer a thumbnail in a metre of white.
      final stage = tester.getRect(find.byType(PageView));
      expect(plateRect.height, lessThan(stage.height * 0.6));

      // It still reads larger than one plate of the slideshow's pair, which
      // splits the slide's width in two on the same window.
      expect(imageRect.width, greaterThan(size.width * 0.6));

      // The face chip sits on the plate's corner, as the slideshow's does.
      final chipRect = tester.getRect(find.text('FRONT'));
      expect(plateRect.contains(chipRect.center), isTrue);
      expect(chipRect.left - plateRect.left, lessThan(24));
      expect(chipRect.top - plateRect.top, lessThan(24));
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('a scan taller than the stage still fits whole in portrait', (
    tester,
  ) async {
    const size = Size(390, 844);
    await pumpPopover(tester, size, file: portraitPath);

    final imageRect = tester.getRect(find.byType(Image).first);
    final plateRect = tester.getRect(plate().first);
    final stage = tester.getRect(find.byType(PageView));
    final expected = fittedScan(
      fitBox(tester, plateHugs: true),
      const Size(800, 2000),
    );

    expect(imageRect.height, closeTo(expected.height, 0.5));
    expect(imageRect.height, lessThanOrEqualTo(stage.height));
    expect(imageRect.top, greaterThanOrEqualTo(stage.top));
    expect(imageRect.bottom, lessThanOrEqualTo(stage.bottom));
    expect(plateRect.top, greaterThanOrEqualTo(stage.top - 0.5));
    expect(plateRect.bottom, lessThanOrEqualTo(stage.bottom + 0.5));
    expect(plateRect.width, closeTo(imageRect.width + 32, 0.5));
    expect(plateRect.height, closeTo(imageRect.height + 32, 0.5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a zoomed portrait page still pans inside the whole stage', (
    tester,
  ) async {
    const size = Size(390, 844);
    await pumpPopover(tester, size);

    final fittedRect = tester.getRect(find.byType(Image).first);
    final stage = tester.getRect(find.byType(PageView));

    await tester.tap(find.text('1:1'));
    await tester.pumpAndSettle();

    // The plate stops hugging: the stage is the card once the page is above
    // fit, so the zoom pans against the room rather than a thumbnail card.
    final plateRect = tester.getRect(plate().first);
    expect(plateRect.width, closeTo(stage.width - 24, 0.5));
    expect(plateRect.height, closeTo(stage.height - 4, 0.5));
    expect(
      tester.getRect(find.byType(Image).first).width,
      greaterThan(fittedRect.width),
    );
    expect(tester.takeException(), isNull);
  });

  for (final size in const [Size(1440, 900), Size(1024, 768)]) {
    testWidgets('a room window at $size keeps the whole-note mat', (
      tester,
    ) async {
      await pumpPopover(tester, size);

      // The room wears its 16px inset and the mat is the page, not the scan.
      final roomRect = tester.getRect(find.byKey(const ValueKey('imageRoom')));
      expect(roomRect.left, closeTo(16, 0.5));
      expect(roomRect.top, closeTo(16, 0.5));
      expect(roomRect.width, closeTo(size.width - 32, 0.5));
      expect(roomRect.height, closeTo(size.height - 32, 0.5));

      expect(plate(), findsNothing);
      final matRect = tester.getRect(find.byKey(const ValueKey('imageMat')));
      final stage = tester.getRect(find.byType(PageView));
      expect(matRect.left, closeTo(stage.left + 12, 0.5));
      expect(matRect.right, closeTo(stage.right - 12, 0.5));

      // The scan fits whole inside the mat's 16px padding (and its 1px
      // hairline, which sits inside the mat's bounds).
      final imageRect = tester.getRect(find.byType(Image).first);
      final expected = fittedScan(
        Size(matRect.width - 34, matRect.height - 34),
        const Size(1600, 1000),
      );
      expect(imageRect.width, closeTo(expected.width, 0.5));
      expect(imageRect.height, closeTo(expected.height, 0.5));
      expect(imageRect.left, greaterThanOrEqualTo(matRect.left + 16 - 0.5));
      expect(imageRect.top, greaterThanOrEqualTo(matRect.top + 16 - 0.5));
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('the room guard is the slideshow\'s on both edges', (
    tester,
  ) async {
    for (final (size, roomed) in const [
      (Size(760, 560), true),
      (Size(759, 560), false),
      (Size(760, 559), false),
      (Size(700, 1000), false),
    ]) {
      await pumpPopover(tester, size);
      final roomRect = tester.getRect(find.byKey(const ValueKey('imageRoom')));
      expect(
        roomRect,
        roomed ? const Rect.fromLTWH(16, 16, 728, 528) : Offset.zero & size,
        reason: '$size',
      );
    }
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
  const _LightboxLauncher({required this.items});

  final List<ImageSequenceItem> items;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () => Navigator.of(context).push<int>(
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
