import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/import/import_dataset_screen.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<DatasetController> loadedController() async {
    final controller = DatasetController(repository: _ImportKeyboardRepository());
    await controller.load();
    return controller;
  }

  testWidgets('escape returns from the import screen to the table', (
    WidgetTester tester,
  ) async {
    final controller = await loadedController();
    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.file_upload_outlined));
    await tester.pumpAndSettle();
    expect(find.text('Import Dataset'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.text('Import Dataset'), findsNothing);
    expect(find.text('Note\nHarbor'), findsOneWidget);
  });

  testWidgets('escape on the first-run import screen does nothing', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(repository: _EmptyViewerRepository());
    await controller.load();
    await tester.pumpWidget(
      MaterialApp(home: ImportDatasetScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    // Still on the sole route; there is nowhere to go back to.
    expect(find.text('Import Dataset'), findsOneWidget);
  });

  testWidgets('escape closes the confirm dialog without leaving import', (
    WidgetTester tester,
  ) async {
    final controller = await loadedController();
    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.file_upload_outlined));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.byIcon(Icons.delete_outline_rounded),
      200,
    );
    await tester.tap(find.byIcon(Icons.delete_outline_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Delete imported data?'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    // The dialog dismisses; the import screen stays put.
    expect(find.text('Delete imported data?'), findsNothing);
    expect(find.text('Import Dataset'), findsOneWidget);
  });
}

class _ImportKeyboardRepository extends ViewerRepository {
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
          'gradingCompany': '',
          'grade': '',
          'watermark': '',
          'serial': '',
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

class _EmptyViewerRepository extends ViewerRepository {
  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() {
    throw StateError('No imported dataset is installed.');
  }
}
