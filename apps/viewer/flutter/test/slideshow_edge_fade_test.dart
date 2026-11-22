import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/note_slideshow_screen.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  Map<String, dynamic> slideNote() {
    return {
      'id': 1,
      'displayOrder': 1,
      'denomination': 'Five Pounds',
      'issueDate': '2013',
      'catalogNumber': 'P-21a',
      'gradingCompany': 'PMG',
      'grade': '66 EPQ',
      'watermark': 'Britannia',
      'serial': 'AA01 234567',
      'url': 'bankofengland.co.uk/banknotes/5-pound-note',
      'notes':
          'Polymer issue, first series. Light centre fold visible under raking '
          'light; corners crisp.',
      'scrapeStatus': 'done',
      'scrapeError': '',
      'tags': [
        {'name': 'Bank of England'},
        {'name': 'Polymer'},
        {'name': 'Portrait'},
      ],
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

  Future<void> pumpSlideshow(
    WidgetTester tester, {
    required Size size,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: NoteSlideshowScreen(
          notes: [NoteRecord.fromJson(slideNote())],
          initialIndex: 0,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// The slide body's one attached scroll position.
  ScrollPosition slidePosition(WidgetTester tester) {
    final scrollable = find.byType(SingleChildScrollView);
    for (final element in scrollable.evaluate()) {
      final controller = (element.widget as SingleChildScrollView).controller;
      if (controller != null && controller.hasClients) {
        return controller.position;
      }
    }
    fail('no attached slide scroll view');
  }

  double fadeOpacity(WidgetTester tester, String key) {
    return tester
        .widget<AnimatedOpacity>(find.byKey(ValueKey<String>(key)))
        .opacity;
  }

  testWidgets('an overflowing slide wears its bottom mask before scrolling', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, size: const Size(390, 844));
    expect(slidePosition(tester).maxScrollExtent, greaterThan(0));

    // The rest of the note sits below the fold on load, so the bottom edge
    // already dissolves into the card before the reader touches the wheel.
    expect(fadeOpacity(tester, 'slideBottomFade'), 1.0);
    expect(fadeOpacity(tester, 'slideTopFade'), 0.0);
  });

  testWidgets('a scrolled slide wears masks at both edges', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, size: const Size(390, 844));

    final position = slidePosition(tester);
    position.jumpTo(position.maxScrollExtent / 2);
    await tester.pumpAndSettle();

    // Content now leaves through both ends: each edge fades into the card.
    expect(fadeOpacity(tester, 'slideTopFade'), 1.0);
    expect(fadeOpacity(tester, 'slideBottomFade'), 1.0);
  });

  testWidgets('the masks clear only at the edge they guard', (
    WidgetTester tester,
  ) async {
    await pumpSlideshow(tester, size: const Size(390, 844));
    final position = slidePosition(tester);

    position.jumpTo(position.maxScrollExtent);
    await tester.pumpAndSettle();
    expect(fadeOpacity(tester, 'slideTopFade'), 1.0);
    expect(fadeOpacity(tester, 'slideBottomFade'), 0.0);

    position.jumpTo(0);
    await tester.pumpAndSettle();
    expect(fadeOpacity(tester, 'slideTopFade'), 0.0);
    expect(fadeOpacity(tester, 'slideBottomFade'), 1.0);
  });

  testWidgets('a slide that fits wears no mask', (WidgetTester tester) async {
    await pumpSlideshow(tester, size: const Size(1440, 900));
    expect(slidePosition(tester).maxScrollExtent, 0);

    // Nothing is cut, so neither edge darkens the note.
    expect(fadeOpacity(tester, 'slideTopFade'), 0.0);
    expect(fadeOpacity(tester, 'slideBottomFade'), 0.0);
  });
}
