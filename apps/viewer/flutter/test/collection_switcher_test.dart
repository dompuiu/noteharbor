import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/dataset_source.dart';
import 'package:note_harbor_viewer/models/note_record.dart';
import 'package:note_harbor_viewer/models/viewer_collection.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

const List<ViewerCollection> _collections = [
  ViewerCollection(id: 1, name: "Serban's Notes", noteCount: 2),
  ViewerCollection(id: 2, name: 'Romania · 1917', noteCount: 1),
  ViewerCollection(id: 3, name: 'Duplicates', noteCount: 1),
];

void main() {
  testWidgets('title opens a collection menu and switches the collection', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);

    expect(find.text("SERBAN'S NOTES"), findsOneWidget);
    expect(find.byKey(const ValueKey('collectionMenu')), findsNothing);
    // The collection name starts on the same left edge as the brand eyebrow.
    expect(
      tester.getTopLeft(find.text("SERBAN'S NOTES")).dx,
      closeTo(tester.getTopLeft(find.text('NOTE HARBOR')).dx, 0.5),
    );
    // The chevron is always on screen so the title reads as a switcher
    // without waiting for hover or focus.
    expect(find.byIcon(Icons.expand_more), findsOneWidget);

    await _openSwitcher(tester);

    expect(find.byKey(const ValueKey('collectionMenu')), findsOneWidget);
    expect(find.text('Romania · 1917'), findsOneWidget);
    expect(find.text('Duplicates'), findsOneWidget);
    expect(find.byIcon(Icons.check), findsOneWidget);

    await tester.tap(find.text('Romania · 1917'));
    await tester.pumpAndSettle();

    expect(controller.activeCollectionId, 2);
    expect(find.byKey(const ValueKey('collectionMenu')), findsNothing);
    expect(find.text('ROMANIA · 1917'), findsOneWidget);
    expect(find.text('50 Bani'), findsOneWidget);
    expect(find.text('25 Bani'), findsNothing);
    // The table takes keyboard control back so arrows browse the new
    // collection immediately.
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');
  });

  testWidgets('typing filters the menu and Enter switches to the match', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);

    await _openSwitcher(tester);

    await tester.enterText(
      find.byKey(const ValueKey('collectionMenuFilter')),
      'dup',
    );
    await tester.pumpAndSettle();

    expect(find.text('Duplicates'), findsOneWidget);
    expect(find.text('Romania · 1917'), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(controller.activeCollectionId, 3);
    expect(find.text('DUPLICATES'), findsOneWidget);
  });

  testWidgets('Escape closes the menu without switching', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);

    await _openSwitcher(tester);
    expect(find.byKey(const ValueKey('collectionMenu')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('collectionMenu')), findsNothing);
    expect(controller.activeCollectionId, 1);
    expect(find.text("SERBAN'S NOTES"), findsOneWidget);
  });

  testWidgets('a single-collection library still offers All notes', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(
      tester,
      collections: [_collections.first],
    );

    expect(find.text("SERBAN'S NOTES"), findsOneWidget);
    // All notes is a second scope even when there is only one collection, so
    // the switcher stays.
    expect(find.byKey(const ValueKey('collectionTitle')), findsOneWidget);

    await _openSwitcher(tester);

    expect(find.byKey(const ValueKey('collectionMenu')), findsOneWidget);
    expect(find.text('All notes'), findsOneWidget);
    expect(find.text('COLLECTIONS'), findsOneWidget);

    await tester.tap(find.text('All notes'));
    await tester.pumpAndSettle();

    expect(controller.showingAllNotes, isTrue);
    expect(find.text('ALL NOTES'), findsOneWidget);
  });

  testWidgets('All notes leads the menu and shows every collection', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);

    await _openSwitcher(tester);

    // All notes sits above the COLLECTIONS heading and names the combined
    // count, so the whole-library scope reads beside the collections.
    expect(
      tester.getTopLeft(find.text('All notes')).dy,
      lessThan(tester.getTopLeft(find.text('COLLECTIONS')).dy),
    );
    expect(find.text('4'), findsOneWidget);

    await tester.tap(find.text('All notes'));
    await tester.pumpAndSettle();

    expect(controller.showingAllNotes, isTrue);
    expect(find.text('ALL NOTES'), findsOneWidget);
    // The table now shows notes from every collection, and the header and
    // footer count the combined set.
    expect(find.text('25 Bani'), findsOneWidget);
    expect(find.text('50 Bani'), findsOneWidget);
    expect(find.text('1 Leu'), findsOneWidget);
    expect(find.text('4 notes'), findsOneWidget);
    expect(find.text('4 notes · Sorted by Collection ↑'), findsOneWidget);

    // Reopening the menu marks All notes as the active scope.
    await _openSwitcher(tester);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('collectionMenuAllNotes')),
        matching: find.byIcon(Icons.check),
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('Romania · 1917'));
    await tester.pumpAndSettle();

    expect(controller.showingAllNotes, isFalse);
    expect(controller.activeCollectionId, 2);
    expect(find.text('ROMANIA · 1917'), findsOneWidget);
    expect(find.text('50 Bani'), findsOneWidget);
    expect(find.text('25 Bani'), findsNothing);
    expect(find.text('1 note'), findsOneWidget);
  });

  testWidgets('All notes is row 0 for the arrows and Enter', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);

    await _openSwitcher(tester);

    // The menu opens on the active collection, one row below All notes.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(controller.showingAllNotes, isTrue);
    expect(find.text('ALL NOTES'), findsOneWidget);
  });

  testWidgets('switching scope clears the view even when the id stays', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);

    await _chooseScope(tester, 'All notes');

    await tester.enterText(find.byType(TextField), 'P-3');
    await tester.pumpAndSettle();
    expect(find.text('1 of 4'), findsOneWidget);

    // The active collection underneath All notes is still Serban's Notes, so
    // choosing it changes only the scope. The filter and the All notes sort
    // still reset.
    await _chooseScope(tester, "Serban's Notes");

    expect(controller.activeCollectionId, 1);
    expect(controller.showingAllNotes, isFalse);
    expect(find.text('2 notes'), findsOneWidget);
    expect(find.text('2 notes · Sorted by ID ↑'), findsOneWidget);
    expect(find.text('25 Bani'), findsOneWidget);
    expect(find.text('5 Lei'), findsOneWidget);
  });

  testWidgets('All notes keeps the filter-empty copy and Clear filter', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);
    await controller.showAllNotes();
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'zzz');
    await tester.pumpAndSettle();

    expect(find.text('No notes match this filter'), findsOneWidget);
    expect(find.text('Clear filter'), findsOneWidget);

    await tester.tap(find.text('Clear filter'));
    await tester.pumpAndSettle();

    expect(find.text('25 Bani'), findsOneWidget);
    expect(find.text('1 Leu'), findsOneWidget);
  });

  testWidgets('an empty All notes names the archive', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(
      tester,
      collections: [_collections.first],
      notes: const [],
    );
    await controller.showAllNotes();
    await tester.pumpAndSettle();

    expect(find.text('ALL NOTES'), findsOneWidget);
    expect(find.text('This archive is empty'), findsOneWidget);
    expect(find.textContaining('every collection'), findsOneWidget);
    expect(find.text('Import archive'), findsOneWidget);
  });

  testWidgets('the All notes row and title announce the active scope', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    final controller = await _pumpTable(tester);
    await controller.showAllNotes();
    await tester.pumpAndSettle();

    // The title names the active scope, not a collection.
    expect(
      find.bySemanticsLabel('Scope: All notes. Activate to switch scope.'),
      findsOneWidget,
    );

    await _openSwitcher(tester);

    // The row speaks its count and its selected state.
    final row = find.bySemanticsLabel('All notes, 4 notes');
    expect(row, findsOneWidget);
    final data = tester.getSemantics(row).getSemanticsData();
    expect(data.flagsCollection.isSelected, Tristate.isTrue);
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.hasAction(SemanticsAction.tap), isTrue);

    handle.dispose();
  });
  testWidgets('the menu filter jumps to collections, not All notes', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);
    await controller.showAllNotes();
    await tester.pumpAndSettle();

    await _openSwitcher(tester);
    await tester.enterText(
      find.byKey(const ValueKey('collectionMenuFilter')),
      's',
    );
    await tester.pumpAndSettle();

    // "s" matches All notes as a substring too, but the filter's rows are
    // collections only, so Enter takes the first matching collection.
    expect(find.byKey(const ValueKey('collectionMenuAllNotes')), findsNothing);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(controller.showingAllNotes, isFalse);
    expect(controller.activeCollectionId, 1);
  });
}

