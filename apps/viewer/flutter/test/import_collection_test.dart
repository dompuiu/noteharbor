import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/import/import_dataset_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<DatasetController> loadedController({bool failDelete = false}) async {
    final controller = DatasetController(
      repository: _CollectionRepository(failDelete: failDelete),
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

  testWidgets('active collection panel has no default button or source pill', (
    WidgetTester tester,
  ) async {
    await pumpImportScreen(tester, await loadedController());

    expect(find.text('Active collection'), findsOneWidget);
    expect(find.text('Delete collection'), findsOneWidget);
    expect(find.text('Set as default collection'), findsNothing);
    expect(find.text('Active source'), findsNothing);
    expect(find.text('NOTES'), findsOneWidget);
    expect(find.text('Notes (active)'), findsNothing);
    // No "(default)" suffix on the dropdown entries.
    expect(find.text('Alpha (2)'), findsOneWidget);
  });

  testWidgets('delete failure shows inline under the active collection', (
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

    expect(find.textContaining('Delete failed:'), findsOneWidget);
    // The message renders right under the panel, not in the bottom banner.
    expect(find.text('Import Dataset'), findsOneWidget);
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

    expect(find.text('Deleted Alpha.'), findsOneWidget);
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
  _CollectionRepository({required this.failDelete});

  final bool failDelete;
  final List<Map<String, Object?>> _collections = [
    {'id': 11, 'name': 'Alpha', 'noteCount': 2},
    {'id': 22, 'name': 'Beta', 'noteCount': 3},
  ];

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
