import 'dart:ui' show Tristate;

import 'package:flutter/foundation.dart';
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

    await tester.tap(_menuItem('Romania · 1917'));
    await tester.pumpAndSettle();

    expect(controller.showingAllNotes, isFalse);
    expect(controller.activeCollectionId, 2);
    expect(find.text('ROMANIA · 1917'), findsOneWidget);
    expect(find.text('50 Bani'), findsOneWidget);
    expect(find.text('25 Bani'), findsNothing);
    expect(find.text('1 note'), findsOneWidget);
  });

  testWidgets('All notes adds a sortable Collection column after ID', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    final controller = await _pumpTable(
      tester,
      size: const Size(1400, 900),
      notes: _groupedNotes,
    );

    await controller.showAllNotes();
    await tester.pumpAndSettle();

    expect(find.text('COLLECTION'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Collection, sorted ascending'),
      findsOneWidget,
    );

    // The column leads the scrolling pane, after the pinned ID and Front.
    final idLeft = tester.getTopLeft(find.text('#')).dx;
    final collectionLeft = tester.getTopLeft(find.text('COLLECTION')).dx;
    final denominationLeft = tester.getTopLeft(find.text('DENOMINATION')).dx;
    expect(collectionLeft, greaterThan(idLeft));
    expect(collectionLeft, lessThan(denominationLeft));
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('tablePinnedColumns')),
        matching: find.text('COLLECTION'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('tableHeader')),
        matching: find.text('COLLECTION'),
      ),
      findsOneWidget,
    );

    // Each row names its collection.
    expect(find.text("Serban's Notes"), findsNWidgets(2));
    expect(find.text('Romania · 1917'), findsOneWidget);
    expect(find.text('Duplicates'), findsOneWidget);

    // Default order groups by the switcher's collection order, then each
    // collection's display order — not by display order across collections.
    final top = {
      for (final id in [1, 2, 3, 4])
        id: tester.getTopLeft(find.byKey(ValueKey('tableRow-$id'))).dy,
    };
    expect(top[4]!, lessThan(top[2]!));
    expect(top[2]!, lessThan(top[3]!));
    expect(top[3]!, lessThan(top[1]!));

    // A collection scope drops both the column and the row's name.
    await controller.selectCollection(1);
    await tester.pumpAndSettle();

    expect(find.text('COLLECTION'), findsNothing);
    expect(find.text("Serban's Notes"), findsNothing);
    expect(find.bySemanticsLabel('Collection, sorted ascending'), findsNothing);

    handle.dispose();
  });

  testWidgets('Collection joins the header Tab chain only in All notes', (
    WidgetTester tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    try {
      final controller = await _pumpTable(
        tester,
        size: const Size(1400, 900),
      );

      await controller.showAllNotes();
      await tester.pumpAndSettle();

      await tester.sendKeyEvent(LogicalKeyboardKey.slash);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'tableHeader-displayOrder',
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'tableHeader-collection',
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'tableHeader-denomination',
      );

      // A collection scope skips the Collection header entirely.
      await controller.selectCollection(1);
      await tester.pumpAndSettle();

      await tester.sendKeyEvent(LogicalKeyboardKey.slash);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'tableHeader-displayOrder',
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'tableHeader-denomination',
      );
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('a note with an unknown collection keeps its row aligned', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(
      tester,
      size: const Size(1400, 900),
      notes: [
        _note(
          id: 1,
          collectionId: 1,
          denomination: '25 Bani',
          displayOrder: 1,
        ),
        _note(
          id: 5,
          collectionId: 99,
          denomination: '5 Lei',
          displayOrder: 2,
        ),
      ],
    );

    await controller.showAllNotes();
    await tester.pumpAndSettle();

    // The missing collection still occupies its cell as a dash, so the
    // denomination stays under its header instead of shifting left.
    final orphanDenomination = tester.getTopLeft(
      find.descendant(
        of: find.byKey(const ValueKey('tableRow-5')),
        matching: find.text('5 Lei'),
      ),
    );
    final knownDenomination = tester.getTopLeft(
      find.descendant(
        of: find.byKey(const ValueKey('tableRow-1')),
        matching: find.text('25 Bani'),
      ),
    );
    expect(orphanDenomination.dx, knownDenomination.dx);
  });

  testWidgets('All notes labels each card with its collection', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(
      tester,
      size: const Size(400, 900),
      notes: _groupedNotes,
    );

    await controller.showAllNotes();
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('tableHeader')), findsNothing);
    expect(
      find.textContaining("Serban's Notes", findRichText: true),
      findsNWidgets(2),
    );
    expect(
      find.textContaining('Romania · 1917', findRichText: true),
      findsOneWidget,
    );
    expect(
      find.textContaining('Duplicates', findRichText: true),
      findsOneWidget,
    );

    // The card sort menu offers Collection in All notes.
    await tester.tap(find.byKey(const ValueKey('cardSortKey')));
    await tester.pumpAndSettle();
    expect(find.text('Collection'), findsWidgets);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    // Leaving All notes removes the collection label from every card and
    // Collection from the sort menu.
    await controller.selectCollection(2);
    await tester.pumpAndSettle();

    expect(
      find.textContaining("Serban's Notes", findRichText: true),
      findsNothing,
    );
    expect(
      find.textContaining('COLLECTION ', findRichText: true),
      findsNothing,
    );

    await tester.tap(find.byKey(const ValueKey('cardSortKey')));
    await tester.pumpAndSettle();
    expect(find.text('Collection'), findsNothing);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
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

  testWidgets('All notes keeps counts in step through sort and filter changes', (
    WidgetTester tester,
  ) async {
    final controller = await _pumpTable(tester);
    await controller.showAllNotes();
    await tester.pumpAndSettle();

    expect(find.text('4 notes'), findsOneWidget);
    expect(find.text('4 notes · Sorted by Collection ↑'), findsOneWidget);

    await tester.tap(find.text('DENOMINATION'));
    await tester.pumpAndSettle();
    expect(find.text('4 notes'), findsOneWidget);
    expect(find.text('4 notes · Sorted by Denomination ↑'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All fields').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'bani');
    await tester.pumpAndSettle();

    // The filter reads against the whole archive, and the sort survives it.
    expect(find.text('2 of 4'), findsOneWidget);
    expect(find.text('2 of 4 · Sorted by Denomination ↑'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'zzz');
    await tester.pumpAndSettle();
    expect(find.text('No notes match this filter'), findsOneWidget);
    expect(find.text('0 of 4 · Sorted by Denomination ↑'), findsOneWidget);
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
  await tester.tap(_menuItem(label));
  await tester.pumpAndSettle();
}

/// A switcher row's label. All notes rows now repeat collection names, so a
/// bare text finder is ambiguous while the menu is open.
Finder _menuItem(String label) => find.descendant(
  of: find.byKey(const ValueKey('collectionMenu')),
  matching: find.text(label),
);

Future<DatasetController> _pumpTable(
  WidgetTester tester, {
  List<ViewerCollection> collections = _collections,
  List<NoteRecord>? notes,
  Size? size,
}) async {
  if (size != null) {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);
  }

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

/// Display orders cross the collections, so grouping by collection order is
/// visible in the row positions.
final List<NoteRecord> _groupedNotes = [
  _note(id: 1, collectionId: 3, denomination: '1 Leu', displayOrder: 1),
  _note(id: 2, collectionId: 1, denomination: '5 Lei', displayOrder: 3),
  _note(id: 3, collectionId: 2, denomination: '50 Bani', displayOrder: 2),
  _note(id: 4, collectionId: 1, denomination: '25 Bani', displayOrder: 1),
];

NoteRecord _note({
  required int id,
  required int collectionId,
  required String denomination,
  int? displayOrder,
}) {
  return NoteRecord(
    id: id,
    collectionId: collectionId,
    displayOrder: displayOrder ?? id,
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
