import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
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

  testWidgets('filter text input paints no background of its own', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final field = tester.widget<TextField>(find.byType(TextField));
    // Unfilled inputs paint neither a fill nor a hover wash, so the bar
    // behind them keeps one flat background on mouse hover.
    expect(field.decoration?.filled, isFalse);
  });

  testWidgets('filter scope options highlight on hover', (tester) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();

    final optionFinder = find.text('Denomination');
    expect(optionFinder, findsOneWidget);

    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(optionFinder));
    await tester.pumpAndSettle();

    // The hovered option carries the warm wash (the keyboard-focused
    // option may carry one too, so link the wash to its label).
    expect(
      find.descendant(of: _washFinder, matching: find.text('Denomination')),
      findsOneWidget,
    );

    await mouse.removePointer();
  });

  testWidgets('hovering the select highlights text and arrow as one', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final dropdownFinder = find.byKey(const ValueKey('filterScope'));
    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(dropdownFinder));
    await tester.pumpAndSettle();

    // One wash wrapping the whole select (label and arrow together),
    // not a separate pill behind the text.
    expect(
      find.ancestor(of: dropdownFinder, matching: _washFinder),
      findsOneWidget,
    );

    await mouse.removePointer();
  });

  testWidgets('keyboard focus highlights the select', (tester) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    final dropdownFinder = find.byKey(const ValueKey('filterScope'));
    tester
        .widget<DropdownButton<String>>(dropdownFinder)
        .focusNode!
        .requestFocus();
    await tester.pumpAndSettle();

    expect(
      find.ancestor(of: dropdownFinder, matching: _washFinder),
      findsOneWidget,
    );
  });

  testWidgets('arrow keys move the option highlight in the open menu', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();

    // The focused option reads like a hovered one: the selected option
    // is highlighted on open…
    expect(
      find.descendant(of: _washFinder, matching: find.text('Catalog')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: _washFinder, matching: find.text('Denomination')),
      findsNothing,
    );

    // …and the highlight follows the arrows.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();

    expect(
      find.descendant(of: _washFinder, matching: find.text('Denomination')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: _washFinder, matching: find.text('Catalog')),
      findsNothing,
    );
  });

  testWidgets('picking a scope with the pointer focuses the filter field', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Denomination'));
    await tester.pumpAndSettle();

    // The scope changed and typing lands straight in the filter field.
    expect(
      tester
          .widget<DropdownButton<String>>(
            find.byKey(const ValueKey('filterScope')),
          )
          .value,
      'denomination',
    );
    expect(_filterFieldHasFocus(tester), isTrue);
  });

  testWidgets('picking a scope with the keyboard focuses the filter field', (
    tester,
  ) async {
    final controller = DatasetController(repository: _FakeViewerRepository());
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('filterScope')));
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();

    expect(_filterFieldHasFocus(tester), isTrue);
  });
}

bool _filterFieldHasFocus(WidgetTester tester) {
  return tester.widget<TextField>(find.byType(TextField)).focusNode!.hasFocus;
}

Finder get _washFinder => find.byWidgetPredicate(
      (widget) =>
          widget is AnimatedContainer &&
          (widget.decoration as BoxDecoration?)?.color ==
              ViewerPalette.accentSoft,
    );

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
