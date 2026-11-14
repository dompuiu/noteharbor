import 'package:flutter/gestures.dart';
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
  testWidgets('filter scope select blends into the bar', (tester) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final dropdownFinder = find.byKey(const ValueKey('filterScope'));
    expect(dropdownFinder, findsOneWidget);

    final dropdown = tester.widget<DropdownButton<String>>(dropdownFinder);
    // No distinct background when the select holds focus.
    expect(dropdown.focusColor, Colors.transparent);
    // Square ink inside the bar; the bar itself owns the rounded corners.
    expect(dropdown.borderRadius, BorderRadius.zero);

    // The select fills the bar height instead of floating as an inset pill
    // (one 40px box is the select itself, the other is the outer bar).
    expect(
      find.ancestor(
        of: dropdownFinder,
        matching: find.byWidgetPredicate(
          (widget) => widget is SizedBox && widget.height == 40.0,
        ),
      ),
      findsWidgets,
    );

    // Hover must not paint a background over the bar.
    final theme = tester.widget<Theme>(
      find.ancestor(of: dropdownFinder, matching: find.byType(Theme)).first,
    );
    expect(theme.data.hoverColor, Colors.transparent);
  });

  testWidgets("filter divider touches the bar's top and bottom borders", (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    // The 1px divider between the scope select and the text input spans
    // the bar's full interior height (40px bar minus the 1px borders),
    // touching the top and bottom edges instead of floating as a stub.
    final dividerFinder = find.byWidgetPredicate(
      (widget) =>
          widget is Container &&
          widget.constraints?.maxWidth == 1.0 &&
          widget.color == ViewerPalette.border,
    );
    expect(dividerFinder, findsOneWidget);
    expect(tester.getSize(dividerFinder).height, 40.0 - 2 * 1.0);
  });

  testWidgets('filter text input paints no background of its own', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final field = tester.widget<TextField>(find.byType(TextField));
    // Unfilled inputs paint neither a fill nor a hover wash, so the bar
    // behind them keeps one flat background on mouse hover.
    expect(field.decoration?.filled, isFalse);
  });

  testWidgets('filter hint is vertically centered in the bar', (tester) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final bar = tester.getRect(find.byKey(const ValueKey('filterBar')));
    final hint = tester.getRect(find.text('Filter catalog…'));
    final scopeLabel = tester.getRect(
      find
          .descendant(
            of: find.byKey(const ValueKey('filterScope')),
            matching: find.text('Catalog'),
          )
          .first,
    );

    // The input's text sits on the same line as the scope label, not low in
    // the field: the decorator's 48px minimum must not push it off-center.
    expect(hint.center.dy, closeTo(bar.center.dy, 0.5));
    expect(hint.center.dy, closeTo(scopeLabel.center.dy, 0.5));
  });

  testWidgets('filter scope options highlight on hover', (tester) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();

    final optionFinder = find.text('Denomination');
    expect(optionFinder, findsOneWidget);

    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(optionFinder));
    await tester.pumpAndSettle();

    // The hovered option carries the red wash (the keyboard-focused
    // option may carry one too, so link the wash to its label).
    expect(
      find.descendant(of: _washFinder, matching: find.text('Denomination')),
      findsOneWidget,
    );

    await mouse.removePointer();
  });

  testWidgets('hovering the select highlights text and arrow as one', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final dropdownFinder = find.byKey(const ValueKey('filterScope'));
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(dropdownFinder));
    await tester.pumpAndSettle();

    // One wash wrapping the whole select (label and arrow together),
    // not a separate pill behind the text.
    expect(
      find.ancestor(of: dropdownFinder, matching: _washFinder),
      findsOneWidget,
    );

    await mouse.removePointer();
  });

  testWidgets('keyboard focus highlights the select', (tester) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final dropdownFinder = find.byKey(const ValueKey('filterScope'));
    tester
        .widget<DropdownButton<String>>(dropdownFinder)
        .focusNode!
        .requestFocus();
    await tester.pumpAndSettle();

    expect(
      find.ancestor(of: dropdownFinder, matching: _washFinder),
      findsOneWidget,
    );
  });

  testWidgets('arrow keys move the option highlight in the open menu', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();

    // The focused option reads like a hovered one: the selected option
    // is highlighted on open…
    expect(
      find.descendant(of: _washFinder, matching: find.text('Catalog')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: _washFinder, matching: find.text('Denomination')),
      findsNothing,
    );

    // …and the highlight follows the arrows.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();

    expect(
      find.descendant(of: _washFinder, matching: find.text('Denomination')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: _washFinder, matching: find.text('Catalog')),
      findsNothing,
    );
  });

  testWidgets('picking a scope with the pointer focuses the filter field', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Denomination'));
    await tester.pumpAndSettle();

    // The scope changed and typing lands straight in the filter field.
    expect(
      tester
          .widget<DropdownButton<String>>(
            find.byKey(const ValueKey('filterScope')),
          )
          .value,
      'denomination',
    );
    expect(_filterFieldHasFocus(tester), isTrue);
  });

  testWidgets('picking a scope with the keyboard focuses the filter field', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(_filterFieldHasFocus(tester), isTrue);
  });

  testWidgets('filter bar caps at 560px and left-aligns with the card', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(1829, 1000);
    addTearDown(tester.view.reset);

    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final bar = find.byKey(const ValueKey('filterBar'));
    expect(tester.getSize(bar).width, 560);
    expect(tester.getSize(bar).height, 40);

    final card = tester.getRect(find.byKey(const ValueKey('tableFooter')));
    expect(tester.getRect(bar).left, closeTo(card.left, 1));
  });

  testWidgets('narrow filter bar keeps the scope label and field usable', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(400, 900);
    addTearDown(tester.view.reset);

    // The test font (Ahem) is much wider than Inter; load the bundled face so
    // the label-fit assertion reflects the real app.
    final inter = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/InterVariable.ttf'));
    await inter.load();

    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final bar = find.byKey(const ValueKey('filterBar'));
    expect(tester.getSize(bar).width, 400 - 24);

    final scope = find.byKey(const ValueKey('filterScope'));
    final scopeRect = tester.getRect(scope);
    expect(scopeRect.width, inInclusiveRange(180, 200));

    // The longest scope label must fit on one line, not ellipsize.
    await tester.tap(scope);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Denomination').last);
    await tester.pumpAndSettle();
    final label = tester.renderObject<RenderParagraph>(
      find.text('Denomination'),
    );
    expect(label.didExceedMaxLines, isFalse);

    expect(tester.getSize(find.byType(TextField)).width, greaterThan(180));
  });

  testWidgets('All notes opens on the Catalog filter scope', (tester) async {
    final controller = await _pumpAllNotes(tester, allNotes: false);

    // Leave a collection scope on another field: entering All notes resets the
    // filter field to its own default, the same one a collection opens on.
    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Denomination').last);
    await tester.pumpAndSettle();

    await controller.showAllNotes();
    await tester.pumpAndSettle();

    expect(
      tester
          .widget<DropdownButton<String>>(
            find.byKey(const ValueKey('filterScope')),
          )
          .value,
      'catalogNumber',
    );
    expect(find.text('Filter catalog…'), findsOneWidget);
  });

  testWidgets('All fields matches a collection name in All notes', (
    tester,
  ) async {
    await _pumpAllNotes(tester);

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All fields').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'romania');
    await tester.pumpAndSettle();

    // Only the second collection's notes name "Romania", so the combined
    // table narrows to them even though the word is not in any note field.
    expect(find.text('50 Bani'), findsOneWidget);
    expect(find.text('1 Leu'), findsOneWidget);
    expect(find.text('25 Bani'), findsNothing);
    expect(find.text('2 of 3'), findsOneWidget);

    // Every term may hit a different part of the row: the collection name
    // and the note's own denomination.
    await tester.enterText(find.byType(TextField), 'serban 25');
    await tester.pumpAndSettle();
    expect(find.text('25 Bani'), findsOneWidget);
    expect(find.text('1 of 3'), findsOneWidget);
  });

  testWidgets('All fields keeps collection names out of a collection scope', (
    tester,
  ) async {
    await _pumpAllNotes(tester, allNotes: false);

    // A collection scope shows no collection column, so its name is not part
    // of the search: "serban" matches no note field in Serban's Notes.
    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All fields').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'serban');
    await tester.pumpAndSettle();

    expect(find.text('No notes match this filter'), findsOneWidget);
  });

  testWidgets(
    'a tag chip filters across collections and Clear filter restores',
    (tester) async {
      tester.view.devicePixelRatio = 1.0;
      tester.view.physicalSize = const Size(1400, 900);
      addTearDown(tester.view.reset);

      final handle = tester.ensureSemantics();
      final controller = await _pumpAllNotes(tester);

      // Two notes in different collections share the Silver tag.
      await tester.tap(find.bySemanticsLabel('Filter by tag Silver').first);
      await tester.pumpAndSettle();

      expect(find.text('25 Bani'), findsOneWidget);
      expect(find.text('1 Leu'), findsOneWidget);
      expect(find.text('50 Bani'), findsNothing);
      expect(find.text('2 of 3'), findsOneWidget);
      // The chip hands the bar its Tags scope, as it does in a collection.
      expect(
        tester
            .widget<DropdownButton<String>>(
              find.byKey(const ValueKey('filterScope')),
            )
            .value,
        'tags',
      );

      await tester.tap(find.byTooltip('Clear filter'));
      await tester.pumpAndSettle();

      expect(find.text('3 notes'), findsOneWidget);
      expect(find.text('ALL NOTES'), findsOneWidget);
      expect(controller.showingAllNotes, isTrue);

      handle.dispose();
    },
  );
}

