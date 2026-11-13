import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<void> pumpTable(
    WidgetTester tester, {
    required int noteCount,
    Size size = const Size(900, 600),
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);

    final controller = DatasetController(
      repository: _SortRepository(noteCount: noteCount),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
  }

  Finder tableRow(int id) => find.byKey(ValueKey('tableRow-$id'));

  ScrollController verticalController(WidgetTester tester) =>
      tester.widget<ListView>(find.byType(ListView).last).controller!;

  testWidgets('sorting by denomination uses the domain comparator', (
    tester,
  ) async {
    await pumpTable(tester, noteCount: 4, size: const Size(1400, 700));

    await tester.tap(find.text('DENOMINATION'));
    await tester.pumpAndSettle();

    double top(int id) => tester.getTopLeft(tableRow(id)).dy;
    expect(top(4), lessThan(top(3)));
    expect(top(3), lessThan(top(2)));
    expect(top(2), lessThan(top(1)));

    await tester.tap(find.text('DENOMINATION'));
    await tester.pumpAndSettle();

    expect(top(1), lessThan(top(2)));
    expect(top(2), lessThan(top(3)));
    expect(top(3), lessThan(top(4)));
  });

  testWidgets('sorting resets the vertical offset to the top', (tester) async {
    await pumpTable(tester, noteCount: 40);
    final controller = verticalController(tester);

    controller.jumpTo(controller.position.maxScrollExtent);
    await tester.pump();
    expect(controller.offset, greaterThan(0));

    await tester.tap(find.text('DENOMINATION'));
    await tester.pumpAndSettle();

    expect(controller.offset, 0);
  });

  testWidgets('filtering resets the vertical offset to the top', (
    tester,
  ) async {
    await pumpTable(tester, noteCount: 40);
    final controller = verticalController(tester);

    controller.jumpTo(controller.position.maxScrollExtent);
    await tester.pump();
    expect(controller.offset, greaterThan(0));

    await tester.enterText(find.byType(TextField), 'M2');
    await tester.pumpAndSettle();

    expect(controller.offset, 0);
  });

  testWidgets('changing the filter scope resets the vertical offset', (
    tester,
  ) async {
    await pumpTable(tester, noteCount: 40);
    final controller = verticalController(tester);

    controller.jumpTo(controller.position.maxScrollExtent);
    await tester.pump();
    expect(controller.offset, greaterThan(0));

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Denomination').last);
    await tester.pumpAndSettle();

    expect(controller.offset, 0);
  });

  testWidgets('switching to All notes resets the panes and the sort', (
    tester,
  ) async {
    await pumpTable(tester, noteCount: 40);
    final controller = verticalController(tester);

    await tester.tap(find.text('DENOMINATION'));
    await tester.pumpAndSettle();
    expect(find.text('40 notes · Sorted by Denomination ↑'), findsOneWidget);

    controller.jumpTo(controller.position.maxScrollExtent);
    await tester.pump();
    expect(controller.offset, greaterThan(0));

    await tester.tap(find.byKey(const ValueKey('collectionTitle')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All notes'));
    await tester.pumpAndSettle();

    expect(controller.offset, 0);
    expect(find.text('40 notes · Sorted by Collection ↑'), findsOneWidget);
  });
}

class _SortRepository extends ViewerRepository {
  _SortRepository({required this.noteCount});

  final int noteCount;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': noteCount,
      'source': 'imported',
      'collections': [
        {'id': 1, 'name': 'Test Collection', 'noteCount': noteCount},
      ],
      'notes': [
        for (var index = 1; index <= noteCount; index++)
          {
            'id': index,
            'collectionId': 1,
            'displayOrder': index,
            'denomination': _denominationFor(index),
            'issueDate': '19${70 + index % 30}',
            'catalogNumber': 'M$index',
            'gradingCompany': 'PMG',
            'grade': '66',
            'watermark': '',
            'serial': '1234$index',
            'url': '',
            'notes': '',
            'scrapeStatus': 'done',
            'scrapeError': '',
            'tags': const <Map<String, dynamic>>[],
            'images': const <Map<String, dynamic>>[],
            'scrapedData': null,
          },
      ],
    });
  }

  String _denominationFor(int index) => switch (index) {
    1 => '1,000 Lei',
    2 => '100 Lei',
    3 => '20 Lei',
    4 => '5 Lei',
    _ => '$index Lei',
  };
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
