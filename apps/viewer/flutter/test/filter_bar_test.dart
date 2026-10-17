import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  testWidgets('filter scope select blends into the bar', (tester) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final dropdownFinder = find.byKey(const ValueKey('filterScope'));
    expect(dropdownFinder, findsOneWidget);

    final dropdown = tester.widget<DropdownButton<String>>(dropdownFinder);
    // No distinct background when the select holds focus.
    expect(dropdown.focusColor, Colors.transparent);
    // Square ink inside the bar; the bar itself owns the rounded corners.
    expect(dropdown.borderRadius, BorderRadius.zero);

    // The select fills the bar height instead of floating as an inset pill
    // (one 48px box is the select itself, the other is the outer bar).
    expect(
      find.ancestor(
        of: dropdownFinder,
        matching: find.byWidgetPredicate(
          (widget) => widget is SizedBox && widget.height == 48.0,
        ),
      ),
      findsWidgets,
    );

    // Hover must not paint a background over the bar.
    final theme = tester.widget<Theme>(
      find.ancestor(of: dropdownFinder, matching: find.byType(Theme)).first,
    );
    expect(theme.data.hoverColor, Colors.transparent);
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
