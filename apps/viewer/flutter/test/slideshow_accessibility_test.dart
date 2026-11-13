import 'dart:async';
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/features/slideshow/note_slideshow_screen.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  Map<String, dynamic> slideNote({
    int id = 1,
    String denomination = 'Five Pounds',
    List<String> tags = const ['Bank of England', 'Polymer', 'Portrait'],
    List<Map<String, dynamic>>? images,
  }) {
    return {
      'id': id,
      'displayOrder': id,
      'denomination': denomination,
      'issueDate': '2013',
      'catalogNumber': 'P-$id',
      'gradingCompany': 'PMG',
      'grade': '66 EPQ',
      'watermark': 'Britannia',
      'serial': 'AA01 234567',
      'url': 'bankofengland.co.uk/banknotes/5-pound-note',
      'notes': 'Polymer issue, first series.',
      'scrapeStatus': 'done',
      'scrapeError': '',
      'tags': [
        for (final name in tags) {'name': name},
      ],
      'images':
          images ??
          const [
            {
              'type': 'front',
              'variant': 'full',
              'assetPath': 'web/icons/Icon-192.png',
            },
            {
              'type': 'back',
              'variant': 'full',
              'assetPath': 'web/icons/Icon-192.png',
            },
          ],
      'scrapedData': null,
    };
  }

  void setSurface(WidgetTester tester) {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
  }

  Future<void> pumpSlideshow(
    WidgetTester tester, {
    int noteCount = 1,
    int initialIndex = 0,
    List<Map<String, dynamic>>? images,
    List<String> tags = const ['Bank of England', 'Polymer', 'Portrait'],
    Future<bool> Function(String path)? revealFolder,
  }) async {
    setSurface(tester);

    final notes = [
      for (var i = 1; i <= noteCount; i++)
        NoteRecord.fromJson(
          slideNote(id: i, denomination: 'Note $i', tags: tags, images: images),
        ),
    ];
    await tester.pumpWidget(
      MaterialApp(
        home: NoteSlideshowScreen(
          notes: notes,
          initialIndex: initialIndex,
          revealFolder: revealFolder ?? (_) async => true,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  FocusNode focusNodeOf(WidgetTester tester, Finder finder) =>
      Focus.of(tester.element(finder));

  /// Holds [path]'s image load open so a test can fail it after the plate has
  /// subscribed; a pre-failed completer would report before any listener could
  /// turn the error into the plate's notice.
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

  testWidgets('a plate is one button that names the face, not the picture', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSlideshow(tester);

    final front = find.bySemanticsLabel('Open front image');
    expect(front, findsOneWidget);
    final data = tester.getSemantics(front).getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.flagsCollection.isImage, isFalse);
    expect(data.hint, 'Opens full size');
    expect(data.hasAction(SemanticsAction.tap), isTrue);

    // The plate is one node: no unlabeled focus/tap node underneath it.
    expect(tester.getSemantics(front).childrenCount, 0);

    // The label chip and the picture add nothing of their own.
    expect(find.bySemanticsLabel('FRONT'), findsNothing);
    expect(find.bySemanticsLabel('Front image'), findsNothing);

    expect(find.bySemanticsLabel('Open back image'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('tab reaches a plate; enter opens it and the ring is 2px out', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester);

    final frontFocus = focusNodeOf(tester, find.text('FRONT'));
    await tabTo(tester, frontFocus);

    final ringFinder = find.byKey(const ValueKey('plateFocusRing'));
    expect(ringFinder, findsOneWidget);
    final mat = tester.getRect(find.byKey(const ValueKey('plateMat')).first);
    final ring = tester.getRect(ringFinder);
    expect(ring.left, mat.left - 4);
    expect(ring.top, mat.top - 4);
    expect(ring.right, mat.right + 4);
    expect(ring.bottom, mat.bottom + 4);

    final decoration =
        tester
                .widget<DecoratedBox>(
                  find.descendant(
                    of: ringFinder,
                    matching: find.byType(DecoratedBox),
                  ),
                )
                .decoration
            as BoxDecoration;
    final border = decoration.border! as Border;
    expect(border.top.width, 2);
    expect(border.top.color, ViewerPalette.accent);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
  });

  testWidgets('space opens the focused plate', (WidgetTester tester) async {
    await pumpSlideshow(tester);

    await tabTo(tester, focusNodeOf(tester, find.text('BACK')));
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();

    // The back plate opens the second image of the slide's sequence.
    expect(find.text('2 / 2'), findsOneWidget);
  });

  testWidgets('hovering a plate turns its hairline red and shows zoom', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester);

    Border matBorder() {
      final mat = tester.widget<AnimatedContainer>(
        find.byKey(const ValueKey('plateMat')).first,
      );
      return (mat.decoration! as BoxDecoration).border! as Border;
    }

    expect(matBorder().top.color, ViewerPalette.roomBorderControl);
    expect(find.byKey(const ValueKey('plateZoomCue')), findsNothing);

    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    addTearDown(mouse.removePointer);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(find.byType(Image).first));
    await tester.pumpAndSettle();

    expect(matBorder().top.color, ViewerPalette.accent);
    expect(find.byKey(const ValueKey('plateZoomCue')), findsOneWidget);
    expect(find.byIcon(Icons.zoom_in), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is MouseRegion && widget.cursor == SystemMouseCursors.zoomIn,
      ),
      findsNWidgets(2),
    );

    await mouse.moveTo(Offset.zero);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('plateZoomCue')), findsNothing);
  });

  testWidgets('the counter says Note 3 of 3 but keeps the pill short', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSlideshow(tester, noteCount: 3, initialIndex: 2);

    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.bySemanticsLabel('Note 3 of 3'), findsOneWidget);
    final data = tester
        .getSemantics(find.bySemanticsLabel('Note 3 of 3'))
        .getSemanticsData();
    expect(data.flagsCollection.isLiveRegion, isTrue);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
    expect(find.bySemanticsLabel('Note 1 of 3'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('a tag is a filter button that tab reaches and enter applies', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();

    setSurface(tester);

    final notes = [NoteRecord.fromJson(slideNote())];
    final result = ValueNotifier<NoteSlideshowResult?>(null);
    addTearDown(result.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => Center(
              child: TextButton(
                onPressed: () async {
                  result.value = await Navigator.of(context).push(
                    MaterialPageRoute<NoteSlideshowResult>(
                      builder: (_) => NoteSlideshowScreen(
                        notes: notes,
                        initialIndex: 0,
                        revealFolder: (_) async => true,
                      ),
                    ),
                  );
                },
                child: const Text('Open slideshow'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open slideshow'));
    await tester.pumpAndSettle();

    final chip = find.bySemanticsLabel('Filter by tag Bank of England');
    expect(chip, findsOneWidget);
    final data = tester.getSemantics(chip).getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);

    final chipFocus = focusNodeOf(tester, find.text('Bank of England'));
    await tabTo(tester, chipFocus);
    expect(find.byKey(const ValueKey('tagFocusRing')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(result.value?.tagName, 'Bank of England');
    expect(find.text('Open slideshow'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('Tab reaches both plates before any tag, in reading order', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester);

    // Each control's focus node, listed in reading order. Comparing the nodes
    // themselves keeps the assertion about the plates and chips, not their
    // debug labels.
    final readingOrder = <String, FocusNode>{
      'plate front': focusNodeOf(tester, find.text('FRONT')),
      'plate back': focusNodeOf(tester, find.text('BACK')),
      'tag Bank of England': focusNodeOf(tester, find.text('Bank of England')),
      'tag Polymer': focusNodeOf(tester, find.text('Polymer')),
      'tag Portrait': focusNodeOf(tester, find.text('Portrait')),
    };
    final labelOf = {
      for (final entry in readingOrder.entries) entry.value: entry.key,
    };
    // Distinct nodes, or one Tab could report several names in a row.
    expect(labelOf, hasLength(readingOrder.length));

    // Tab until every control has been reached. Stops that are not controls
    // (the top bar's Back button, the slide's own node) are skipped; only the
    // order of the controls matters here.
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

    // The picture pair leads; the tags that filter the collection come after.
    expect(visited, readingOrder.keys.toList());
  });

  testWidgets('reduce motion turns the 220ms page step into a jump', (
    WidgetTester tester,
  ) async {
    tester.platformDispatcher.accessibilityFeaturesTestValue =
        const FakeAccessibilityFeatures(disableAnimations: true);
    addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);

    await pumpSlideshow(tester, noteCount: 3);
    expect(find.text('1 / 3'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pump();
    expect(find.text('2 / 3'), findsOneWidget);
  });

  testWidgets('a missing image says so and offers no reveal without a file', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpSlideshow(tester, images: const []);

    expect(find.text('No image'), findsNWidgets(2));
    expect(find.byIcon(Icons.image_not_supported_outlined), findsNWidgets(2));
    expect(find.text('Reveal in folder'), findsNothing);

    final missing = find.bySemanticsLabel('Front image missing');
    expect(missing, findsOneWidget);
    final data = tester.getSemantics(missing).getSemanticsData();
    expect(data.flagsCollection.isButton, isFalse);
    expect(data.flagsCollection.isImage, isTrue);

    // No action, so Tab skips the plate.
    expect(focusNodeOf(tester, find.text('FRONT')).canRequestFocus, isFalse);
    handle.dispose();
  });

  testWidgets('a failed image is announced and offers Reveal in folder', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    final front = holdImage('/nope/front.png');
    final back = holdImage('/nope/back.png');

    final revealed = <String>[];
    await pumpSlideshow(
      tester,
      images: const [
        {'type': 'front', 'variant': 'full', 'filePath': '/nope/front.png'},
        {'type': 'back', 'variant': 'full', 'filePath': '/nope/back.png'},
      ],
      revealFolder: (path) async {
        revealed.add(path);
        return true;
      },
    );

    front.completeError(Exception('missing image'));
    back.completeError(Exception('missing image'));
    await tester.pumpAndSettle();

    expect(find.text('Could not load image'), findsNWidgets(2));
    expect(find.bySemanticsLabel('Front image could not load'), findsOneWidget);
    expect(find.bySemanticsLabel('Reveal in folder'), findsNWidgets(2));

    final reveal = find.text('Reveal in folder');
    expect(reveal, findsNWidgets(2));

    await tester.tap(reveal.first);
    await tester.pumpAndSettle();
    expect(revealed, ['/nope/front.png']);
    handle.dispose();
  });

  testWidgets('Reveal in folder works from the keyboard, not the plate', (
    WidgetTester tester,
  ) async {
    final front = holdImage('/nope/front.png');
    final back = holdImage('/nope/back.png');

    final revealed = <String>[];
    await pumpSlideshow(
      tester,
      images: const [
        {'type': 'front', 'variant': 'full', 'filePath': '/nope/front.png'},
        {'type': 'back', 'variant': 'full', 'filePath': '/nope/back.png'},
      ],
      revealFolder: (path) async {
        revealed.add(path);
        return true;
      },
    );

    front.completeError(Exception('missing image'));
    back.completeError(Exception('missing image'));
    await tester.pumpAndSettle();

    final revealFocus = focusNodeOf(
      tester,
      find.text('Reveal in folder').first,
    );
    await tabTo(tester, revealFocus);
    expect(find.byKey(const ValueKey('plateFocusRing')), findsNothing);
    expect(find.byKey(const ValueKey('revealFocusRing')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(revealed, ['/nope/front.png']);
    // The plate is no longer a button, so Enter must not open the popover.
    expect(find.text('1 / 2'), findsNothing);
  });

  testWidgets('a refused reveal reports it instead of doing nothing', (
    WidgetTester tester,
  ) async {
    final front = holdImage('/nope/front.png');
    final back = holdImage('/nope/back.png');

    await pumpSlideshow(
      tester,
      images: const [
        {'type': 'front', 'variant': 'full', 'filePath': '/nope/front.png'},
        {'type': 'back', 'variant': 'full', 'filePath': '/nope/back.png'},
      ],
      revealFolder: (_) async => false,
    );

    front.completeError(Exception('missing image'));
    back.completeError(Exception('missing image'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Reveal in folder').first);
    await tester.pumpAndSettle();

    expect(find.text('Could not open the image folder.'), findsOneWidget);
  });

  testWidgets('paging while a plate has focus keeps Enter working', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, noteCount: 3);

    await tabTo(tester, focusNodeOf(tester, find.text('FRONT')));
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('2 / 3'), findsOneWidget);
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'noteSlideshow');

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    // Note 2's front is the third image of the six in the sequence.
    expect(find.text('3 / 6'), findsOneWidget);
  });
}
