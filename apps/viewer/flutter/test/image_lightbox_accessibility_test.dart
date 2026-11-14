import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_lightbox.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  const imagePath = 'noteharbor-a11y-test.png';
  const missingPath = 'noteharbor-a11y-missing.png';

  NoteRecord a11yNote({
    int id = 1,
    String denomination = '25 LEI',
    String catalogNumber = 'P-89s',
    String issueDate = '',
    bool withFront = true,
    bool withBack = false,
    String? file,
  }) {
    return NoteRecord.fromJson(<String, dynamic>{
      'id': id,
      'displayOrder': id,
      'denomination': denomination,
      'issueDate': issueDate,
      'catalogNumber': catalogNumber,
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
        if (withFront)
          <String, dynamic>{
            'type': 'front',
            'variant': 'full',
            'filePath': file ?? imagePath,
          },
        if (withBack)
          <String, dynamic>{
            'type': 'back',
            'variant': 'full',
            'filePath': file ?? imagePath,
          },
      ],
      'scrapedData': null,
    });
  }

  /// Seeds the image cache with an in-memory scan so the popover can measure the
  /// note image without touching disk.
  Future<void> seedImage(WidgetTester tester) async {
    final image = await tester.runAsync(() => _solidImage(1600, 1000));
    final provider = FileImage(File(imagePath));
    PaintingBinding.instance.imageCache.putIfAbsent(
      provider,
      () => OneFrameImageStreamCompleter(
        Future<ImageInfo>.value(ImageInfo(image: image!)),
      ),
    );
    addTearDown(() => PaintingBinding.instance.imageCache.evict(provider));
  }

  /// Holds [path]'s image load open so a test can fail it after the page has
  /// subscribed; a pre-failed completer would report before any listener could
  /// turn the error into the page's notice.
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

  /// The sequence the slideshow builds: each note's faces in open order.
  List<ImageSequenceItem> faceItems(List<NoteRecord> notes) => [
    for (var index = 0; index < notes.length; index++)
      for (final face in const ['front', 'back'])
        if (notes[index].fullFor(face) case final image?)
          ImageSequenceItem(
            note: notes[index],
            image: image,
            face: face,
            notePosition: index + 1,
            noteTotal: notes.length,
          ),
  ];

  /// One page per note, so a note without an image still occupies its page.
  List<ImageSequenceItem> noteItems(List<NoteRecord> notes) => [
    for (var index = 0; index < notes.length; index++)
      ImageSequenceItem(
        note: notes[index],
        image: notes[index].fullFor('front'),
        face: 'front',
        notePosition: index + 1,
        noteTotal: notes.length,
      ),
  ];

  Future<void> pumpSequence(
    WidgetTester tester,
    List<ImageSequenceItem> items, {
    int initialIndex = 0,
    bool seed = true,
  }) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    if (seed) {
      await seedImage(tester);
    }

    await tester.pumpWidget(
      MaterialApp(
        home: _LightboxLauncher(items: items, initialIndex: initialIndex),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  Finder semanticsNode(String label, {bool? image, bool? liveRegion}) =>
      find.byWidgetPredicate(
        (widget) =>
            widget is Semantics &&
            widget.properties.label == label &&
            (image == null || widget.properties.image == image) &&
            (liveRegion == null || widget.properties.liveRegion == liveRegion),
      );

  /// The page's one label, never the live region's moving-part announcement.
  Finder pageNode(String label) => semanticsNode(label, image: true);

  /// The stage's live region.
  Finder announcer(String label) => semanticsNode(label, liveRegion: true);

  FocusNode focusNodeOf(WidgetTester tester, Finder finder) =>
      Focus.of(tester.element(finder));

  /// Presses Tab until [node] holds focus, so a test never depends on the
  /// exact position of a control in the tab order.
  Future<void> tabTo(WidgetTester tester, FocusNode node) async {
    for (var i = 0; i < 12 && !node.hasFocus; i++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
    }
    expect(
      node.hasFocus,
      isTrue,
      reason:
          'Tab never reached ${node.debugLabel}; primary focus is '
          '${FocusManager.instance.primaryFocus?.debugLabel}',
    );
  }

  Future<void> zoomInWithKeyboard(WidgetTester tester) async {
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.equal);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pump();
  }

  String levelText(WidgetTester tester) =>
      tester.widget<Text>(find.textContaining('%')).data!;

  testWidgets('a page is one image label that names the note, face and place', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(tester, faceItems([a11yNote(withBack: true)]));

    final page = pageNode('25 LEI - P-89s, Front, Image 1 of 2');
    expect(page, findsOneWidget);
    final data = tester.getSemantics(page).getSemanticsData();
    expect(data.flagsCollection.isImage, isTrue);
    expect(data.flagsCollection.isButton, isFalse);
    expect(data.flagsCollection.isLiveRegion, isFalse);
    expect(data.hint, 'Double-click to zoom');
    expect(data.hasAction(SemanticsAction.tap), isTrue);

    // One node: the mat's chip and the note image add no words of their own.
    expect(tester.getSemantics(page).childrenCount, 0);
    expect(find.bySemanticsLabel('FRONT'), findsNothing);

    // The page says the title once; the visible header copy is not a second
    // node, and the counter's exact words belong to the page alone.
    expect(find.bySemanticsLabel(RegExp('25 LEI - P-89s')), findsOneWidget);
    expect(find.bySemanticsLabel('Image 1 of 2'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(pageNode('25 LEI - P-89s, Back, Image 2 of 2'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the page label keeps the date the header shows', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(tester, noteItems([a11yNote(issueDate: '1993')]));

    expect(
      pageNode('25 LEI - P-89s, 1993, Front, Image 1 of 1'),
      findsOneWidget,
    );
    // The date is spoken in the page label, not a second header node.
    expect(find.bySemanticsLabel(RegExp('1993')), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the live region is reachable and announces each page change', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(
      tester,
      faceItems([
        a11yNote(id: 1, withBack: true),
        a11yNote(
          id: 2,
          denomination: '5 POUNDS',
          catalogNumber: 'P-90s',
          withBack: true,
        ),
      ]),
    );

    final first = announcer('Front, Image 1 of 4, Note 1 of 2');
    expect(first, findsOneWidget);
    final node = tester.getSemantics(first);
    final data = node.getSemanticsData();
    expect(data.flagsCollection.isLiveRegion, isTrue);
    // The node must sit in the tree with real geometry, or no reader ever
    // receives the announcement.
    expect(node.parent, isNotNull);
    expect(node.rect.isEmpty, isFalse);

    // The page is not the announcer: exploration reads it once.
    expect(
      tester
          .getSemantics(
            pageNode('25 LEI - P-89s, Front, Image 1 of 4, Note 1 of 2'),
          )
          .getSemanticsData()
          .flagsCollection
          .isLiveRegion,
      isFalse,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();

    expect(announcer('Back, Image 2 of 4, Note 1 of 2'), findsOneWidget);
    expect(announcer('Front, Image 1 of 4, Note 1 of 2'), findsNothing);

    // Paging onto the next note carries its note position.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(announcer('Front, Image 3 of 4, Note 2 of 2'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a page with no image says so in its label and announcement', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(
      tester,
      noteItems([a11yNote(id: 1), a11yNote(id: 2, withFront: false)]),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    final page = semanticsNode(
      '25 LEI - P-89s, Front, Image 2 of 2, Note 2 of 2, No image',
    );
    expect(page, findsOneWidget);
    expect(
      announcer('Front, Image 2 of 2, Note 2 of 2, No image'),
      findsOneWidget,
    );

    final data = tester.getSemantics(page).getSemanticsData();
    expect(data.flagsCollection.isImage, isFalse);
    expect(data.hint, isEmpty);
    expect(data.hasAction(SemanticsAction.tap), isFalse);
    expect(find.text('No image'), findsOneWidget);
    handle.dispose();
  });

  testWidgets(
    'a failed note image is named and announced in the mat\'s words',
    (WidgetTester tester) async {
      final handle = tester.ensureSemantics();
      final held = holdImage(missingPath);
      await pumpSequence(
        tester,
        noteItems([a11yNote(file: missingPath)]),
        seed: false,
      );

      held.completeError(Exception('missing image'));
      await tester.pumpAndSettle();

      const notice = 'This image file is missing from the current collection.';
      final page = semanticsNode(
        '25 LEI - P-89s, Front, Image 1 of 1, $notice',
      );
      expect(page, findsOneWidget);
      expect(announcer('Front, Image 1 of 1, $notice'), findsOneWidget);

      final data = tester.getSemantics(page).getSemanticsData();
      expect(data.flagsCollection.isImage, isFalse);
      expect(data.hint, isEmpty);
      expect(data.hasAction(SemanticsAction.tap), isFalse);
      expect(
        find.textContaining('missing from the current collection'),
        findsOneWidget,
      );
      handle.dispose();
    },
  );

  testWidgets('a stale failure is not announced against the next page', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    final held = holdImage(missingPath);
    await pumpSequence(
      tester,
      noteItems([a11yNote(id: 1, file: missingPath), a11yNote(id: 2)]),
    );

    held.completeError(Exception('missing image'));
    await tester.pumpAndSettle();
    expect(
      announcer(
        'Front, Image 1 of 2, Note 1 of 2, '
        'This image file is missing from the current collection.',
      ),
      findsOneWidget,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();

    // The healthy page never inherits the failed page's sentence.
    expect(announcer('Front, Image 2 of 2, Note 2 of 2'), findsOneWidget);
    expect(
      announcer(
        'Front, Image 2 of 2, Note 2 of 2, '
        'This image file is missing from the current collection.',
      ),
      findsNothing,
    );
    handle.dispose();
  });

  testWidgets('every zoom stop is a button and Tab visits them in order', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(tester, faceItems([a11yNote(withBack: true)]));

    // Step past 1:1 so every stop is enabled; disabled stops leave the tab
    // order.
    await zoomInWithKeyboard(tester);
    await zoomInWithKeyboard(tester);

    for (final label in const ['Fit', '1:1', 'Zoom out', 'Zoom in']) {
      final finder = find.bySemanticsLabel(label);
      expect(finder, findsOneWidget, reason: label);
      final data = tester.getSemantics(finder).getSemanticsData();
      expect(data.flagsCollection.isButton, isTrue, reason: label);
      expect(data.hasAction(SemanticsAction.tap), isTrue, reason: label);
      expect(data.flagsCollection.isEnabled, ui.Tristate.isTrue, reason: label);
    }

    final readingOrder = <String, FocusNode>{
      'Front': focusNodeOf(tester, find.text('Front')),
      'Back': focusNodeOf(tester, find.text('Back')),
      'Fit': focusNodeOf(tester, find.text('Fit')),
      '1:1': focusNodeOf(tester, find.text('1:1')),
      'Zoom out': focusNodeOf(tester, find.text('\u2212')),
      'Zoom in': focusNodeOf(tester, find.text('+')),
      'Back to note': focusNodeOf(tester, find.text('Back to note')),
    };
    final labelOf = {
      for (final entry in readingOrder.entries) entry.value: entry.key,
    };
    expect(labelOf, hasLength(readingOrder.length));

    final visited = <String>[];
    for (
      var tabs = 0;
      tabs < readingOrder.length * 2 && visited.length < readingOrder.length;
      tabs++
    ) {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      final label = labelOf[FocusManager.instance.primaryFocus];
      if (label != null) visited.add(label);
    }

    expect(visited, readingOrder.keys.toList());
    handle.dispose();
  });

  testWidgets('the page\'s semantic tap toggles the zoom', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(tester, faceItems([a11yNote(withBack: true)]));

    final fitLevel = levelText(tester);
    final page = pageNode('25 LEI - P-89s, Front, Image 1 of 2');
    final node = tester.getSemantics(page);

    // ignore: deprecated_member_use
    tester.binding.pipelineOwner.semanticsOwner!.performAction(
      node.id,
      SemanticsAction.tap,
    );
    await tester.pumpAndSettle();

    expect(levelText(tester), isNot(fitLevel));
    // Once above fit, the hint says what the same tap now does.
    expect(
      tester.getSemantics(page).getSemanticsData().hint,
      'Double-click to fit',
    );
    handle.dispose();
  });

  testWidgets('the zoom level is a reachable live region that follows a step', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(tester, faceItems([a11yNote(withBack: true)]));

    final level = semanticsNode('Zoom level', liveRegion: true);
    expect(level, findsOneWidget);
    final node = tester.getSemantics(level);
    expect(node.parent, isNotNull);
    final before = node.getSemanticsData().value;

    await zoomInWithKeyboard(tester);
    await tester.pumpAndSettle();

    final after = tester.getSemantics(level).getSemanticsData().value;
    expect(after, isNot(before));
    handle.dispose();
  });

  testWidgets('escape resets zoom from a focused zoom stop, then closes', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(tester, faceItems([a11yNote(withBack: true)]));

    final zoomIn = focusNodeOf(tester, find.text('+'));
    await tabTo(tester, zoomIn);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('Back to note'), findsOneWidget);

    // The first Escape leaves Zoom view; the popover is still open.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Back to note'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the exit is still reachable after a zoom stop has focus', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSequence(tester, faceItems([a11yNote(withBack: true)]));

    // Zoom controls come before the exit in the header's reading order.
    await tabTo(tester, focusNodeOf(tester, find.text('+')));
    await tabTo(tester, focusNodeOf(tester, find.text('Back to note')));

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
    handle.dispose();
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

  Future<void> _open(BuildContext context) async {
    await Navigator.of(context).push<int>(
      MaterialPageRoute<int>(
        builder: (_) => ImageLightbox(items: items, initialIndex: initialIndex),
      ),
    );
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
