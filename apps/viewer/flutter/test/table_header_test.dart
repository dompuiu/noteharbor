import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  testWidgets('header labels match the column model', (tester) async {
    await pumpTable(tester, const Size(1400, 900));

    expect(find.text('#'), findsOneWidget);
    expect(find.text('CATALOG #'), findsOneWidget);
    expect(find.text('ID'), findsNothing);
    expect(find.text('CATALOG'), findsNothing);
    expect(find.text('FRONT'), findsOneWidget);
  });

  testWidgets('sortable headers carry a rest indicator', (tester) async {
    await pumpTable(tester, const Size(1400, 900));

    // Eight sortable headers; only the active one shows a direction arrow.
    expect(find.byIcon(Icons.unfold_more_rounded), findsNWidgets(7));
    expect(find.byIcon(Icons.arrow_upward_rounded), findsOneWidget);
    expect(find.byIcon(Icons.arrow_downward_rounded), findsNothing);

    await tester.tap(find.text('#'));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.unfold_more_rounded), findsNWidgets(7));
    expect(find.byIcon(Icons.arrow_downward_rounded), findsOneWidget);
    expect(find.byIcon(Icons.arrow_upward_rounded), findsNothing);
  });

  testWidgets('sort state and direction are exposed to assistive tech', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpTable(tester, const Size(1400, 900));

    expect(find.bySemanticsLabel('Order, sorted ascending'), findsOneWidget);
    expect(find.bySemanticsLabel('Denomination, not sorted'), findsOneWidget);

    await tester.tap(find.text('#'));
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Order, sorted descending'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the footer reports the count and sort while columns pan', (
    tester,
  ) async {
    await pumpTable(tester, const Size(900, 700));

    expect(find.byKey(const ValueKey('tableResultSummary')), findsOneWidget);
    expect(find.byKey(const ValueKey('tablePanHint')), findsOneWidget);
    expect(find.byKey(const ValueKey('tableColumnsFade')), findsOneWidget);

    final scroller = tester.widget<SingleChildScrollView>(
      find.byType(SingleChildScrollView),
    );
    scroller.controller!.jumpTo(scroller.controller!.position.maxScrollExtent);
    await tester.pump();

    // At the end of the pan nothing sits past the edge, so the fade clears;
    // the pan hint itself stays because the columns still need panning.
    expect(find.byKey(const ValueKey('tableColumnsFade')), findsNothing);
    expect(find.byKey(const ValueKey('tablePanHint')), findsOneWidget);
  });

  testWidgets('wide windows keep the pan hint out of the layout', (
    tester,
  ) async {
    await pumpTable(tester, const Size(1400, 900));

    expect(find.byKey(const ValueKey('tableResultSummary')), findsOneWidget);
    expect(find.byKey(const ValueKey('tablePanHint')), findsNothing);
    expect(find.byKey(const ValueKey('tableColumnsFade')), findsNothing);
  });
}

Future<void> pumpTable(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final controller = DatasetController(repository: _FakeViewerRepository());
  await controller.load();

  await tester.pumpWidget(
    MaterialApp(home: NotesTableScreen(controller: controller)),
  );
  await tester.pumpAndSettle();
}

class _FakeViewerRepository extends ViewerRepository {
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
          'collectionId': 1,
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
