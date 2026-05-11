import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/import/import_dataset_screen.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

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
    final controller =
        DatasetController(repository: _MissingViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: ImportDatasetScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Import data to get started'), findsOneWidget);
    expect(find.text('No dataset imported'), findsOneWidget);
    expect(find.text('Choose archive'), findsOneWidget);
  });

  testWidgets('catalog field filter excludes longer numeric prefixes', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(
      repository: _CatalogFilterViewerRepository(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'cat: 17');
    await tester.pumpAndSettle();

    expect(find.text('Match exact'), findsOneWidget);
    expect(find.text('Match suffix letter'), findsOneWidget);
    expect(find.text('Match dashed'), findsOneWidget);
    expect(find.text('Match dotted'), findsOneWidget);
    expect(find.text('Match slashed'), findsOneWidget);
    expect(find.text('Exclude numeric prefix'), findsNothing);
    expect(find.text('Exclude longer number'), findsNothing);
  });

  testWidgets('date and denomination filters accept comma-separated values', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(
      repository: _MultiValueFieldFilterViewerRepository(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byType(TextField),
      'date: January 2, 1966, March 4, 1967',
    );
    await tester.pumpAndSettle();

    expect(find.text('1,000 Lei'), findsOneWidget);
    expect(find.text('10 Lei'), findsOneWidget);
    expect(find.text('5,000 Lei'), findsNothing);
    expect(find.text('20 Lei'), findsNothing);

    await tester.enterText(
        find.byType(TextField), 'denom: 1,000 Lei, 5,000 Lei');
    await tester.pumpAndSettle();

    expect(find.text('1,000 Lei'), findsOneWidget);
    expect(find.text('5,000 Lei'), findsOneWidget);
    expect(find.text('10 Lei'), findsNothing);
    expect(find.text('20 Lei'), findsNothing);
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

class _CatalogFilterViewerRepository extends ViewerRepository {
  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 7,
      'source': 'imported',
      'notes': [
        _catalogFilterNote(
            id: 1,
            displayOrder: 1,
            denomination: 'Match exact',
            catalogNumber: '17'),
        _catalogFilterNote(
            id: 2,
            displayOrder: 2,
            denomination: 'Match suffix letter',
            catalogNumber: '17a'),
        _catalogFilterNote(
            id: 3,
            displayOrder: 3,
            denomination: 'Match dashed',
            catalogNumber: '17-1'),
        _catalogFilterNote(
            id: 4,
            displayOrder: 4,
            denomination: 'Match dotted',
            catalogNumber: '17.1'),
        _catalogFilterNote(
            id: 5,
            displayOrder: 5,
            denomination: 'Match slashed',
            catalogNumber: '17/1'),
        _catalogFilterNote(
            id: 6,
            displayOrder: 6,
            denomination: 'Exclude numeric prefix',
            catalogNumber: '117'),
        _catalogFilterNote(
            id: 7,
            displayOrder: 7,
            denomination: 'Exclude longer number',
            catalogNumber: '170'),
      ],
    });
  }
}

class _MultiValueFieldFilterViewerRepository extends ViewerRepository {
  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 4,
      'source': 'imported',
      'notes': [
        _filterableNote(
          id: 1,
          displayOrder: 1,
          denomination: '1,000 Lei',
          issueDate: 'January 2, 1966',
        ),
        _filterableNote(
          id: 2,
          displayOrder: 2,
          denomination: '10 Lei',
          issueDate: 'March 4, 1967',
        ),
        _filterableNote(
          id: 3,
          displayOrder: 3,
          denomination: '5,000 Lei',
          issueDate: 'May 6, 1968',
        ),
        _filterableNote(
          id: 4,
          displayOrder: 4,
          denomination: '20 Lei',
          issueDate: 'July 8, 1970',
        ),
      ],
    });
  }
}

Map<String, Object?> _catalogFilterNote({
  required int id,
  required int displayOrder,
  required String denomination,
  required String catalogNumber,
}) {
  return {
    'id': id,
    'displayOrder': displayOrder,
    'denomination': denomination,
    'issueDate': '1966',
    'catalogNumber': catalogNumber,
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
  };
}

Map<String, Object?> _filterableNote({
  required int id,
  required int displayOrder,
  required String denomination,
  required String issueDate,
}) {
  return {
    'id': id,
    'displayOrder': displayOrder,
    'denomination': denomination,
    'issueDate': issueDate,
    'catalogNumber': 'P-$id',
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
  };
}