Future<DatasetController> _pumpAllNotes(
  WidgetTester tester, {
  bool allNotes = true,
}) async {
  final controller = DatasetController(
    repository: _AllNotesRepository(),
    selectionStore: _MemoryLastCollectionStore(),
  );
  await controller.load();

  await tester.pumpWidget(
    MaterialApp(home: NotesTableScreen(controller: controller)),
  );
  await tester.pumpAndSettle();

  if (allNotes) {
    await controller.showAllNotes();
    await tester.pumpAndSettle();
  }
  return controller;
}

bool _filterFieldHasFocus(WidgetTester tester) {
  return tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus;
}

Finder get _washFinder => find.byWidgetPredicate(
  (widget) =>
      widget is AnimatedContainer &&
      (widget.decoration as BoxDecoration?)?.color == ViewerPalette.accentSoft,
);

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

class _AllNotesRepository extends ViewerRepository {
  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 3,
      'source': 'imported',
      'collections': [
        {'id': 1, 'name': "Serban's Notes", 'noteCount': 1},
        {'id': 2, 'name': 'Romania · 1917', 'noteCount': 2},
      ],
      'notes': [
        {
          'id': 1,
          'collectionId': 1,
          'displayOrder': 1,
          'denomination': '25 Bani',
          'issueDate': '1917',
          'catalogNumber': 'P-1',
          'gradingCompany': '',
          'grade': '',
          'watermark': '',
          'serial': '111111',
          'url': '',
          'notes': '',
          'scrapeStatus': 'done',
          'scrapeError': '',
          'tags': [
            {'name': 'Silver'},
          ],
          'images': [],
          'scrapedData': null,
        },
        {
          'id': 2,
          'collectionId': 2,
          'displayOrder': 1,
          'denomination': '50 Bani',
          'issueDate': '1917',
          'catalogNumber': 'P-2',
          'gradingCompany': '',
          'grade': '',
          'watermark': '',
          'serial': '222222',
          'url': '',
          'notes': '',
          'scrapeStatus': 'done',
          'scrapeError': '',
          'tags': [],
          'images': [],
          'scrapedData': null,
        },
        {
          'id': 3,
          'collectionId': 2,
          'displayOrder': 2,
          'denomination': '1 Leu',
          'issueDate': '1917',
          'catalogNumber': 'P-3',
          'gradingCompany': '',
          'grade': '',
          'watermark': '',
          'serial': '333333',
          'url': '',
          'notes': '',
          'scrapeStatus': 'done',
          'scrapeError': '',
          'tags': [
            {'name': 'Silver'},
          ],
          'images': [],
          'scrapedData': null,
        },
      ],
    });
  }
}

class _FakeViewerRepository extends ViewerRepository {
  _FakeViewerRepository();

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 1,
      'source': 'imported',
      'notes': [
        {
          'id': 1,
          'displayOrder': 1,
          'denomination': '5 Lei',
          'issueDate': '1966',
          'catalogNumber': 'P-88',
          'gradingCompany': 'PMG',
          'grade': '66',
          'watermark': '',
          'serial': '123456',
          'url': '',
          'notes': '',
          'scrapeStatus': 'done',
          'scrapeError': '',
          'tags': [],
          'images': [],
          'scrapedData': null,
        },
      ],
    });
  }
}