Future<void> _openSwitcher(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('collectionTitle')));
  await tester.pumpAndSettle();
}

Future<void> _chooseScope(WidgetTester tester, String label) async {
  await _openSwitcher(tester);
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

Future<DatasetController> _pumpTable(
  WidgetTester tester, {
  List<ViewerCollection> collections = _collections,
  List<NoteRecord>? notes,
}) async {
  final controller = DatasetController(
    repository: _FakeRepository(collections, notes: notes),
    selectionStore: _MemoryLastCollectionStore(),
  );
  await controller.load();

  await tester.pumpWidget(
    MaterialApp(home: NotesTableScreen(controller: controller)),
  );
  await tester.pumpAndSettle();

  return controller;
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

class _FakeRepository extends ViewerRepository {
  _FakeRepository(this.collections, {List<NoteRecord>? notes})
    : notes = notes ?? _defaultNotes;

  final List<ViewerCollection> collections;
  final List<NoteRecord> notes;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset(
      generatedAt: '2026-03-28T12:00:00Z',
      noteCount: notes.length,
      notes: List.of(notes),
      collections: List.of(collections),
      source: DatasetSource.imported,
    );
  }
}

final List<NoteRecord> _defaultNotes = [
  _note(id: 1, collectionId: 1, denomination: '25 Bani'),
  _note(id: 2, collectionId: 1, denomination: '5 Lei'),
  _note(id: 3, collectionId: 2, denomination: '50 Bani'),
  _note(id: 4, collectionId: 3, denomination: '1 Leu'),
];

NoteRecord _note({
  required int id,
  required int collectionId,
  required String denomination,
}) {
  return NoteRecord(
    id: id,
    collectionId: collectionId,
    displayOrder: id,
    denomination: denomination,
    issueDate: '1917',
    catalogNumber: 'P-$id',
    gradingCompany: '',
    grade: '',
    watermark: '',
    serial: '',
    url: '',
    notes: '',
    scrapeStatus: 'done',
    scrapeError: '',
    tags: const [],
    images: const [],
    scrapedData: null,
  );
}
