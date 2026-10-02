import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
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

  List<NoteRecord> manyNotes(int count) => [
        for (var i = 1; i <= count; i++)
          NoteRecord.fromJson(
            slideNote(id: i, denomination: 'N$i', withImages: true),
          ),
      ];

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

  // Drags a mouse across the front image, the largest drag surface on a slide.
  Future<void> mouseDrag(WidgetTester tester, Offset delta) async {
    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(Image).first),
      kind: PointerDeviceKind.mouse,
    );
    await gesture.moveBy(delta);
    await gesture.up();
    await tester.pumpAndSettle();
  }

  testWidgets('a mouse drag left and right pages between notes', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(3), initialIndex: 1);
    expect(find.text('2 / 3'), findsOneWidget);

    await mouseDrag(tester, const Offset(-600, 0));
    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.text('N3 - KB-3'), findsOneWidget);

    await mouseDrag(tester, const Offset(600, 0));
    expect(find.text('2 / 3'), findsOneWidget);
    expect(find.text('N2 - KB-2'), findsOneWidget);
  });

  testWidgets('a rightward mouse drag wraps from the first note to the last', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(3));
    expect(find.text('1 / 3'), findsOneWidget);

    await mouseDrag(tester, const Offset(600, 0));

    expect(find.text('3 / 3'), findsOneWidget);
    expect(find.text('N3 - KB-3'), findsOneWidget);
  });

  testWidgets('a leftward mouse drag wraps from the last note to the first', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(3), initialIndex: 2);
    expect(find.text('3 / 3'), findsOneWidget);

    await mouseDrag(tester, const Offset(-600, 0));

    expect(find.text('1 / 3'), findsOneWidget);
    expect(find.text('N1 - KB-1'), findsOneWidget);
  });

  testWidgets('a touch swipe wraps at both ends', (WidgetTester tester) async {
    await pumpSlideshow(tester, manyNotes(3));
    expect(find.text('1 / 3'), findsOneWidget);

    await tester.drag(find.byType(Image).first, const Offset(600, 0));
    await tester.pumpAndSettle();
    expect(find.text('3 / 3'), findsOneWidget);

    await tester.drag(find.byType(Image).first, const Offset(-600, 0));
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
  });

  testWidgets('a vertical mouse drag does not scroll the note card', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(1));
    expect(maxSlideScroll(tester), 0);
    expect(find.text('1 / 1'), findsOneWidget);

    await mouseDrag(tester, const Offset(0, -300));

    expect(maxSlideScroll(tester), 0);
    expect(find.text('1 / 1'), findsOneWidget);
  });

  testWidgets('a click on a slide image still opens the popover', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, manyNotes(1));

    await tester.tap(find.byType(Image).first);
    await tester.pumpAndSettle();

    expect(find.text('1 / 2'), findsOneWidget);
  });
}
