import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<void> pumpTable(WidgetTester tester, Size size) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);

    final controller = DatasetController(
      repository: _DensityRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('grid rows use the 56px density with a 57px pitch', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, const Size(1829, 1000));

    final first = find.byKey(const ValueKey('tableRow-1'));
    final second = find.byKey(const ValueKey('tableRow-2'));
    expect(tester.getSize(first).height, 56);
    expect(tester.getTopLeft(second).dy - tester.getTopLeft(first).dy, 57);
  });

  testWidgets('grid rows mount a 40x24 thumbnail', (WidgetTester tester) async {
    await pumpTable(tester, const Size(1829, 1000));

    final icon = find.descendant(
      of: find.byKey(const ValueKey('pinnedTableRow-1')),
      matching: find.byIcon(Icons.image_outlined),
    );
    final placeholder = find
        .ancestor(of: icon, matching: find.byType(Container))
        .first;
    expect(tester.getSize(placeholder), const Size(40, 24));
  });

  testWidgets('wide grid columns share the spare width instead of a gutter', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, const Size(1829, 1000));

    final cardRightEdge = tester
        .getRect(find.byKey(const ValueKey('tableFooter')))
        .right;
    final tags = find.byKey(const ValueKey('tableHeaderCell-tags'));
    final denomination = find.byKey(
      const ValueKey('tableHeaderCell-denomination'),
    );

    // Tags takes its capped share and the text columns absorb the rest, so
    // the last cell lands on the card's 14px inner edge, not hundreds of
    // pixels short of it.
    expect(tester.getRect(tags).right, closeTo(cardRightEdge - 14, 1));
    expect(tester.getSize(tags).width, closeTo(320, 1));
    expect(tester.getSize(denomination).width, greaterThan(300));
  });

  testWidgets('grid data cells truncate long values on one line', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, const Size(1829, 1000));

    final paragraph = tester.renderObject<RenderParagraph>(
      find.text('A very long denomination that must truncate in the grid'),
    );
    expect(paragraph.didExceedMaxLines, isTrue);
    expect(paragraph.size.height, lessThanOrEqualTo(20));
  });
}

class _DensityRepository extends ViewerRepository {
  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 3,
      'source': 'imported',
      'collections': [
        {'id': 1, 'name': 'Test Collection', 'noteCount': 3},
      ],
      'notes': [
        for (var index = 1; index <= 3; index++)
          {
            'id': index,
            'collectionId': 1,
            'displayOrder': index,
            'denomination': index == 1
                ? 'A very long denomination that must truncate in the grid'
                : '$index Lei',
            'issueDate': '196$index',
            'catalogNumber': 'P-8$index',
            'gradingCompany': 'PMG',
            'grade': '66',
            'watermark': '',
            'serial': index == 1
                ? 'SERIAL-123456789012345678901234567890'
                : '12345$index',
            'url': '',
            'notes': '',
            'scrapeStatus': 'done',
            'scrapeError': '',
            'tags': [
              {'name': 'Romania'},
            ],
            'images': [],
            'scrapedData': null,
          },
      ],
    });
  }
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
