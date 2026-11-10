import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<void> pumpTable(
    WidgetTester tester, {
    Size size = const Size(400, 900),
    double textScale = 1,
    _CardRepository? repository,
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);

    final controller = DatasetController(
      repository: repository ?? _CardRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: size,
            textScaler: TextScaler.linear(textScale),
          ),
          child: NotesTableScreen(controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Finder card(int id) => find.byKey(ValueKey('noteCard-$id'));

  // The selection ring is the paint-only accent border with the card radius,
  // the same one the grid row cursor paints.
  Finder selectedCard(int id) => find.descendant(
    of: card(id),
    matching: find.byWidgetPredicate((widget) {
      if (widget is! DecoratedBox) return false;
      final decoration = widget.decoration;
      if (decoration is! BoxDecoration) return false;
      final border = decoration.border;
      if (border is! Border) return false;
      // The mounted image plate also carries an accent border when selected;
      // the selection ring is the paint-only border with no fill.
      if (decoration.color != null) return false;
      if (border.top.color != ViewerPalette.accent) return false;
      return decoration.borderRadius ==
          BorderRadius.circular(ViewerPalette.radiusMd);
    }),
  );

  testWidgets('wide windows keep the desktop grid', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, size: const Size(1400, 900));

    expect(find.byKey(const ValueKey('tableHeader')), findsOneWidget);
    expect(find.text('DENOMINATION'), findsOneWidget);
    expect(card(1), findsNothing);
    // The grid keeps its horizontal scroller for panning.
    expect(find.byType(SingleChildScrollView), findsOneWidget);
  });

  testWidgets('narrow windows replace the grid with readable note cards', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    expect(find.byKey(const ValueKey('tableHeader')), findsNothing);
    expect(card(1), findsOneWidget);
    expect(card(2), findsOneWidget);
    // Card mode never scrolls horizontally.
    expect(find.byType(SingleChildScrollView), findsNothing);

    // Denomination is the primary line; the collection position, catalogue
    // number, date, company, grade, and serial stay reachable around it.
    expect(find.text('5 Lei'), findsOneWidget);
    expect(find.text('No. 1'), findsOneWidget);
    expect(find.textContaining('CAT P-88', findRichText: true), findsOneWidget);
    expect(find.text('1966'), findsOneWidget);
    expect(find.text('PMG'), findsOneWidget);
    expect(find.text('66'), findsOneWidget);
    expect(
      find.textContaining('S/N 123456', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('Silver'), findsOneWidget);
    expect(find.text('Romania'), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('card grades wear the catalogue bands', (
    WidgetTester tester,
  ) async {
    await pumpTable(
      tester,
      size: const Size(400, 1200),
      repository: _CardRepository(noteCount: 4),
    );

    BoxDecoration pillDecoration(String grade) {
      final pill = tester.widget<Container>(
        find
            .ancestor(of: find.text(grade), matching: find.byType(Container))
            .first,
      );
      return pill.decoration! as BoxDecoration;
    }

    // 66 is uncirculated, 64 is choice.
    expect(pillDecoration('66').color, ViewerPalette.successSoft);
    expect(pillDecoration('64').color, ViewerPalette.warningSoft);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a card tap opens the slideshow and keeps the list position', (
    WidgetTester tester,
  ) async {
    await pumpTable(
      tester,
      size: const Size(400, 600),
      repository: _CardRepository(noteCount: 10),
    );

    await tester.drag(
      find.byKey(const ValueKey('noteCardList')),
      const Offset(0, -300),
    );
    await tester.pumpAndSettle();
    final controller = tester
        .widget<ListView>(find.byKey(const ValueKey('noteCardList')))
        .controller!;
    await tester.ensureVisible(card(4));
    await tester.pumpAndSettle();
    final scrolledOffset = controller.offset;
    expect(scrolledOffset, greaterThan(0));

    await tester.tap(card(4));
    await tester.pumpAndSettle();
    expect(find.text('Back'), findsOneWidget);
    expect(find.text('4 / 10'), findsOneWidget);

    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('noteCardList')), findsOneWidget);
    expect(controller.offset, scrolledOffset);
  });

  testWidgets('card mode keeps keyboard selection and the Tab chain', (
    WidgetTester tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    try {
      await pumpTable(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.slash);
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
        isTrue,
      );

      // Filter -> sort field -> sort direction -> first row.
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(FocusManager.instance.primaryFocus?.debugLabel, 'cardSort');

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'cardSortDirection',
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');
      expect(selectedCard(1), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      expect(selectedCard(2), findsOneWidget);

      // Shift+Tab from the first row steps back into the sort controls and
      // drops the row cursor, as the grid's header chain does.
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
      await tester.pump();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pump();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'cardSortDirection',
      );
      expect(selectedCard(1), findsNothing);

      // Shift+Tab from the sort field returns to the filter, not the scope
      // select the filter itself steps back to.
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pump();
      expect(FocusManager.instance.primaryFocus?.debugLabel, 'cardSort');
      await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
        isTrue,
      );
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('keyboard reveal reaches a card the lazy list has not built', (
    WidgetTester tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    try {
      await pumpTable(
        tester,
        size: const Size(400, 600),
        repository: _CardRepository(noteCount: 40),
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.end);
      await tester.pumpAndSettle();

      expect(selectedCard(40), findsOneWidget);
      final rect = tester.getRect(card(40));
      expect(rect.top, greaterThanOrEqualTo(0));
      expect(rect.bottom, lessThanOrEqualTo(600));
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('resizing across the breakpoint swaps grid and cards cleanly', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, size: const Size(1400, 900));
    expect(find.byKey(const ValueKey('tableHeader')), findsOneWidget);
    expect(card(1), findsNothing);

    tester.view.physicalSize = const Size(400, 900);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('tableHeader')), findsNothing);
    expect(card(1), findsOneWidget);

    tester.view.physicalSize = const Size(1400, 900);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('tableHeader')), findsOneWidget);
    expect(card(1), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the card sort menu and direction button reorder the list', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    expect(
      tester.getTopLeft(card(1)).dy,
      lessThan(tester.getTopLeft(card(2)).dy),
    );

    await tester.tap(find.byKey(const ValueKey('cardSortKey')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Catalog #').last);
    await tester.pumpAndSettle();

    // Catalog reads naturally: P-87, P-88, P-89 against display order
    // P-88, P-89, P-87.
    expect(
      tester.getTopLeft(card(3)).dy,
      lessThan(tester.getTopLeft(card(1)).dy),
    );
    expect(
      tester.getTopLeft(card(1)).dy,
      lessThan(tester.getTopLeft(card(2)).dy),
    );

    await tester.tap(find.byKey(const ValueKey('cardSortDirection')));
    await tester.pumpAndSettle();
    expect(
      tester.getTopLeft(card(2)).dy,
      lessThan(tester.getTopLeft(card(1)).dy),
    );
    expect(
      tester.getTopLeft(card(1)).dy,
      lessThan(tester.getTopLeft(card(3)).dy),
    );
  });

  testWidgets('200% text scale and long values stay inside the card', (
    WidgetTester tester,
  ) async {
    await pumpTable(
      tester,
      textScale: 2,
      repository: _CardRepository(longValues: true),
    );

    expect(card(1), findsOneWidget);
    expect(find.text('No. 1'), findsOneWidget);
    expect(
      find.text('A very long commemorative tag that must wrap'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);

    final cardRect = tester.getRect(card(1));
    expect(cardRect.left, greaterThanOrEqualTo(0));
    expect(cardRect.right, lessThanOrEqualTo(400));
  });

  testWidgets(
    '320 px at 200% with many tags keeps the header and cards inside',
    (WidgetTester tester) async {
      await pumpTable(
        tester,
        size: const Size(320, 700),
        textScale: 2,
        repository: _CardRepository(
          noteCount: 20,
          longValues: true,
          manyTags: true,
        ),
      );

      expect(card(1), findsOneWidget);
      expect(find.text('Tag 10'), findsOneWidget);
      expect(tester.takeException(), isNull);

      final cardRect = tester.getRect(card(1));
      expect(cardRect.left, greaterThanOrEqualTo(0));
      expect(cardRect.right, lessThanOrEqualTo(320));

      final titleFinder = find.text(
        'A COLLECTION NAME LONG ENOUGH TO NEED AN ELLIPSIS',
      );
      // The collection title still has a real line of its own, and the
      // counter and import action stay level with it at 200% text scale.
      final titleCenter = tester.getCenter(titleFinder).dy;
      expect(tester.getRect(titleFinder).height, lessThan(60));
      expect(
        (tester.getCenter(find.text('20 notes')).dy - titleCenter).abs(),
        lessThan(40),
      );
      expect(
        (tester.getCenter(find.byIcon(Icons.file_upload_outlined)).dy -
                titleCenter)
            .abs(),
        lessThan(40),
      );
    },
  );

  testWidgets('card-width headers keep the counter and import on one line', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, size: const Size(400, 900));

    final title = find.text('TEST COLLECTION');
    final counter = find.text('3 notes');
    final importIcon = find.byIcon(Icons.file_upload_outlined);
    expect(title, findsOneWidget);
    expect(counter, findsOneWidget);
    expect(importIcon, findsOneWidget);

    final titleCenter = tester.getCenter(title).dy;
    expect((tester.getCenter(counter).dy - titleCenter).abs(), lessThan(24));
    expect((tester.getCenter(importIcon).dy - titleCenter).abs(), lessThan(24));
    expect(tester.takeException(), isNull);
  });

  testWidgets('a long collection name ellipsizes on the header line', (
    WidgetTester tester,
  ) async {
    await pumpTable(
      tester,
      size: const Size(400, 900),
      repository: _CardRepository(longValues: true),
    );

    final titleFinder = find.text(
      'A COLLECTION NAME LONG ENOUGH TO NEED AN ELLIPSIS',
    );
    final paragraph = tester.renderObject<RenderParagraph>(titleFinder);
    expect(paragraph.didExceedMaxLines, isTrue);
    expect(tester.getRect(titleFinder).right, lessThanOrEqualTo(400));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the zero-match and empty states render in card mode', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    await tester.enterText(find.byType(TextField), 'zzz');
    await tester.pumpAndSettle();

    expect(find.text('No notes match this filter'), findsOneWidget);
    expect(find.text('Clear filter'), findsOneWidget);
    expect(find.text('Import notes'), findsNothing);
    expect(card(1), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Clear filter'));
    await tester.pumpAndSettle();
    expect(card(1), findsOneWidget);
  });

  testWidgets('an empty collection renders the empty state in card mode', (
    WidgetTester tester,
  ) async {
    await pumpTable(
      tester,
      repository: _CardRepository(empty: true, collectionName: 'Blank Album'),
    );

    expect(find.text('This collection is empty'), findsOneWidget);
    expect(find.textContaining('Blank Album'), findsOneWidget);
    expect(find.text('Import notes'), findsOneWidget);
    expect(find.text('Clear filter'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}

class _MemoryLastCollectionStore implements LastCollectionStore {
  LastCollectionSelection? saved;

  @override
  Future<LastCollectionSelection?> load() async => saved;

  @override
  Future<void> save(LastCollectionSelection selection) async {
    saved = selection;
  }

  @override
  Future<void> clear() async {
    saved = null;
  }
}

class _CardRepository extends ViewerRepository {
  _CardRepository({
    this.noteCount = 3,
    this.empty = false,
    this.longValues = false,
    this.manyTags = false,
    this.collectionName,
  });

  final int noteCount;
  final bool empty;
  final bool longValues;
  final bool manyTags;
  final String? collectionName;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    final notes = [
      for (var index = 0; index < (empty ? 0 : noteCount); index++)
        _note(index + 1),
    ];

    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': notes.length,
      'source': 'imported',
      'collections': [
        {
          'id': 1,
          'name':
              collectionName ??
              (longValues
                  ? 'A collection name long enough to need an ellipsis'
                  : 'Test Collection'),
          'noteCount': notes.length,
        },
      ],
      'notes': notes,
    });
  }

  Map<String, Object?> _note(int index) {
    const denominations = ['5 Lei', '10 Lei', '20 Lei'];
    return {
      'id': index,
      'collectionId': 1,
      'displayOrder': index,
      'denomination': longValues
          ? 'An extremely long denomination that has to wrap or ellipsize'
          : denominations[(index - 1) % denominations.length],
      'issueDate': longValues
          ? 'January 2, 1966'
          : switch (index) {
              1 => '1966',
              2 => '1967',
              _ => '1968',
            },
      'catalogNumber': 'P-8${7 + (index % 3)}',
      'gradingCompany': index == 3 ? '' : (index == 2 ? 'PCGS' : 'PMG'),
      'grade': index == 3
          ? ''
          : switch (index) {
              1 => '66',
              2 => '65',
              _ => '64',
            },
      'watermark': '',
      'serial': index == 3
          ? ''
          : switch (index) {
              1 => '123456',
              2 => '654321',
              _ => '112233',
            },
      'url': '',
      'notes': '',
      'scrapeStatus': 'done',
      'scrapeError': '',
      'tags': switch (index) {
        1 => [
          {
            'name': longValues
                ? 'A very long commemorative tag that must wrap'
                : 'Silver',
          },
          for (var tag = 1; tag <= (manyTags ? 10 : 0); tag++)
            {'name': 'Tag $tag'},
          {'name': 'Romania'},
        ],
        2 => [
          {'name': 'Gold'},
        ],
        _ => <Map<String, Object?>>[],
      },
      'images': [],
      'scrapedData': null,
    };
  }
}
