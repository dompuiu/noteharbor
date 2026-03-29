import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:viewer_flutter/data/dataset_controller.dart';
import 'package:viewer_flutter/data/viewer_repository.dart';
import 'package:viewer_flutter/features/import/import_dataset_screen.dart';
import 'package:viewer_flutter/features/table/notes_table_screen.dart';
import 'package:viewer_flutter/models/viewer_dataset.dart';

void main() {
  testWidgets('table screen renders imported dataset controls', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Note\nHarbor'), findsOneWidget);
    expect(find.text('5 Lei'), findsOneWidget);
    expect(find.byIcon(Icons.file_upload_outlined), findsOneWidget);
  });

  testWidgets('import screen shows first-run empty state', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(repository: _MissingViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: ImportDatasetScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Import data to get started'), findsOneWidget);
    expect(find.text('No dataset imported'), findsOneWidget);
    expect(find.text('Choose archive'), findsOneWidget);
  });
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

class _MissingViewerRepository extends ViewerRepository {
  _MissingViewerRepository();

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() {
    throw StateError('No imported dataset is installed.');
  }
}
