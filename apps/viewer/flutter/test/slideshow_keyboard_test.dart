import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/note_slideshow_screen.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

void main() {
  Future<void> pumpSlideshow(
    WidgetTester tester,
    List<NoteRecord> notes,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: NoteSlideshowScreen(notes: notes, initialIndex: 0),
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

  testWidgets('arrow down opens the image popover for the current slide', (
    WidgetTester tester,
  ) async {
    final notes = [
      NoteRecord.fromJson(slideNote(id: 1, denomination: 'A', withImages: true)),
    ];
    await pumpSlideshow(tester, notes);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(find.text('1 / 2'), findsOneWidget);
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
}
