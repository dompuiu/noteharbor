import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/features/slideshow/note_slideshow_screen.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  Map<String, dynamic> slideNote(int id) {
    return {
      'id': id,
      'displayOrder': id,
      'denomination': 'N$id',
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
      'images': [
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

  Future<void> pumpAt(WidgetTester tester, Size size, {int count = 3}) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: NoteSlideshowScreen(
          notes: [
            for (var i = 1; i <= count; i++) NoteRecord.fromJson(slideNote(i)),
          ],
          initialIndex: 0,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  final previous = find.byKey(const ValueKey('slideChevronPrevious'));
  final next = find.byKey(const ValueKey('slideChevronNext'));

  /// The painted circle inside a chevron, which is the box the pointer sees.
  Finder circleOf(Finder chevron) =>
      find.descendant(of: chevron, matching: find.byType(Container));

  double opacityOf(WidgetTester tester, Finder chevron) => tester
      .widget<AnimatedOpacity>(
        find.descendant(of: chevron, matching: find.byType(AnimatedOpacity)),
      )
      .opacity;

  Border borderOf(WidgetTester tester, Finder chevron) {
    final circle = tester.widget<Container>(circleOf(chevron));
    return (circle.decoration! as BoxDecoration).border! as Border;
  }

  testWidgets(
    'a wide room caps the card and parks the chevrons in the gutter',
    (WidgetTester tester) async {
      await pumpAt(tester, const Size(1440, 900));

      expect(previous, findsOneWidget);
      expect(next, findsOneWidget);

      final card = tester.getRect(
        find.byKey(const ValueKey('slideCard')).first,
      );
      final previousRect = tester.getRect(circleOf(previous));
      final nextRect = tester.getRect(circleOf(next));

      // The card stops at 1040; its 1 px inset lives inside that box.
      expect(card.width, closeTo(1040, 0.5));

      // The circles stand outside the card, 24 px clear of its edge.
      expect(previousRect.size, const Size(46, 46));
      expect(previousRect.right, lessThan(card.left));
      expect(previousRect.right, closeTo(card.left - 24, 0.5));
      expect(nextRect.left, greaterThan(card.right));
      expect(nextRect.left, closeTo(card.right + 24, 0.5));
    },
  );

  testWidgets('a resting chevron reads at 35% and takes the ring on hover', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(1440, 900));

    expect(opacityOf(tester, previous), 0.35);
    expect(
      borderOf(tester, previous).top.color,
      ViewerPalette.roomBorderControl,
    );

    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    addTearDown(mouse.removePointer);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(circleOf(previous)));
    await tester.pumpAndSettle();

    expect(opacityOf(tester, previous), 1.0);
    expect(borderOf(tester, previous).top.color, ViewerPalette.accent);

    // Leaving the circle returns it to its quiet resting weight.
    await mouse.moveTo(Offset.zero);
    await tester.pumpAndSettle();
    expect(opacityOf(tester, previous), 0.35);
    expect(
      borderOf(tester, previous).top.color,
      ViewerPalette.roomBorderControl,
    );
  });

  testWidgets('a resting chevron is live, not inert until hover', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(1440, 900));
    expect(find.text('Note 1 of 3'), findsOneWidget);

    await tester.tap(previous);
    await tester.pumpAndSettle();

    // The sequence wraps, so the first note's previous is the last one.
    expect(find.text('Note 3 of 3'), findsOneWidget);
  });

  testWidgets('a page too narrow for a gutter has no chevrons', (
    WidgetTester tester,
  ) async {
    // 1200 leaves a 64 px gutter, below the 78 px a chevron needs.
    await pumpAt(tester, const Size(1200, 800));
    expect(previous, findsNothing);
    expect(next, findsNothing);

    // A phone has no gutter at all; swipe and drag keep paging.
    await pumpAt(tester, const Size(390, 844));
    expect(previous, findsNothing);
    expect(next, findsNothing);
  });

  testWidgets('a single-note collection has no chevrons', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(1440, 900), count: 1);

    expect(previous, findsNothing);
    expect(next, findsNothing);
  });
}
