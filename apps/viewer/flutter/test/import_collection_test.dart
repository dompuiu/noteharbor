import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/import/import_dataset_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<DatasetController> loadedController({
    bool failDelete = false,
    List<Map<String, Object?>>? collections,
  }) async {
    final controller = DatasetController(
      repository: _CollectionRepository(
        failDelete: failDelete,
        collections: collections,
      ),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();
    return controller;
  }

  Future<void> pumpImportScreen(
    WidgetTester tester,
    DatasetController controller,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: ImportDatasetScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
  }

  Future<void> pumpImportScreenAt(
    WidgetTester tester,
    DatasetController controller,
    Size size,
  ) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await pumpImportScreen(tester, controller);
  }

  testWidgets('import screen uses archive and collection with one Remove section', (
    WidgetTester tester,
  ) async {
    await pumpImportScreen(tester, await loadedController());

    expect(find.text('ACTIVE COLLECTION'), findsOneWidget);
    expect(find.text('ARCHIVE ON THIS DEVICE'), findsOneWidget);
    expect(find.text('Set as default collection'), findsNothing);
    expect(find.text('Active source'), findsNothing);
    expect(find.text('NOTES IN ALPHA'), findsOneWidget);
    expect(find.text('Notes (active)'), findsNothing);
    // No "(default)" suffix on the dropdown entries.
    expect(find.text('Alpha (2)'), findsOneWidget);

    // The drop zone is the only picker; no duplicate Choose archive button.
    await tester.scrollUntilVisible(find.text('Import archive'), 200);
    await tester.pumpAndSettle();
    expect(find.text('Choose archive'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Import archive'), findsOneWidget);

    // Both destructive actions share one subordinate Remove section, with a
    // row per scope: this collection, then the whole archive.
    await tester.scrollUntilVisible(find.text('Delete collection'), 200);
    await tester.pumpAndSettle();
    expect(find.text('REMOVE'), findsOneWidget);
    expect(find.text('COLLECTION'), findsOneWidget);
    expect(find.text('ARCHIVE'), findsOneWidget);
    expect(find.text('Delete collection'), findsOneWidget);
    expect(find.text('Delete archive'), findsOneWidget);
  });

  testWidgets('archive summary stacks its cells on a narrow window', (
    WidgetTester tester,
  ) async {
    await pumpImportScreenAt(
      tester,
      await loadedController(),
      const Size(360, 800),
    );

    final created = tester.getTopLeft(find.text('ARCHIVE CREATED'));
    final collections = tester.getTopLeft(find.text('COLLECTIONS'));
    final notes = tester.getTopLeft(find.text('NOTES IN ALPHA'));

    // One cell per row, each starting at the strip's left edge.
    expect(collections.dx, created.dx);
    expect(notes.dx, created.dx);
    expect(collections.dy, greaterThan(created.dy));
    expect(notes.dy, greaterThan(collections.dy));

    // The values stay on one line.
    expect(
      tester.widget<Text>(find.text('Mar 28, 2026 at 12:00 UTC')).maxLines,
      1,
    );
  });

  testWidgets('archive summary shares one row on a wide window', (
    WidgetTester tester,
  ) async {
    await pumpImportScreenAt(
      tester,
      await loadedController(),
      const Size(800, 900),
    );

    final created = tester.getTopLeft(find.text('ARCHIVE CREATED'));
    final collections = tester.getTopLeft(find.text('COLLECTIONS'));
    final notes = tester.getTopLeft(find.text('NOTES IN ALPHA'));

    // Three columns on one baseline, in reading order.
    expect(collections.dy, created.dy);
    expect(notes.dy, created.dy);
    expect(collections.dx, greaterThan(created.dx));
    expect(notes.dx, greaterThan(collections.dx));
  });

  testWidgets('archive summary reads each cell as one label and value', (
    WidgetTester tester,
  ) async {
    final semantics = tester.ensureSemantics();

    await pumpImportScreen(tester, await loadedController());

    expect(
      find.bySemanticsLabel('Archive created: Mar 28, 2026 at 12:00 UTC'),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Collections: 2'), findsOneWidget);
    expect(find.bySemanticsLabel('Notes in Alpha: 2'), findsOneWidget);
    // The visible label and value are not separate stops.
    expect(find.bySemanticsLabel('ARCHIVE CREATED'), findsNothing);
    expect(find.bySemanticsLabel('Mar 28, 2026 at 12:00 UTC'), findsNothing);

    semantics.dispose();
  });

  testWidgets('a long collection name keeps two label lines', (
    WidgetTester tester,
  ) async {
    // Ahem is much wider than Inter; load the bundled face so the wrap
    // assertion reflects the real app.
    final inter = FontLoader('Inter')
      ..addFont(rootBundle.load('assets/fonts/InterVariable.ttf'));
    await inter.load();

    await pumpImportScreenAt(
      tester,
      await loadedController(
        collections: const [
          {
            'id': 11,
            'name': 'Collection with a much longer name',
            'noteCount': 2,
          },
        ],
      ),
      const Size(800, 900),
    );

    final label = find.text('NOTES IN COLLECTION WITH A MUCH LONGER NAME');
    expect(label, findsOneWidget);
    // Wrapped, not squeezed onto one ellipsized line.
    expect(tester.getSize(label).height, greaterThan(20));
    expect(tester.widget<Text>(label).maxLines, 2);
  });

  testWidgets('delete failure shows inline in the remove section', (
    WidgetTester tester,
  ) async {
    await pumpImportScreen(tester, await loadedController(failDelete: true));

    await tester.scrollUntilVisible(find.text('Delete collection'), 200);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete collection'));
    await tester.pumpAndSettle();

    expect(find.text('Delete collection?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    // The result stays inside the Remove section, not in the page banner.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('removeSection')),
        matching: find.text('Could not delete the collection.'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('delete success shows inline confirmation', (
    WidgetTester tester,
  ) async {
    final controller = await loadedController();
    await pumpImportScreen(tester, controller);

    await tester.scrollUntilVisible(find.text('Delete collection'), 200);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete collection'));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(find.text('Deleted collection "Alpha".'), findsOneWidget);
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

class _CollectionRepository extends ViewerRepository {
  _CollectionRepository({
    required this.failDelete,
    List<Map<String, Object?>>? collections,
  }) : _collections = List.of(collections ?? _defaultCollections);

  static const List<Map<String, Object?>> _defaultCollections = [
    {'id': 11, 'name': 'Alpha', 'noteCount': 2},
    {'id': 22, 'name': 'Beta', 'noteCount': 3},
  ];

  final bool failDelete;
  final List<Map<String, Object?>> _collections;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 0,
      'source': 'imported',
      'notes': const [],
      'collections': List.of(_collections),
    });
  }

  @override
  Future<void> deleteCollection(int collectionId, {String? collectionName}) async {
    if (failDelete) {
      throw StateError(
        'Collection "Alpha" not found. Available: #11 "Alpha", #22 "Beta".',
      );
    }
    _collections.removeWhere((collection) => collection['id'] == collectionId);
  }
}
