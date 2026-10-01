import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/note_slideshow_screen.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  Future<void> pumpSlideshow(
    WidgetTester tester,
    List<NoteRecord> notes, {
    int initialIndex = 0,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: NoteSlideshowScreen(notes: notes, initialIndex: initialIndex),
      ),
    );
    await tester.pumpAndSettle();
  }

  Map<String, dynamic> slideNote({
    required int id,
    required String denomination,
    required bool withImages,
  }) {
    return {
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
      'tags': [],
      'images': withImages
          ? [
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
            ]
          : [],
      'scrapedData': null,
    };
  }

  testWidgets('enter opens the image popover for the current slide', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
    ];
    await pumpSlideshow(tester, notes);
    expect(find.text('1 / 1'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
  });

  testWidgets('space opens the image popover for the current slide', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
    ];
    await pumpSlideshow(tester, notes);

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
  });

  double maxSlideScroll(WidgetTester tester) {
    var max = 0.0;
    for (final element in find.byType(SingleChildScrollView).evaluate()) {
      final controller = (element.widget as SingleChildScrollView).controller;
      if (controller != null && controller.hasClients) {
        final pixels = controller.position.pixels;
        if (pixels > max) {
          max = pixels;
        }
      }
    }
    return max;
  }

  testWidgets('arrow down scrolls the slide instead of opening the popover', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
    ];
    await pumpSlideshow(tester, notes);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsNothing);
    expect(maxSlideScroll(tester), greaterThan(0));
  });

  testWidgets('arrow up scrolls the slide back up', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
    ];
    await pumpSlideshow(tester, notes);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    final scrolled = maxSlideScroll(tester);
    expect(scrolled, greaterThan(0));

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    expect(maxSlideScroll(tester), lessThan(scrolled));
  });

  testWidgets('back from the popover returns to the slide', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
    ];
    await pumpSlideshow(tester, notes);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);

    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(find.text('1 / 1'), findsOneWidget);
  });

  testWidgets('arrow left on the first slide stays on the first slide', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
      NoteRecord.fromJson(slideNote(id: 2, denomination: 'B', withImages: true)),
    ];
    await pumpSlideshow(tester, notes);
    expect(find.text('1 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
  });

  testWidgets('arrow right on the last slide stays on the last slide', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
      NoteRecord.fromJson(slideNote(id: 2, denomination: 'B', withImages: true)),
    ];
    await pumpSlideshow(tester, notes, initialIndex: 1);
    expect(find.text('2 / 2'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(find.text('2 / 2'), findsOneWidget);
  });

  testWidgets('enter does nothing when the slide has no images', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(
        slideNote(id: 1, denomination: 'A', withImages: false),
      ),
    ];
    await pumpSlideshow(tester, notes);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(find.text('1 / 1'), findsOneWidget);
    expect(find.text('1 / 2'), findsNothing);
  });

  List<NoteRecord> manyNotes(int count) => [
        for (var i = 1; i <= count; i++)
          NoteRecord.fromJson(
            slideNote(id: i, denomination: 'N$i', withImages: true),
          ),
      ];

  testWidgets('home jumps to the first note', (WidgetTester tester) async {
    await pumpSlideshow(tester, manyNotes(5), initialIndex: 4);
    expect(find.text('5 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();

    expect(find.text('1 / 5'), findsOneWidget);
    expect(find.text('N1 - KB-1'), findsOneWidget);
  });

  testWidgets('end jumps to the last note', (WidgetTester tester) async {
    await pumpSlideshow(tester, manyNotes(5));
    expect(find.text('1 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('5 / 5'), findsOneWidget);
    expect(find.text('N5 - KB-5'), findsOneWidget);
  });

  testWidgets('end reaches the last note in one frame, not an animation', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(5));
    expect(find.text('1 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    // A single frame: an animated transition would still be in flight and the
    // index pill would not have moved to the endpoint yet.
    await tester.pump();
    expect(find.text('5 / 5'), findsOneWidget);
  });

  testWidgets('home on the first note changes nothing', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(5));
    expect(find.text('1 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pumpAndSettle();

    expect(find.text('1 / 5'), findsOneWidget);
  });

  testWidgets('end on the last note changes nothing', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(5), initialIndex: 4);
    expect(find.text('5 / 5'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('5 / 5'), findsOneWidget);
  });

  testWidgets('home and end change nothing in a single-note collection', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(1));
    expect(find.text('1 / 1'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('1 / 1'), findsOneWidget);
  });

  testWidgets('end works while the Back button holds focus', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(5));
    expect(find.text('1 / 5'), findsOneWidget);

    final backFocusNode = Focus.of(tester.element(find.text('Back')));
    backFocusNode.requestFocus();
    await tester.pump();
    expect(backFocusNode.hasFocus, isTrue);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pumpAndSettle();

    expect(find.text('5 / 5'), findsOneWidget);
  });

  testWidgets('ctrl+end does nothing', (WidgetTester tester) async {
    await pumpSlideshow(tester, manyNotes(5));
    expect(find.text('1 / 5'), findsOneWidget);

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();

    expect(find.text('1 / 5'), findsOneWidget);
  });
}
