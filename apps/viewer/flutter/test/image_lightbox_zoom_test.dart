import 'dart:async';
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
  const smallImagePath = 'noteharbor-small-zoom-test.png';

  NoteRecord zoomNote({
    int id = 1,
    bool withImage = true,
    bool withBack = false,
    String? file,
    String? backFile,
    String denomination = 'Test',
  }) {
    return NoteRecord.fromJson(<String, dynamic>{
      'id': id,
      'displayOrder': id,
      'denomination': denomination,
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
                'filePath': file ?? imagePath,
              },
              if (withBack)
                <String, dynamic>{
                  'type': 'back',
                  'variant': 'full',
                  'filePath': backFile ?? file ?? imagePath,
                },
            ]
          : <dynamic>[],
      'scrapedData': null,
    });
  }

  /// Seeds the image cache with an in-memory image so the popover can measure a
  /// scan without touching disk. A large one is shrunk by fit; a small one is
  /// enlarged by it.
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

  /// Holds [path]'s image load open so a test can fail it after the page has
  /// subscribed, without waiting on real file I/O.
  Completer<ImageInfo> holdImage(String path) {
    final completer = Completer<ImageInfo>();
    final provider = FileImage(File(path));
    PaintingBinding.instance.imageCache.putIfAbsent(
      provider,
      () => OneFrameImageStreamCompleter(completer.future),
    );
    addTearDown(() => PaintingBinding.instance.imageCache.evict(provider));
    return completer;
  }

  /// The popover's sequence over [notes], one page per face in [faces], in the
  /// order the Note slideshow opens them.
  List<ImageSequenceItem> imageItems(
    List<NoteRecord> notes, {
    List<String> faces = const ['front'],
  }) => [
    for (var index = 0; index < notes.length; index++)
      for (final face in faces)
        ImageSequenceItem(
          note: notes[index],
          image: notes[index].fullFor(face),
          face: face,
          notePosition: index + 1,
          noteTotal: notes.length,
        ),
  ];

  /// Both faces of every note, in the order the Note slideshow opens them.
  List<ImageSequenceItem> faceItems(List<NoteRecord> notes) =>
      imageItems(notes, faces: const ['front', 'back']);

  Future<void> pumpSequence(
    WidgetTester tester,
    List<ImageSequenceItem> items, {
    int initialIndex = 0,
    Size size = const Size(800, 600),
    ValueChanged<int?>? onResult,
    double textScale = 1,
    bool disableAnimations = false,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await seedImage(tester, imagePath, 1600, 1000);

    await tester.pumpWidget(
      MaterialApp(
        // The key remounts the tree when a test pumps another size, so each
        // sequence starts in the launcher instead of on the old route.
        key: ValueKey<String>(
          '$size-$initialIndex-$textScale-$disableAnimations',
        ),
        builder: textScale == 1 && !disableAnimations
            ? null
            : (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: textScale == 1
                      ? null
                      : TextScaler.linear(textScale),
                  disableAnimations: disableAnimations,
                ),
                child: child!,
              ),
        home: _LightboxLauncher(
          items: items,
          initialIndex: initialIndex,
          onResult: onResult,
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Future<void> pumpPopover(WidgetTester tester) =>
      pumpSequence(tester, imageItems([zoomNote()]));

  Future<void> pumpMultiItemPopover(WidgetTester tester) =>
      pumpSequence(tester, imageItems([zoomNote(id: 1), zoomNote(id: 2)]));

  /// Opens the popover on a sequence of [count] imaged pages.
  Future<void> pumpManyItemPopover(
    WidgetTester tester,
    int count, {
    int initialIndex = 0,
  }) async {
    final notes = <NoteRecord>[
      for (var id = 1; id <= count; id++) zoomNote(id: id),
    ];
    await pumpSequence(tester, imageItems(notes), initialIndex: initialIndex);
  }

  /// Opens the popover on a two-page sequence whose final page renders no
  /// image, mirroring a Note whose Note image is missing.
  Future<void> pumpPopoverEndingWithoutImage(WidgetTester tester) async {
    final notes = [zoomNote(id: 1), zoomNote(id: 2, withImage: false)];
    await pumpSequence(tester, imageItems(notes));
  }

  testWidgets('the mat names the face of the image on screen', (tester) async {
    await pumpSequence(tester, faceItems([zoomNote(id: 1)]));

    expect(find.text('Image 1 of 2'), findsOneWidget);
    expect(find.text('FRONT'), findsOneWidget);
    expect(find.text('BACK'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();

    expect(find.text('Image 2 of 2'), findsOneWidget);
    expect(find.text('BACK'), findsOneWidget);
    expect(find.text('FRONT'), findsNothing);
  });

  testWidgets('one note keeps the counter to the image position', (
    tester,
  ) async {
    await pumpSequence(tester, faceItems([zoomNote(id: 1)]));

    expect(find.text('Image 1 of 2'), findsOneWidget);
    expect(find.textContaining('Note '), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);
    expect(find.textContaining('Note '), findsNothing);
  });

  testWidgets('the counter names the note only when the sequence spans notes', (
    tester,
  ) async {
    final notes = [zoomNote(id: 1), zoomNote(id: 2)];
    await pumpSequence(tester, faceItems(notes));

    expect(find.text('Image 1 of 4'), findsOneWidget);
    expect(find.text('Note 1 of 2'), findsOneWidget);

    // The note position follows the sequence, not the image's face.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 4'), findsOneWidget);
    expect(find.text('Note 1 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    expect(find.text('Image 3 of 4'), findsOneWidget);
    expect(find.text('Note 2 of 2'), findsOneWidget);
  });

  testWidgets('Back to note returns the note the user ended on', (
    tester,
  ) async {
    int? closedNoteId;
    final notes = [zoomNote(id: 1), zoomNote(id: 2)];
    await pumpSequence(
      tester,
      faceItems(notes),
      onResult: (noteId) => closedNoteId = noteId,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    expect(find.text('Image 3 of 4'), findsOneWidget);

    await tester.tap(find.text('Back to note'));
    await tester.pumpAndSettle();

    expect(closedNoteId, 2);
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('the phone header keeps the face, counter and exit', (
    tester,
  ) async {
    final notes = [zoomNote(id: 1), zoomNote(id: 2)];
    await pumpSequence(tester, faceItems(notes), size: const Size(390, 844));

    expect(find.text('FRONT'), findsOneWidget);
    expect(find.text('Image 1 of 4'), findsOneWidget);
    expect(find.text('Note 1 of 2'), findsOneWidget);
    expect(find.text('Back to note'), findsOneWidget);

    // On phone the title owns the first line: the controls sit below it
    // instead of squeezing its width, and nothing overflows.
    final title = find.text('TEST - KB-1');
    final counter = find.text('Note 1 of 2');
    expect(
      tester.getTopLeft(counter).dy,
      greaterThan(tester.getBottomLeft(title).dy),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a two-line counter grows instead of overflowing at large text', (
    tester,
  ) async {
    final notes = [zoomNote(id: 1), zoomNote(id: 2)];
    await pumpSequence(
      tester,
      faceItems(notes),
      size: const Size(390, 844),
      textScale: 2,
    );

    expect(find.text('Image 1 of 4'), findsOneWidget);
    expect(find.text('Note 1 of 2'), findsOneWidget);
    // The dense instrument clamps its own text scale, so it still renders its
    // whole set of stops instead of overflowing.
    for (final label in const ['Fit', '1:1', '\u2212', '+']) {
      expect(find.text(label), findsOneWidget, reason: '$label at 2x text');
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('mouse wheel zooms in, and back out', (tester) async {
    await pumpPopover(tester);
    expect(_maxZoom(tester), closeTo(1.0, 0.001));
    final fitLevel = _levelText(tester);

    final pointer = TestPointer(1, PointerDeviceKind.mouse);
    pointer.hover(tester.getCenter(find.byType(Image).first));
    await tester.sendEventToBinding(pointer.scroll(const Offset(0, -120)));
    await tester.pump();

    final zoomedIn = _maxZoom(tester);
    expect(zoomedIn, greaterThan(1.0));
    expect(_percentOf(_levelText(tester)), greaterThan(_percentOf(fitLevel)));

    await tester.sendEventToBinding(pointer.scroll(const Offset(0, 120)));
    await tester.pump();
    expect(_maxZoom(tester), closeTo(1.0, 0.001));
    expect(_levelText(tester), fitLevel);
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
    final zoomedIn = _maxZoom(tester);
    expect(zoomedIn, greaterThan(1.0));

    final center = tester.getCenter(find.byType(PageView));
    final first = await tester.startGesture(
      center + const Offset(-200, 0),
      pointer: 1,
    );
    final second = await tester.startGesture(
      center + const Offset(200, 0),
      pointer: 2,
    );

    // Draw the fingers together until the image is close to fit but not all
    // the way. The span is derived from the zoom the popover reached, so the
    // arithmetic does not depend on the window's fitted size.
    final halfSpan = 200 * (1.05 / zoomedIn);
    await first.moveTo(center + Offset(-halfSpan, 0));
    await second.moveTo(center + Offset(halfSpan, 0));
    await tester.pump();

    expect(_maxZoom(tester), closeTo(1.0, 0.001));

    await first.up();
    await second.up();
    await tester.pumpAndSettle();

    // The sequence is swipeable again without a reset.
    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);
  });

  testWidgets('a narrowing pinch within 20% of fit snaps back to fit', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    await _zoomInWithKeyboard(tester);
    final zoomedIn = _maxZoom(tester);
    expect(zoomedIn, greaterThan(1.0));

    final center = tester.getCenter(find.byType(PageView));
    final first = await tester.startGesture(
      center + const Offset(-200, 0),
      pointer: 1,
    );
    final second = await tester.startGesture(
      center + const Offset(200, 0),
      pointer: 2,
    );

    // Draw the fingers together until the image is within 20% of fit but
    // outside the old 10% margin: without the widened snap this rests above
    // fit and leaves the sequence unswipeable until a double tap.
    final halfSpan = 200 * (1.15 / zoomedIn);
    await first.moveTo(center + Offset(-halfSpan, 0));
    await second.moveTo(center + Offset(halfSpan, 0));
    await tester.pump();

    expect(_maxZoom(tester), closeTo(1.0, 0.001));

    await first.up();
    await second.up();
    await tester.pumpAndSettle();

    // The sequence is swipeable again without a reset.
    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);
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

    expect(_maxZoom(tester), greaterThan(1 + 0.2));
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
    expect(find.text('Image 1 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyL);
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyH);
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 2'), findsOneWidget);
  });

  testWidgets('modified horizontal keys page in fit view, vertical stay put', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    expect(find.text('Image 1 of 2'), findsOneWidget);

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
        expect(
          find.text('Image 1 of 2'),
          findsOneWidget,
          reason: '$modifier + $key',
        );
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
        expect(
          find.text('Image 2 of 2'),
          findsOneWidget,
          reason: '$modifier + $next',
        );

        await _pressWithModifier(tester, modifier, previous);
        expect(
          find.text('Image 1 of 2'),
          findsOneWidget,
          reason: '$modifier + $previous',
        );
      }
    }
  });

  testWidgets('plain Left and Right page in both directions', (tester) async {
    await pumpManyItemPopover(tester, 3, initialIndex: 1);
    expect(find.text('Image 2 of 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 3'), findsOneWidget);
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
    expect(find.text('Image 1 of 2'), findsOneWidget);

    // In fit view even the keys that would page stay inert.
    for (final key in altKeys) {
      await _pressWithModifier(tester, LogicalKeyboardKey.altLeft, key);
      expect(
        find.text('Image 1 of 2'),
        findsOneWidget,
        reason: 'fit, alt + $key',
      );
    }

    await _zoomInWithKeyboard(tester);
    final before = _imageTranslation(tester);

    for (final key in altKeys) {
      await _pressWithModifier(tester, LogicalKeyboardKey.altLeft, key);
      expect(_imageTranslation(tester), before, reason: 'zoom, alt + $key');
      expect(
        find.text('Image 1 of 2'),
        findsOneWidget,
        reason: 'zoom, alt + $key',
      );
    }
  });

  testWidgets('escape resets zoom before closing the popover', (tester) async {
    await pumpPopover(tester);
    await _zoomInWithKeyboard(tester);
    expect(_maxZoom(tester), greaterThan(1.0));

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(_maxZoom(tester), closeTo(1.0, 0.001));
    expect(find.text('Back to note'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('arrow left on the first image wraps to the last image', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);
    expect(find.text('Image 1 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);
  });

  testWidgets('arrow right on the last image wraps to the first image', (
    tester,
  ) async {
    await pumpMultiItemPopover(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 2'), findsOneWidget);
  });

  testWidgets('home jumps to the first page', (tester) async {
    await pumpManyItemPopover(tester, 5, initialIndex: 4);
    expect(find.text('Image 5 of 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();

    expect(find.text('Image 1 of 5'), findsOneWidget);
    expect(find.text('TEST - KB-1'), findsOneWidget);
  });

  testWidgets('end jumps to the last page', (tester) async {
    await pumpManyItemPopover(tester, 5);
    expect(find.text('Image 1 of 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('Image 5 of 5'), findsOneWidget);
    expect(find.text('TEST - KB-5'), findsOneWidget);
  });

  testWidgets('end lands on the last page even when it renders no image', (
    tester,
  ) async {
    await pumpPopoverEndingWithoutImage(tester);
    expect(find.text('Image 1 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('Image 2 of 2'), findsOneWidget);
    expect(find.text('TEST - KB-2'), findsOneWidget);
    expect(find.text('No image'), findsOneWidget);
  });

  testWidgets('end reaches the last page in one frame, not an animation', (
    tester,
  ) async {
    // A collection large enough that animating to the end would be obvious.
    await pumpManyItemPopover(tester, 40);
    expect(find.text('Image 1 of 40'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    // A single frame: an animated transition would still be in flight and the
    // index pill would not have moved to the endpoint yet.
    await tester.pump();
    expect(find.text('Image 40 of 40'), findsOneWidget);
  });

  testWidgets('a wrap-around glides across the seam like a swipe', (
    tester,
  ) async {
    await pumpManyItemPopover(tester, 3);
    expect(find.text('Image 1 of 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    // A single frame: the wrap animates across the seam, so the index pill has
    // not reached the wrapped page yet (a jump would have moved it).
    await tester.pump();
    expect(find.text('Image 1 of 3'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('Image 3 of 3'), findsOneWidget);
    expect(find.text('TEST - KB-3'), findsOneWidget);
  });

  testWidgets('reduced motion swaps pages without sliding', (tester) async {
    await pumpSequence(
      tester,
      faceItems([zoomNote(withBack: true)]),
      disableAnimations: true,
    );
    expect(find.text('Image 1 of 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    // A single frame: the reduced-motion step jumps instead of sliding, so the
    // pill has already reached the next page.
    await tester.pump();
    expect(find.text('Image 2 of 2'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.text('BACK'), findsOneWidget);

    // Direct manipulation is not an animated step: a swipe still pages.
    await tester.drag(find.byType(PageView), const Offset(600, 0));
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 2'), findsOneWidget);
  });

  testWidgets('an adjacent arrow step animates rather than jumping', (
    tester,
  ) async {
    await pumpManyItemPopover(tester, 3, initialIndex: 1);
    expect(find.text('Image 2 of 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    // A single frame: the animated step is still in flight, so the index pill
    // has not reached the next page yet (a jump would have moved it).
    await tester.pump();
    expect(find.text('Image 2 of 3'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('Image 3 of 3'), findsOneWidget);
  });

  testWidgets('home and end still move between pages while zoomed', (
    tester,
  ) async {
    await pumpManyItemPopover(tester, 3);
    await _zoomInWithKeyboard(tester);
    expect(_maxZoom(tester), greaterThan(1.0));

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();
    expect(find.text('Image 3 of 3'), findsOneWidget);
    expect(find.text('TEST - KB-3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 3'), findsOneWidget);
    expect(find.text('TEST - KB-1'), findsOneWidget);
  });

  testWidgets('home on the first page changes nothing', (tester) async {
    await pumpManyItemPopover(tester, 5);
    expect(find.text('Image 1 of 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();

    expect(find.text('Image 1 of 5'), findsOneWidget);
  });

  testWidgets('end on the last page changes nothing', (tester) async {
    await pumpManyItemPopover(tester, 5, initialIndex: 4);
    expect(find.text('Image 5 of 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('Image 5 of 5'), findsOneWidget);
  });

  testWidgets('home and end change nothing with a single page', (tester) async {
    await pumpPopover(tester);
    expect(find.text('Image 1 of 1'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('Image 1 of 1'), findsOneWidget);
  });

  testWidgets('modified home and end do nothing', (tester) async {
    await pumpManyItemPopover(tester, 5, initialIndex: 2);
    expect(find.text('Image 3 of 5'), findsOneWidget);

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

      expect(find.text('Image 3 of 5'), findsOneWidget);
    }
  });

  testWidgets('the header shows the whole zoom instrument', (tester) async {
    await pumpPopover(tester);

    expect(find.text('Fit'), findsOneWidget);
    expect(find.text('1:1'), findsOneWidget);
    expect(find.text('\u2212'), findsOneWidget);
    expect(find.text('+'), findsOneWidget);
    expect(find.textContaining('%'), findsOneWidget);
    expect(find.text('Back to note'), findsOneWidget);
  });

  testWidgets('the fit view disables Fit and Zoom out, not 1:1 or Zoom in', (
    tester,
  ) async {
    await pumpPopover(tester);

    expect(_headerButton(tester, 'Fit').onPressed, isNull);
    expect(_headerButton(tester, '1:1').onPressed, isNotNull);
    expect(_headerButton(tester, '\u2212').onPressed, isNull);
    expect(_headerButton(tester, '+').onPressed, isNotNull);
  });

  testWidgets('1:1 lands on the real size and reads 100%', (tester) async {
    await pumpPopover(tester);

    await tester.tap(find.text('1:1'));
    await tester.pumpAndSettle();

    expect(_levelText(tester), '100%');
    expect(_headerButton(tester, '1:1').onPressed, isNull);
    expect(_headerButton(tester, 'Fit').onPressed, isNotNull);
  });

  testWidgets('the plus and minus buttons step the level and its readout', (
    tester,
  ) async {
    await pumpPopover(tester);
    final fitLevel = _levelText(tester);

    await tester.tap(find.text('+'));
    await tester.pumpAndSettle();
    final steppedLevel = _levelText(tester);
    expect(steppedLevel, isNot(fitLevel));
    expect(_percentOf(steppedLevel), greaterThan(_percentOf(fitLevel)));
    expect(_headerButton(tester, '\u2212').onPressed, isNotNull);

    await tester.tap(find.text('\u2212'));
    await tester.pumpAndSettle();

    expect(_levelText(tester), fitLevel);
    expect(_headerButton(tester, '\u2212').onPressed, isNull);
  });

  testWidgets('plus disables at the top stop', (tester) async {
    await pumpPopover(tester);

    var taps = 0;
    while (_headerButton(tester, '+').onPressed != null) {
      await tester.tap(find.text('+'));
      await tester.pumpAndSettle();
      taps += 1;
      expect(taps, lessThan(20), reason: 'the ladder must end');
    }

    expect(_headerButton(tester, 'Fit').onPressed, isNotNull);
  });

  testWidgets('Fit steps back from 1:1 and re-enables paging', (tester) async {
    await pumpManyItemPopover(tester, 2);

    await tester.tap(find.text('1:1'));
    await tester.pumpAndSettle();
    expect(_levelText(tester), '100%');

    // The zoomed plate holds the drag, so the sequence does not page.
    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 2'), findsOneWidget);

    await tester.tap(find.text('Fit'));
    await tester.pumpAndSettle();
    expect(_levelText(tester), isNot('100%'));

    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);
  });

  testWidgets('the side toggle jumps between the faces of the current note', (
    tester,
  ) async {
    await pumpSequence(tester, faceItems([zoomNote(withBack: true)]));
    expect(find.text('Image 1 of 2'), findsOneWidget);

    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 2'), findsOneWidget);

    await tester.tap(find.text('Front'));
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 2'), findsOneWidget);
  });

  testWidgets('the note keeps its zoom across its faces, never across notes', (
    tester,
  ) async {
    final notes = [zoomNote(id: 1, withBack: true), zoomNote(id: 2)];
    await pumpSequence(tester, faceItems(notes));
    final fitLevel = _levelText(tester);
    await _zoomInWithKeyboard(tester);

    final zoomed = _maxZoom(tester);
    final level = _levelText(tester);
    expect(zoomed, greaterThan(1.0));

    // The same note's other face continues at the scale the reader left its
    // front at.
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 4'), findsOneWidget);
    expect(_maxZoom(tester), closeTo(zoomed, 0.001));
    expect(_levelText(tester), level);

    // The inherited zoom keeps the sequence unswipeable, exactly as a gesture
    // zoom does.
    await tester.drag(find.byType(PageView), const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('Image 2 of 4'), findsOneWidget);

    // Returning to the first face keeps the note's level too.
    await tester.tap(find.text('Front'));
    await tester.pumpAndSettle();
    expect(find.text('Image 1 of 4'), findsOneWidget);
    expect(_levelText(tester), level);

    // The next note opens at fit: the zoom belongs to the note it was set on.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('Image 3 of 4'), findsOneWidget);
    expect(_maxZoom(tester), closeTo(1.0, 0.001));
    expect(_levelText(tester), fitLevel);
  });

  testWidgets('a face that will not decode keeps the note\'s other level', (
    tester,
  ) async {
    const missingBack = 'noteharbor-missing-back-face.png';
    final held = holdImage(missingBack);
    final note = zoomNote(withBack: true, backFile: missingBack);
    await pumpSequence(tester, faceItems([note]));
    await _zoomInWithKeyboard(tester);
    final zoomed = _maxZoom(tester);

    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    held.completeError(Exception('missing image'));
    await tester.pumpAndSettle();

    // A face with no pixels returns to fit, so the sequence stays swipeable
    // and the inert zoom cluster agrees with the plate.
    expect(
      find.textContaining('missing from the current collection'),
      findsOneWidget,
    );
    expect(_maxZoom(tester), closeTo(1.0, 0.001));

    // The note's level survives the failed face.
    await tester.tap(find.text('Front'));
    await tester.pumpAndSettle();
    expect(_maxZoom(tester), closeTo(zoomed, 0.001));
  });

  testWidgets('a long headline wraps in the bar instead of overflowing', (
    tester,
  ) async {
    final note = zoomNote(
      denomination: 'Ten thousand pesos commemorative series',
    );
    await pumpSequence(
      tester,
      imageItems([note]),
      size: const Size(390, 844),
      textScale: 2,
    );

    expect(tester.takeException(), isNull);
    final headline = find.textContaining('TEN THOUSAND PESOS');
    expect(headline, findsOneWidget);
    // The bar grows with the wrapped headline rather than clipping it.
    expect(tester.getSize(headline).height, greaterThan(19.2 * 2 * 1.3));
  });

  testWidgets('a face the note does not carry is disabled', (tester) async {
    await pumpSequence(tester, imageItems([zoomNote(), zoomNote(id: 2)]));

    expect(_headerButton(tester, 'Back').onPressed, isNull);
    expect(_headerButton(tester, 'Front').onPressed, isNotNull);
  });

  testWidgets('the zoom cluster is inert on a page with no image', (
    tester,
  ) async {
    await pumpPopoverEndingWithoutImage(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('No image'), findsOneWidget);
    expectInstrumentInert(tester);
    expect(find.text('\u2014'), findsOneWidget);
  });

  testWidgets('the zoom cluster is inert when the image fails to load', (
    tester,
  ) async {
    await pumpSequence(
      tester,
      imageItems([zoomNote(file: 'noteharbor-missing-image.png')]),
    );

    // The file read is real I/O; let it fail outside the fake async zone.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pumpAndSettle();

    expectInstrumentInert(tester);
    expect(find.text('\u2014'), findsOneWidget);
    expect(
      find.textContaining('missing from the current collection'),
      findsOneWidget,
    );
  });

  testWidgets('a scan smaller than the plate reports its real level', (
    tester,
  ) async {
    await seedImage(tester, smallImagePath, 200, 120);
    await pumpSequence(tester, imageItems([zoomNote(file: smallImagePath)]));

    // Fit already draws the scan larger than its real size, so the level must
    // not claim 100%, and the 1:1 stop has nothing to return to.
    expect(_percentOf(_levelText(tester)), greaterThan(100));
    expect(_headerButton(tester, '1:1').onPressed, isNull);
  });

  testWidgets('the pressed fit stop and the current face are announced', (
    tester,
  ) async {
    await pumpPopover(tester);

    expect(
      tester.getSemantics(find.text('Fit')),
      isSemantics(isButton: true, isToggled: true),
    );
    expect(
      tester.getSemantics(find.text('Front')),
      isSemantics(isButton: true, isToggled: true),
    );
  });

  testWidgets('the mat offers a zoom-in cursor', (tester) async {
    await pumpPopover(tester);

    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is MouseRegion && widget.cursor == SystemMouseCursors.zoomIn,
      ),
      findsOneWidget,
    );
  });

  testWidgets('the header never overflows at large text', (tester) async {
    const sizes = [Size(1000, 800), Size(1200, 800), Size(1440, 900)];
    for (final textScale in const [1.0, 2.0]) {
      for (final size in sizes) {
        await pumpSequence(
          tester,
          imageItems([zoomNote()]),
          size: size,
          textScale: textScale,
        );

        final reason = '$size at ${textScale}x';
        expect(tester.takeException(), isNull, reason: reason);
        for (final label in const [
          'Fit',
          '1:1',
          'Front',
          'Back',
          'Back to note',
        ]) {
          expect(find.text(label), findsOneWidget, reason: '$reason: $label');
        }
      }
    }
  });

  testWidgets('the header holds together on a phone and a desktop', (
    tester,
  ) async {
    for (final size in const [Size(390, 844), Size(1440, 900)]) {
      await pumpSequence(tester, imageItems([zoomNote()]), size: size);

      expect(tester.takeException(), isNull, reason: '$size');
      expect(find.text('Fit'), findsOneWidget, reason: '$size');
      expect(find.text('1:1'), findsOneWidget, reason: '$size');
      expect(find.text('Front'), findsOneWidget, reason: '$size');
      expect(find.text('Back'), findsOneWidget, reason: '$size');
      expect(find.text('Back to note'), findsOneWidget, reason: '$size');

      // The title keeps its width: the controls sit beneath it on a phone and
      // beside it on a desktop.
      final titleRect = tester.getRect(find.text('TEST - KB-1'));
      final counterRect = tester.getRect(find.text('Image 1 of 1'));
      if (size.width < 600) {
        expect(titleRect.bottom, lessThanOrEqualTo(counterRect.top));
      } else {
        expect(counterRect.left, greaterThan(titleRect.right));
      }
    }
  });
}

String _levelText(WidgetTester tester) {
  final finder = find.textContaining('%');
  expect(finder, findsOneWidget);
  return tester.widget<Text>(finder).data!;
}

int _percentOf(String level) => int.parse(level.replaceAll('%', ''));

/// Every stop of the zoom instrument refuses input.
void expectInstrumentInert(WidgetTester tester) {
  for (final label in const ['Fit', '1:1', '\u2212', '+']) {
    expect(
      _headerButton(tester, label).onPressed,
      isNull,
      reason: '$label stays inert',
    );
  }
}

TextButton _headerButton(WidgetTester tester, String label) {
  return tester.widget<TextButton>(
    find
        .ancestor(of: find.text(label), matching: find.byType(TextButton))
        .first,
  );
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
  const _LightboxLauncher({
    required this.items,
    this.initialIndex = 0,
    this.onResult,
  });

  final List<ImageSequenceItem> items;
  final int initialIndex;
  final ValueChanged<int?>? onResult;

  Future<void> _open(BuildContext context) async {
    final noteId = await Navigator.of(context).push<int>(
      MaterialPageRoute<int>(
        builder: (_) => ImageLightbox(items: items, initialIndex: initialIndex),
      ),
    );
    onResult?.call(noteId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () => _open(context),
          child: const Text('open'),
        ),
      ),
    );
  }
}
