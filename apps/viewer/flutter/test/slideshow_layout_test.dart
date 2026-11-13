import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/note_slideshow_screen.dart';
import 'package:note_harbor_viewer/models/note_record.dart';
import 'package:note_harbor_viewer/widgets/grade_pill.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    // Layout assertions depend on Inter's real line widths; the test harness
    // otherwise measures with the wide Ahem fallback.
    final loader = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/InterVariable.ttf'));
    await loader.load();
  });

  Map<String, dynamic> slideNote({
    int id = 1,
    String denomination = 'Five Pounds',
    String issueDate = '2013',
    String catalogNumber = 'P-21a',
    String gradingCompany = 'PMG',
    String grade = '66 EPQ',
    String watermark = 'Britannia',
    String serial = 'AA01 234567',
    String url = 'bankofengland.co.uk/banknotes/5-pound-note',
    String notes =
        'Polymer issue, first series. Light centre fold visible under raking '
        'light; corners crisp.',
    List<String> tags = const ['Bank of England', 'Polymer', 'Portrait'],
    bool withImages = true,
  }) {
    return {
      'id': id,
      'displayOrder': id,
      'denomination': denomination,
      'issueDate': issueDate,
      'catalogNumber': catalogNumber,
      'gradingCompany': gradingCompany,
      'grade': grade,
      'watermark': watermark,
      'serial': serial,
      'url': url,
      'notes': notes,
      'scrapeStatus': 'done',
      'scrapeError': '',
      'tags': [
        for (final name in tags) {'name': name},
      ],
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

  Future<void> pumpAt(
    WidgetTester tester,
    Size size, {
    Map<String, dynamic>? json,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: NoteSlideshowScreen(
          notes: [NoteRecord.fromJson(json ?? slideNote())],
          initialIndex: 0,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// The furthest any slide's scroll view can travel. Zero means the whole
  /// slide fits the window without scrolling.
  double maxSlideScrollExtent(WidgetTester tester) {
    var furthest = 0.0;
    var attached = 0;
    for (final element in find.byType(SingleChildScrollView).evaluate()) {
      final controller = (element.widget as SingleChildScrollView).controller;
      if (controller != null && controller.hasClients) {
        attached++;
        furthest = math.max(furthest, controller.position.maxScrollExtent);
      }
    }
    // A missing scroll view would report zero and make a no-overflow check
    // pass without measuring anything.
    expect(attached, greaterThan(0), reason: 'no attached slide scroll view');
    return furthest;
  }

  void expectBothFacesVisible() {
    expect(find.text('FRONT'), findsOneWidget);
    expect(find.text('BACK'), findsOneWidget);
    expect(find.byType(Image), findsNWidgets(2));
  }

  /// The details sit under the faces rather than beside them.
  void expectDetailsBelowFaces(WidgetTester tester) {
    final backPlate = tester.getRect(
      find.byKey(const ValueKey('plateMat')).last,
    );
    expect(
      tester.getTopLeft(find.text('Details')).dy,
      greaterThan(backPlate.bottom),
    );
  }

  /// The details sit in a rail to the right of the faces.
  void expectDetailsBesideFaces(WidgetTester tester) {
    expect(
      tester.getTopLeft(find.text('Details')).dx,
      greaterThan(tester.getTopLeft(find.text('FRONT')).dx),
    );
  }

  void expectEveryFactVisible({String eyebrow = 'PMG · 2013'}) {
    // The header's eyebrow and catalog join the field rows, so a tier that
    // drops any of them fails here.
    expect(find.text(eyebrow), findsOneWidget);
    expect(find.text('P-21a'), findsOneWidget);
    expect(find.text('GRADE'), findsOneWidget);
    expect(find.text('66 EPQ'), findsOneWidget);
    expect(find.text('SERIAL'), findsOneWidget);
    expect(find.text('AA01 234567'), findsOneWidget);
    expect(find.text('WATERMARK'), findsOneWidget);
    expect(find.text('Britannia'), findsOneWidget);
    expect(find.text('TAGS'), findsOneWidget);
    expect(find.text('Bank of England'), findsOneWidget);
    expect(find.text('Polymer'), findsOneWidget);
    expect(find.text('Portrait'), findsOneWidget);
    expect(find.text('SOURCE'), findsOneWidget);
    expect(
      find.text('bankofengland.co.uk/banknotes/5-pound-note'),
      findsOneWidget,
    );
    expect(find.text('NOTES'), findsOneWidget);
    expect(find.textContaining('Polymer issue, first series.'), findsOneWidget);
  }

  testWidgets('the widest tier puts the pair beside a details rail', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(1440, 900));

    // Both faces at equal weight, each with a room label.
    expectBothFacesVisible();

    // The details sit beside the pair, not below it.
    expectDetailsBesideFaces(tester);

    // The catalog lives in the rail header, not as a duplicate field row.
    expect(find.text('Details'), findsOneWidget);
    expect(find.text('CATALOG'), findsNothing);

    expect(find.byType(GradePill), findsOneWidget);
    expectEveryFactVisible();

    // The room title takes the presentation room step.
    final title = tester.widget<Text>(find.text('FIVE POUNDS - P-21A'));
    expect(title.style!.fontSize, 33.6);

    // Nothing hangs below the fold.
    expect(maxSlideScrollExtent(tester), 0);
  });

  testWidgets(
    'the middle tier fits the pair and a four-column strip at 815x493',
    (WidgetTester tester) async {
      await pumpAt(tester, const Size(815, 493));

      expectBothFacesVisible();
      expect(find.byType(GradePill), findsOneWidget);

      // Facts beside the note, below the pair; a narrow window scrolls nothing.
      expectDetailsBelowFaces(tester);
      expectEveryFactVisible();
      expect(maxSlideScrollExtent(tester), 0);
    },
  );

  testWidgets('a 390x844 phone stacks the faces over the details and scrolls', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(390, 844));

    expectBothFacesVisible();
    // The stack keeps the company as its eyebrow and the issue date as its own
    // line under the title, as the pre-tier slide did.
    expectEveryFactVisible(eyebrow: 'PMG');
    expect(find.text('2013'), findsOneWidget);
    expect(
      tester.getTopLeft(find.text('2013')).dy,
      greaterThan(tester.getTopLeft(find.text('FIVE POUNDS - P-21A')).dy),
    );

    // The faces stack (the back under the front) with the details after them.
    expect(
      tester.getTopLeft(find.text('BACK')).dy,
      greaterThan(tester.getTopLeft(find.text('FRONT')).dy),
    );
    expectDetailsBelowFaces(tester);

    // The stack is taller than a phone window, so it scrolls rather than
    // clipping; the keyboard scroll tests cover reaching it.
    expect(maxSlideScrollExtent(tester), greaterThan(0));
  });

  testWidgets('the rail appears beside the pair at 1000 logical px', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, const Size(1000, 700));
    expectBothFacesVisible();
    expectDetailsBesideFaces(tester);
    expect(maxSlideScrollExtent(tester), 0);

    // One pixel narrower, the pair keeps the full width and the details
    // become a strip below it.
    await pumpAt(tester, const Size(999, 700));
    expectBothFacesVisible();
    expectDetailsBelowFaces(tester);
    expect(maxSlideScrollExtent(tester), 0);
  });

  testWidgets('empty fields and notes are left out', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      const Size(1440, 900),
      json: slideNote(
        grade: '',
        serial: '',
        watermark: '',
        url: '',
        notes: '   ',
        tags: const [],
        withImages: false,
      ),
    );

    expect(find.text('No image'), findsNWidgets(2));
    expect(find.byType(GradePill), findsNothing);
    expect(find.text('GRADE'), findsNothing);
    expect(find.text('SERIAL'), findsNothing);
    expect(find.text('WATERMARK'), findsNothing);
    expect(find.text('TAGS'), findsNothing);
    expect(find.text('SOURCE'), findsNothing);
    expect(find.text('NOTES'), findsNothing);
    expect(maxSlideScrollExtent(tester), 0);
  });
}
