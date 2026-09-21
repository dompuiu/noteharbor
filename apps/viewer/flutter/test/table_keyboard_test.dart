import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<void> pumpKeyboardTable(
    WidgetTester tester, {
    TargetPlatform platform = TargetPlatform.windows,
  }) async {
    debugDefaultTargetPlatformOverride = platform;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final controller = DatasetController(
      repository: _KeyboardNavRepository(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
  }

  Finder tableRow(int id) => find.byKey(ValueKey('tableRow-$id'));

  // The keyboard selection ring is a paint-only overlay and the only accent
  // border on the table screen.
  Finder selectedRing() => find.byWidgetPredicate((widget) {
        if (widget is! DecoratedBox) return false;
        final decoration = widget.decoration;
        if (decoration is! BoxDecoration) return false;
        final border = decoration.border;
        if (border is! Border) return false;
        return border.top.color == ViewerPalette.accent;
      });

  Finder selectedRow(int id) => find.descendant(
        of: tableRow(id),
        matching: selectedRing(),
      );

  testWidgets('arrow keys move keyboard selection between rows', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    expect(selectedRing(), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRing(), findsOneWidget);
    expect(selectedRow(1), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRing(), findsOneWidget);
    expect(selectedRow(2), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);
  });

  testWidgets('home and end jump to first and last rows', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pump();
    expect(selectedRow(5), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);
  });

  testWidgets('page down and page up jump across rows', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.pageDown);
    await tester.pumpAndSettle();
    expect(selectedRow(5), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.pageUp);
    await tester.pumpAndSettle();
    expect(selectedRow(1), findsOneWidget);
  });

  testWidgets('enter opens the slideshow at the selected row', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRow(2), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(find.text('Back'), findsOneWidget);
    expect(find.text('2 / 5'), findsOneWidget);

    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(selectedRow(2), findsOneWidget);
  });

  testWidgets('tap opens the note without moving keyboard selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    expect(selectedRing(), findsNothing);

    await tester.tap(find.text('Cello Note'));
    await tester.pumpAndSettle();
    expect(find.text('Back'), findsOneWidget);
    expect(find.text('3 / 5'), findsOneWidget);
  });

  testWidgets('escape clears the keyboard selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRing(), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(selectedRing(), findsNothing);
  });

  testWidgets('slash focuses search and typing does not move selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump();
    final searchField = tester.widget<TextField>(find.byType(TextField));
    expect(searchField.focusNode?.hasFocus, isTrue);

    // j is a table shortcut when the table has focus; while typing it must
    // insert text instead of moving the selection.
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller?.text,
      'j',
    );
    expect(selectedRing(), findsNothing);
  });

  testWidgets('filter changes reset the keyboard selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRing(), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Cello');
    await tester.pumpAndSettle();
    expect(selectedRing(), findsNothing);
    expect(find.text('Cello Note'), findsOneWidget);
    expect(find.text('Alpha Note'), findsNothing);
  });

  testWidgets('keyboard selection stays inert on iOS', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester, platform: TargetPlatform.iOS);

    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRing(), findsNothing);
  });
}

class _KeyboardNavRepository extends ViewerRepository {
  @override
  bool get canManageImportedDatasets => false;

  @override
  Future<ViewerDataset> loadDataset() async {
    const names = [
      'Alpha Note',
      'Bravo Note',
      'Cello Note',
      'Delta Note',
      'Echo Note',
    ];
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': names.length,
      'source': 'imported',
      'notes': [
        for (var i = 0; i < names.length; i++)
          {
            'id': i + 1,
            'displayOrder': i + 1,
            'denomination': names[i],
            'issueDate': '',
            'catalogNumber': 'KB-${i + 1}',
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
