import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/import/import_dataset_screen.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  // debugDefaultTargetPlatformOverride must be reset synchronously at the
  // end of the test body: _verifyInvariants runs before addTearDown.
  void keyboardTestWidgets(
    String description,
    Future<void> Function(WidgetTester tester) body, {
    TargetPlatform platform = TargetPlatform.windows,
  }) {
    testWidgets(description, (tester) async {
      debugDefaultTargetPlatformOverride = platform;
      try {
        await body(tester);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });
  }

  Future<void> pumpKeyboardTable(WidgetTester tester) async {
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

  // The table's horizontal scroller is the only SingleChildScrollView on the
  // screen (the rows use a ListView).
  ScrollController columnsController(WidgetTester tester) => tester
      .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
      .controller!;

  keyboardTestWidgets('arrow keys move keyboard selection between rows', (
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

  keyboardTestWidgets('home and end jump to first and last rows', (
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

  keyboardTestWidgets('page down and page up jump across rows', (
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

  keyboardTestWidgets('enter opens the slideshow at the selected row', (
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

  keyboardTestWidgets('tap opens the note without moving keyboard selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    expect(selectedRing(), findsNothing);

    await tester.tap(find.text('Cello Note'));
    await tester.pumpAndSettle();
    expect(find.text('Back'), findsOneWidget);
    expect(find.text('3 / 5'), findsOneWidget);

    // A mouse-opened note returns without a selection ring.
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();
    expect(selectedRing(), findsNothing);
  });

  keyboardTestWidgets('clicking a row clears a keyboard selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);

    await tester.tap(find.text('Cello Note'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();

    expect(selectedRing(), findsNothing);
  });

  keyboardTestWidgets('escape clears the keyboard selection', (
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

  keyboardTestWidgets('up arrow with no selection selects the first row', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    expect(selectedRing(), findsNothing);

    // Up with nothing selected starts at the first row (matching the Editor),
    // not the last row.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);

    // A second Up hands off from the first row to the filter.
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pump();
    expect(selectedRing(), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isTrue,
    );
  });

  keyboardTestWidgets('up arrow from the first row focuses the filter', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
    await tester.pump();
    expect(selectedRing(), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isTrue,
    );
  });

  keyboardTestWidgets('home still lands on the first row', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.end);
    await tester.pump();
    expect(selectedRow(5), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isFalse,
    );
  });

  keyboardTestWidgets('tapping the filter clears the row selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);

    await tester.tap(find.byType(TextField));
    await tester.pump();
    expect(selectedRing(), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isTrue,
    );
  });

  keyboardTestWidgets('escape from the filter selects the first row', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    expect(selectedRing(), findsNothing);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isTrue,
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);
    expect(
      FocusManager.instance.primaryFocus?.debugLabel,
      'notesTable',
    );
  });

  keyboardTestWidgets('escape from the filter with no matches returns to table', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.enterText(find.byType(TextField), 'zzz');
    await tester.pumpAndSettle();
    expect(find.text('No notes match the current filter.'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(selectedRing(), findsNothing);
    expect(
      FocusManager.instance.primaryFocus?.debugLabel,
      'notesTable',
    );
  });

  keyboardTestWidgets('escape on the table clears active filters', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.enterText(find.byType(TextField), 'Cello');
    await tester.pumpAndSettle();
    expect(find.text('Alpha Note'), findsNothing);
    expect(find.text('Cello Note'), findsOneWidget);

    // Filter -> first row.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(selectedRow(3), findsOneWidget);

    // Focused row -> deselect.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(selectedRing(), findsNothing);

    // Deselected table -> clear the filters.
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pump();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller?.text,
      isEmpty,
    );
    expect(find.text('Alpha Note'), findsOneWidget);
    expect(find.text('Echo Note'), findsOneWidget);
  });

  keyboardTestWidgets('enter in the filter selects the first row', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);
  });

  keyboardTestWidgets('search keeps keys for typing instead of selection', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRing(), findsOneWidget);

    // Focusing the filter drops the row selection.
    await tester.sendKeyEvent(LogicalKeyboardKey.slash);
    await tester.pump();
    expect(selectedRing(), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isTrue,
    );

    // j/k/space/home are table shortcuts when the table has focus. While
    // typing they must reach the field instead: selection stays empty, focus
    // stays in search, and no note opens. (Character insertion itself comes
    // from the OS/engine text path, which widget tests cannot simulate, so
    // this guards the focus scoping rather than the inserted text.)
    await tester.sendKeyEvent(LogicalKeyboardKey.keyJ);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyK);
    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.sendKeyEvent(LogicalKeyboardKey.home);
    await tester.pump();
    expect(selectedRing(), findsNothing);
    expect(
      tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
      isTrue,
    );
    expect(find.text('Back'), findsNothing);
  });

  keyboardTestWidgets('clear button resets the filter', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.enterText(find.byType(TextField), 'Cello');
    await tester.pumpAndSettle();
    expect(find.text('Alpha Note'), findsNothing);

    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller?.text,
      isEmpty,
    );
    expect(find.text('Alpha Note'), findsOneWidget);
    expect(find.text('Echo Note'), findsOneWidget);
  });

  keyboardTestWidgets('filter changes reset the keyboard selection', (
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

  keyboardTestWidgets('left and right arrows scroll the columns', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    final controller = columnsController(tester);
    expect(controller.position.maxScrollExtent, greaterThan(0));
    expect(controller.offset, 0);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pumpAndSettle();
    expect(controller.offset, greaterThan(0));

    final afterRight = controller.offset;
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    await tester.pumpAndSettle();
    expect(controller.offset, lessThan(afterRight));
  });

  keyboardTestWidgets('ctrl plus left and right jump to the column edges', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    final controller = columnsController(tester);
    final maxExtent = controller.position.maxScrollExtent;

    Future<void> ctrlArrow(LogicalKeyboardKey key) async {
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(key);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pumpAndSettle();
    }

    await ctrlArrow(LogicalKeyboardKey.arrowRight);
    expect(controller.offset, maxExtent);

    await ctrlArrow(LogicalKeyboardKey.arrowLeft);
    expect(controller.offset, 0);
  });

  keyboardTestWidgets('dragging with the mouse pans the columns', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);
    final controller = columnsController(tester);
    expect(controller.offset, 0);

    final gesture = await tester.startGesture(
      tester.getCenter(tableRow(3)),
      kind: PointerDeviceKind.mouse,
    );
    for (var step = 0; step < 4; step++) {
      await gesture.moveBy(const Offset(-50, 0));
      await tester.pump();
    }
    await gesture.up();
    await tester.pumpAndSettle();

    expect(controller.offset, greaterThan(0));
    // A drag must not be mistaken for a tap that opens the slideshow.
    expect(find.text('Back'), findsNothing);
    // The table keeps primary focus so its shortcuts stay live.
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');
  });

  keyboardTestWidgets(
    'dragging a row while the filter has focus keeps keyboard control on the '
    'table',
    (WidgetTester tester) async {
      await pumpKeyboardTable(tester);

      // Put focus in the filter.
      await tester.sendKeyEvent(LogicalKeyboardKey.slash);
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
        isTrue,
      );

      // Grab a row with the mouse and pan the columns.
      final gesture = await tester.startGesture(
        tester.getCenter(tableRow(3)),
        kind: PointerDeviceKind.mouse,
      );
      for (var step = 0; step < 4; step++) {
        await gesture.moveBy(const Offset(-50, 0));
        await tester.pump();
      }
      await gesture.up();
      await tester.pumpAndSettle();

      // A drag has no onTap to fall back on: the table must own the keyboard
      // again, or the filter's tap-outside would leave focus on the route scope
      // and send the arrow keys to the import button instead.
      expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      expect(selectedRow(1), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.slash);
      await tester.pump();
      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus,
        isTrue,
      );
    },
  );

  keyboardTestWidgets('mouse drag clears the keyboard selection ring', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();
    expect(selectedRow(1), findsOneWidget);

    // Grabbing a row with the mouse is a pointer interaction: the ring is a
    // keyboard-only affordance and must drop even though no tap fires.
    final gesture = await tester.startGesture(
      tester.getCenter(tableRow(3)),
      kind: PointerDeviceKind.mouse,
    );
    for (var step = 0; step < 4; step++) {
      await gesture.moveBy(const Offset(-50, 0));
      await tester.pump();
    }
    await gesture.up();
    await tester.pumpAndSettle();

    expect(selectedRing(), findsNothing);
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');
  });

  keyboardTestWidgets('rows keep a normal cursor until panning on Windows', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    InkWell rowInk() => tester.widget<InkWell>(
          find.ancestor(of: tableRow(3), matching: find.byType(InkWell)),
        );
    expect(rowInk().mouseCursor, MouseCursor.defer);

    final gesture = await tester.startGesture(
      tester.getCenter(tableRow(3)),
      kind: PointerDeviceKind.mouse,
    );
    for (var step = 0; step < 4; step++) {
      await gesture.moveBy(const Offset(-50, 0));
      await tester.pump();
    }
    // Windows has no closed-hand cursor, so the pointing hand stands in.
    expect(rowInk().mouseCursor, SystemMouseCursors.click);

    await gesture.up();
    await tester.pumpAndSettle();
    expect(rowInk().mouseCursor, MouseCursor.defer);
  });

  keyboardTestWidgets(
    'rows show a closed hand while panning off Windows',
    (WidgetTester tester) async {
      await pumpKeyboardTable(tester);

      InkWell rowInk() => tester.widget<InkWell>(
            find.ancestor(of: tableRow(3), matching: find.byType(InkWell)),
          );
      expect(rowInk().mouseCursor, MouseCursor.defer);

      final gesture = await tester.startGesture(
        tester.getCenter(tableRow(3)),
        kind: PointerDeviceKind.mouse,
      );
      for (var step = 0; step < 4; step++) {
        await gesture.moveBy(const Offset(-50, 0));
        await tester.pump();
      }
      expect(rowInk().mouseCursor, SystemMouseCursors.grabbing);

      await gesture.up();
      await tester.pumpAndSettle();
      expect(rowInk().mouseCursor, MouseCursor.defer);
    },
    platform: TargetPlatform.macOS,
  );

  keyboardTestWidgets('the header keeps a normal cursor until panning', (
    WidgetTester tester,
  ) async {
    await pumpKeyboardTable(tester);

    MouseRegion headerRegion() =>
        tester.widget<MouseRegion>(find.byKey(const ValueKey('tableHeader')));
    expect(headerRegion().cursor, MouseCursor.defer);

    final gesture = await tester.startGesture(
      tester.getCenter(find.text('ID')),
      kind: PointerDeviceKind.mouse,
    );
    for (var step = 0; step < 4; step++) {
      await gesture.moveBy(const Offset(-50, 0));
      await tester.pump();
    }
    expect(headerRegion().cursor, SystemMouseCursors.click);

    await gesture.up();
    await tester.pumpAndSettle();
    expect(headerRegion().cursor, MouseCursor.defer);
  });

  keyboardTestWidgets(
    'the header shows a closed hand while panning off Windows',
    (WidgetTester tester) async {
      await pumpKeyboardTable(tester);

      MouseRegion headerRegion() =>
          tester.widget<MouseRegion>(find.byKey(const ValueKey('tableHeader')));
      expect(headerRegion().cursor, MouseCursor.defer);

      final gesture = await tester.startGesture(
        tester.getCenter(find.text('ID')),
        kind: PointerDeviceKind.mouse,
      );
      for (var step = 0; step < 4; step++) {
        await gesture.moveBy(const Offset(-50, 0));
        await tester.pump();
      }
      expect(headerRegion().cursor, SystemMouseCursors.grabbing);

      await gesture.up();
      await tester.pumpAndSettle();
      expect(headerRegion().cursor, MouseCursor.defer);
    },
    platform: TargetPlatform.macOS,
  );

  keyboardTestWidgets(
    'keyboard selection stays inert on iOS',
    (tester) async {
      await pumpKeyboardTable(tester);

      await tester.tap(find.byType(TextField));
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      expect(selectedRing(), findsNothing);
    },
    platform: TargetPlatform.iOS,
  );

  keyboardTestWidgets(
    'mouse wheel scroll drops the keyboard selection ring',
    (tester) async {
      await pumpKeyboardTable(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      expect(selectedRing(), findsOneWidget);

      final pointer = TestPointer(1, PointerDeviceKind.mouse);
      pointer.hover(tester.getCenter(tableRow(1)));
      await tester.sendEventToBinding(
        pointer.scroll(const Offset(0, 120)),
      );
      await tester.pumpAndSettle();

      expect(selectedRing(), findsNothing);
    },
  );

  keyboardTestWidgets(
    'table takes keyboard focus after the import-to-table swap',
    (tester) async {
      final controller = DatasetController(
        repository: _KeyboardNavRepository(),
      );
      await controller.load();

      Widget buildHome(Widget child) {
        return MaterialApp(
          home: AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            transitionBuilder: (widget, animation) => FadeTransition(
              opacity: animation,
              child: widget,
            ),
            child: child,
          ),
        );
      }

      await tester.pumpWidget(
        buildHome(ImportDatasetScreen(controller: controller)),
      );
      await tester.pumpAndSettle();
      expect(find.text('Import Dataset'), findsOneWidget);

      await tester.pumpWidget(
        buildHome(NotesTableScreen(controller: controller)),
      );
      await tester.pumpAndSettle();

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.pump();
      expect(selectedRing(), findsOneWidget);
    },
  );
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
