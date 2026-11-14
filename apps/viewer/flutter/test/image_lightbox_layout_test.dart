import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_lightbox.dart';
import 'package:note_harbor_viewer/features/slideshow/note_slideshow_screen.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

/// The Image popover's composition, not its chrome: where the mat sits on the
/// stage. A portrait window hugs the scan with a white plate and 16px of
/// padding; a room window keeps the whole-note fit on a mat that fills the
/// stage.
void main() {
  const landscapePath = 'noteharbor-layout-landscape.png';
  const portraitPath = 'noteharbor-layout-portrait.png';
  const widePath = 'noteharbor-layout-wide.png';

  final plate = find.byKey(const ValueKey('imagePlate'));
  final mat = find.byKey(const ValueKey('imageMat'));
  final room = find.byKey(const ValueKey('imageRoom'));

  setUpAll(() async {
    // The slideshow comparison measures with Inter's real line widths.
    final loader = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/InterVariable.ttf'));
    await loader.load();
  });

  NoteRecord layoutNote({
    String file = landscapePath,
    int id = 1,
    String catalog = 'KB-1',
  }) {
    return NoteRecord.fromJson(<String, dynamic>{
      'id': id,
      'displayOrder': 1,
      'denomination': 'Test',
      'issueDate': '1993',
      'catalogNumber': catalog,
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
  /// disk. The real dataset is nearly all 3:2 landscape; the tall and the wide
  /// scans prove the plate fits unusual artifacts whole.
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

  Future<void> seedScans(WidgetTester tester) async {
    await seedImage(tester, landscapePath, 1600, 1000);
    await seedImage(tester, portraitPath, 800, 2000);
    await seedImage(tester, widePath, 4000, 1000);
  }

  /// Pumps the popover at [size], without touching the image cache, so a test
  /// can hold its own image load.
  Future<void> pumpLightbox(
    WidgetTester tester,
    Size size, {
    String file = landscapePath,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final note = layoutNote(file: file);
    await tester.pumpWidget(
      MaterialApp(
        // A new window size remounts the popover, so each case starts at fit.
        key: ValueKey<String>('$size-$file'),
        home: ImageLightbox(
          items: [
            ImageSequenceItem(
              note: note,
              image: note.fullFor('front'),
              face: 'front',
            ),
          ],
          initialIndex: 0,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> pumpPopover(
    WidgetTester tester,
    Size size, {
    String file = landscapePath,
  }) async {
    await seedScans(tester);
    await pumpLightbox(tester, size, file: file);
  }

  /// The stage's box for a page: the stage minus the page's own 12px sides and
  /// 4px top padding.
  Rect stageArea(WidgetTester tester) {
    final stage = tester.getRect(find.byType(PageView));
    return Rect.fromLTRB(
      stage.left + 12,
      stage.top + 4,
      stage.right - 12,
      stage.bottom,
    );
  }

  /// The box a portrait page fits its scan into: the stage area inside the
  /// plate's 16px padding.
  Size hugBox(WidgetTester tester) {
    final area = stageArea(tester);
    return Size(area.width - 32, area.height - 32);
  }

  Size fittedScan(Size box, Size scan) {
    final scale = math.min(box.width / scan.width, box.height / scan.height);
    return Size(scan.width * scale, scan.height * scale);
  }

  /// The picture size the Note slideshow gives the same scan on this window:
  /// its plate's inner box, with the scan fitted the way the plate fits it.
  Future<Size> slideshowPicture(
    WidgetTester tester,
    Size size,
    NoteRecord note,
  ) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        key: ValueKey<String>('slideshow-$size'),
        home: NoteSlideshowScreen(notes: [note], initialIndex: 0),
      ),
    );
    await tester.pumpAndSettle();
    // The plate's inner box: its mat less the 8px padding and 1px hairline.
    final matRect = tester.getRect(
      find.byKey(const ValueKey('plateMat')).first,
    );
    return fittedScan(
      Size(matRect.width - 18, matRect.height - 18),
      const Size(1600, 1000),
    );
  }

  for (final size in const [Size(578, 1096), Size(390, 844)]) {
    testWidgets('a portrait window at $size hugs the mat to the scan', (
      tester,
    ) async {
      await pumpPopover(tester, size);

      final imageRect = tester.getRect(find.byType(Image).first);
      final plateRect = tester.getRect(plate.first);
      final expected = fittedScan(hugBox(tester), const Size(1600, 1000));

      // The scan is fitted into the stage inside the plate's padding.
      expect(imageRect.width, closeTo(expected.width, 0.5));
      expect(imageRect.height, closeTo(expected.height, 0.5));

      // The plate is the artifact plus 16px on every side, not the stage.
      expect(plateRect.width, closeTo(imageRect.width + 32, 0.5));
      expect(plateRect.height, closeTo(imageRect.height + 32, 0.5));
      expect(plateRect.center, offsetMoreOrLessEquals(imageRect.center));
      expect(plateRect.center.dx, closeTo(size.width / 2, 1));

      // The room's mat is not the whole stage: this is the regression the
      // task fixes, a note no longer a thumbnail in a metre of white.
      final stage = tester.getRect(find.byType(PageView));
      expect(plateRect.height, lessThan(stage.height * 0.6));

      // The face chip sits on the plate's corner, as the slideshow's does.
      final chipRect = tester.getRect(find.text('FRONT'));
      expect(plateRect.contains(chipRect.center), isTrue);
      expect(chipRect.left - plateRect.left, lessThan(24));
      expect(chipRect.top - plateRect.top, lessThan(24));
      expect(tester.takeException(), isNull);
    });

    testWidgets(
      'the note reads at least as large as the slideshow plate at $size',
      (tester) async {
        final note = layoutNote();
        final slideshow = await slideshowPicture(tester, size, note);

        await pumpPopover(tester, size);
        final imageRect = tester.getRect(find.byType(Image).first);

        // The popover's page padding (12+12) plus plate padding (16+16) keeps it
        // a couple of pixels ahead of the slideshow's 20px slide and 8px plate
        // padding. Never behind, which is the brief's floor.
        expect(imageRect.width, greaterThanOrEqualTo(slideshow.width - 0.5));
        expect(imageRect.height, greaterThanOrEqualTo(slideshow.height - 0.5));
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('a scan taller than the stage still fits whole in portrait', (
    tester,
  ) async {
    const size = Size(390, 844);
    await pumpPopover(tester, size, file: portraitPath);

    final imageRect = tester.getRect(find.byType(Image).first);
    final plateRect = tester.getRect(plate.first);
    final stage = tester.getRect(find.byType(PageView));
    final expected = fittedScan(hugBox(tester), const Size(800, 2000));

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

  testWidgets('a very wide scan still fits whole in portrait', (tester) async {
    const size = Size(390, 844);
    await pumpPopover(tester, size, file: widePath);

    final imageRect = tester.getRect(find.byType(Image).first);
    final plateRect = tester.getRect(plate.first);
    final stage = tester.getRect(find.byType(PageView));
    final expected = fittedScan(hugBox(tester), const Size(4000, 1000));

    expect(imageRect.width, closeTo(expected.width, 0.5));
    expect(plateRect.width, closeTo(imageRect.width + 32, 0.5));
    expect(plateRect.height, closeTo(imageRect.height + 32, 0.5));
    expect(plateRect.left, greaterThanOrEqualTo(stage.left - 0.5));
    expect(plateRect.right, lessThanOrEqualTo(stage.right + 0.5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a wide but short window hugs the mat too', (tester) async {
    // Wide enough for the room, too short for it: the guard is an and.
    const size = Size(1024, 520);
    await pumpPopover(tester, size);

    expect(mat, findsNothing);
    final imageRect = tester.getRect(find.byType(Image).first);
    final plateRect = tester.getRect(plate.first);
    expect(plateRect.width, closeTo(imageRect.width + 32, 0.5));
    expect(plateRect.height, closeTo(imageRect.height + 32, 0.5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the portrait page keeps one label and a working zoom', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    const size = Size(390, 844);
    await pumpPopover(tester, size);

    // The page is one image node naming the note, face and position; the chip
    // inside the page adds no words of its own.
    final page = find.byWidgetPredicate(
      (widget) =>
          widget is Semantics &&
          widget.properties.image == true &&
          (widget.properties.label ?? '').contains('Test - KB-1'),
    );
    expect(page, findsOneWidget);
    final label = tester.widget<Semantics>(page).properties.label!;
    expect(label, contains('Front'));
    expect(label, contains('Image 1 of 1'));
    expect(find.bySemanticsLabel('FRONT'), findsNothing);

    // The zoom instrument still reaches 1:1 and back to the hugged plate.
    await tester.tap(find.text('1:1'));
    await tester.pumpAndSettle();
    expect(tester.widget<Text>(find.textContaining('%')).data, '100%');
    expect(
      tester.getRect(plate.first).width,
      closeTo(stageArea(tester).width, 0.5),
    );

    await tester.tap(find.text('Fit'));
    await tester.pumpAndSettle();
    final imageRect = tester.getRect(find.byType(Image).first);
    final plateRect = tester.getRect(plate.first);
    expect(tester.widget<Text>(find.textContaining('%')).data, isNot('100%'));
    expect(plateRect.width, closeTo(imageRect.width + 32, 0.5));
    expect(plateRect.height, closeTo(imageRect.height + 32, 0.5));
    expect(tester.takeException(), isNull);
    handle.dispose();
  });

  testWidgets('the plate follows the window across the guard', (tester) async {
    await pumpPopover(tester, const Size(740, 800));
    expect(plate, findsOneWidget);
    expect(mat, findsNothing);

    tester.view.physicalSize = const Size(800, 810);
    await tester.pumpAndSettle();
    expect(plate, findsNothing);
    expect(mat, findsOneWidget);

    tester.view.physicalSize = const Size(739, 800);
    await tester.pumpAndSettle();
    expect(plate, findsOneWidget);
    expect(mat, findsNothing);
    expect(tester.takeException(), isNull);
  });

  /// Puts a completer in the image cache for [landscapePath] so a test can hold
  /// the scan's load open, evicting anything a previous test seeded.
  Completer<ImageInfo> holdScan() {
    final completer = Completer<ImageInfo>();
    final provider = FileImage(File(landscapePath));
    PaintingBinding.instance.imageCache.evict(provider);
    PaintingBinding.instance.imageCache.putIfAbsent(
      provider,
      () => OneFrameImageStreamCompleter(completer.future),
    );
    addTearDown(() => PaintingBinding.instance.imageCache.evict(provider));
    return completer;
  }

  testWidgets('no plate is painted until there is a scan to fit', (
    tester,
  ) async {
    // A first decode is not synchronous; the stage must not flash a full mat
    // that then shrinks around the scan.
    final completer = holdScan();

    await pumpLightbox(tester, const Size(390, 844));
    expect(plate, findsNothing);

    final image = await tester.runAsync(() => _solidImage(1600, 1000));
    completer.complete(ImageInfo(image: image!));
    await tester.pumpAndSettle();

    final imageRect = tester.getRect(find.byType(Image).first);
    expect(plate, findsOneWidget);
    expect(
      tester.getRect(plate.first).width,
      closeTo(imageRect.width + 32, 0.5),
    );
  });

  testWidgets('a scan that will not load keeps the stage plate', (
    tester,
  ) async {
    // With no artifact to fit, the mat stands as the room's: the plate is the
    // whole stage and the notice names the failure.
    final completer = holdScan();

    await pumpLightbox(tester, const Size(390, 844));
    completer.completeError(Exception('missing image'));
    await tester.pumpAndSettle();

    expect(
      find.textContaining('missing from the current collection'),
      findsOneWidget,
    );
    final plateRect = tester.getRect(plate.first);
    final area = stageArea(tester);
    expect(plateRect.width, closeTo(area.width, 0.5));
    expect(plateRect.height, closeTo(area.height, 0.5));
  });

  for (final size in const [Size(1440, 900), Size(1024, 768)]) {
    testWidgets('a room window at $size keeps the whole-note mat', (
      tester,
    ) async {
      await pumpPopover(tester, size);

      // The room wears its 16px inset and the mat is the page, not the scan.
      final roomRect = tester.getRect(room);
      expect(roomRect.left, closeTo(16, 0.5));
      expect(roomRect.top, closeTo(16, 0.5));
      expect(roomRect.width, closeTo(size.width - 32, 0.5));
      expect(roomRect.height, closeTo(size.height - 32, 0.5));

      expect(plate, findsNothing);
      final matRect = tester.getRect(mat);
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
      final roomRect = tester.getRect(room);
      expect(
        roomRect,
        roomed ? const Rect.fromLTWH(16, 16, 728, 528) : Offset.zero & size,
        reason: '$size',
      );
    }
  });

  testWidgets('the headline wears the popover step of the title voice', (
    tester,
  ) async {
    await pumpPopover(tester, const Size(1200, 800));

    // DESIGN.md's popover headline: 800, 1.2rem/1.3, -0.01em, uppercase — one
    // step below the slideshow's 2.1rem denomination.
    final title = tester.widget<Text>(find.text('TEST - KB-1'));
    final style = title.style!;
    expect(style.fontSize, 19.2);
    expect(style.fontWeight, FontWeight.w800);
    expect(style.letterSpacing, closeTo(-0.192, 1e-9));
    expect(style.height, 1.3);
  });

  testWidgets('the room floats on the popover shadow step', (tester) async {
    await pumpPopover(tester, const Size(1200, 800));

    final decoration =
        tester.widget<DecoratedBox>(room).decoration as BoxDecoration;
    final shadow = decoration.boxShadow!.single;
    // 0 24px 48px rgba(0, 0, 0, 0.36): the smaller step the slideshow's
    // room shadow documents, not the room's own 0 30px 80px.
    expect(shadow.offset, const Offset(0, 24));
    expect(shadow.blurRadius, 48);
    expect(shadow.color, const Color(0x5C000000));
  });

  /// Two notes, so the counter pill carries both its lines the way the app
  /// shows it, pumped at [size].
  Future<void> pumpTwoNotes(WidgetTester tester, Size size) async {
    await seedScans(tester);
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final notes = [
      layoutNote(id: 1, catalog: 'KB-1'),
      layoutNote(id: 2, catalog: 'KB-2'),
    ];
    await tester.pumpWidget(
      MaterialApp(
        key: ValueKey<String>('header-$size'),
        // The app themes every control in Inter; without it the test font
        // makes the exit button wider than it is in the product.
        theme: ThemeData(fontFamily: 'Inter'),
        home: ImageLightbox(
          items: [
            for (var index = 0; index < notes.length; index++)
              ImageSequenceItem(
                note: notes[index],
                image: notes[index].fullFor('front'),
                face: 'front',
                notePosition: index + 1,
                noteTotal: notes.length,
              ),
          ],
          initialIndex: 0,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  final counter = find.byKey(const ValueKey('imageCounter'));

  testWidgets('a stacked header keeps the counter beside the title', (
    tester,
  ) async {
    await pumpTwoNotes(tester, const Size(555, 881));

    final pill = tester.getRect(counter);
    final heading = tester.getRect(find.text('TEST - KB-1'));

    // The pill hugs its two lines instead of spanning the header, and it sits
    // on the title's line at the right edge, as the slideshow's top bar does.
    expect(pill.width, lessThan(240));
    expect(pill.right, closeTo(555 - 16, 0.5));
    expect(pill.left, greaterThan(heading.right));
    expect((pill.top - heading.top).abs(), lessThan(16));

    // The instruments and the exit take the line beneath the title.
    final face = tester.getRect(find.text('Front'));
    final exit = tester.getRect(find.text('Back to note'));
    expect(face.top, greaterThan(heading.bottom - 1));
    expect(exit.top, greaterThan(heading.bottom - 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a phone header wraps the exit instead of squeezing it', (
    tester,
  ) async {
    await pumpTwoNotes(tester, const Size(393, 852));

    final heading = tester.getRect(find.text('TEST - KB-1'));
    final pill = tester.getRect(counter);
    final exit = tester.getRect(find.text('Back to note'));

    expect(pill.width, lessThan(393 - 32));
    expect(pill.right, closeTo(393 - 16, 0.5));
    expect(exit.top, greaterThan(heading.bottom - 1));
    expect(exit.right, lessThanOrEqualTo(393 - 16 + 0.5));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a room header keeps one row', (tester) async {
    await pumpTwoNotes(tester, const Size(1200, 800));

    final pill = tester.getRect(counter);
    final heading = tester.getRect(find.text('TEST - KB-1'));
    final face = tester.getRect(find.text('Front'));
    final exit = tester.getRect(find.text('Back to note'));

    for (final rect in [pill, face, exit]) {
      expect((rect.center.dy - heading.center.dy).abs(), lessThan(16));
    }
    expect(pill.left, greaterThan(heading.right));
    expect(face.left, greaterThan(pill.right));
    expect(exit.left, greaterThan(face.right));
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
