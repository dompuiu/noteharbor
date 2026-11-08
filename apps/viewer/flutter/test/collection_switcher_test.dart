import 'package:flutter/material.dart';
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

    await tester.tap(find.byKey(const ValueKey('collectionTitle')));
    await tester.pumpAndSettle();

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

    await tester.tap(find.byKey(const ValueKey('collectionTitle')));
    await tester.pumpAndSettle();

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

    await tester.tap(find.byKey(const ValueKey('collectionTitle')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('collectionMenu')), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('collectionMenu')), findsNothing);
    expect(controller.activeCollectionId, 1);
    expect(find.text("SERBAN'S NOTES"), findsOneWidget);
  });

  testWidgets('a single-collection library keeps a plain title', (
    WidgetTester tester,
  ) async {
    await _pumpTable(tester, collections: [_collections.first]);

    expect(find.text("SERBAN'S NOTES"), findsOneWidget);
    expect(find.byKey(const ValueKey('collectionTitle')), findsNothing);

    await tester.tap(find.text("SERBAN'S NOTES"));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('collectionMenu')), findsNothing);
  });
}

Future<DatasetController> _pumpTable(
  WidgetTester tester, {
  List<ViewerCollection> collections = _collections,
}) async {
  final controller = DatasetController(
    repository: _FakeRepository(collections),
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
  _FakeRepository(this.collections);

  final List<ViewerCollection> collections;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset(
      generatedAt: '2026-03-28T12:00:00Z',
      noteCount: 4,
      notes: [
        _note(id: 1, collectionId: 1, denomination: '25 Bani'),
        _note(id: 2, collectionId: 1, denomination: '5 Lei'),
        _note(id: 3, collectionId: 2, denomination: '50 Bani'),
        _note(id: 4, collectionId: 3, denomination: '1 Leu'),
      ],
      collections: List.of(collections),
      source: DatasetSource.imported,
    );
  }
}

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
