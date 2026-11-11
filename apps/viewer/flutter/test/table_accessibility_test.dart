import 'dart:ui' show Tristate;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

const String _rowLabel =
    '5 Lei, dated 1966, catalog P-88, PMG, grade 66, '
    'serial 123456, tags Romania, Silver';

void main() {
  // The table's keyboard model only runs on desktop platforms; Windows keeps
  // the same shortcuts the other desktop targets use.
  void accessibilityTestWidgets(
    String description,
    Future<void> Function(WidgetTester tester) body,
  ) {
    testWidgets(description, (tester) async {
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      try {
        await body(tester);
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    });
  }

  Future<DatasetController> pumpTable(
    WidgetTester tester, {
    Size size = const Size(1400, 900),
    ViewerRepository? repository,
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);

    final controller = DatasetController(
      repository: repository ?? _AccessibilityRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
    return controller;
  }

  // The table owns the chip focus nodes, named for the note and tag so tests
  // can assert the explicit Tab chain without reaching into layout order.
  Finder chipFocusNode(String debugLabel) => find.byWidgetPredicate(
    (widget) => widget is Focus && widget.focusNode?.debugLabel == debugLabel,
  );

  testWidgets('a grid row reads as one button with a hint and its fields', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpTable(tester);

    expect(find.bySemanticsLabel(_rowLabel), findsOneWidget);

    final data = tester
        .getSemantics(find.bySemanticsLabel(_rowLabel))
        .getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.flagsCollection.isSelected, Tristate.isFalse);
    expect(data.hint, 'Opens this note');

    final actionLabels = {
      for (final id in data.customSemanticsActionIds ?? const <int>[])
        CustomSemanticsAction.getAction(id)?.label,
    };
    expect(actionLabels, containsAll(['Copy serial', 'Copy catalog number']));

    // The pinned half names the note's identity and describes its picture.
    final pinned = find.bySemanticsLabel(RegExp(r'^Note 1\b'));
    expect(pinned, findsOneWidget);
    final pinnedData = tester.getSemantics(pinned).getSemanticsData();
    expect(pinnedData.label, contains('Front image'));
    expect(pinnedData.flagsCollection.isButton, isTrue);
    expect(pinnedData.hint, 'Opens this note');

    handle.dispose();
  });

  accessibilityTestWidgets('the selected row is announced as selected', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();

    final data = tester
        .getSemantics(find.bySemanticsLabel(_rowLabel))
        .getSemanticsData();
    expect(data.flagsCollection.isSelected, Tristate.isTrue);

    handle.dispose();
  });

  accessibilityTestWidgets('tag chips are filter buttons with a 44 pt target', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpTable(tester);

    final chip = find.bySemanticsLabel('Filter by tag Romania');
    expect(chip, findsOneWidget);

    final data = tester.getSemantics(chip).getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.hasAction(SemanticsAction.tap), isTrue);

    final size = tester.getSize(chip);
    expect(size.width, greaterThanOrEqualTo(44));
    expect(size.height, greaterThanOrEqualTo(44));

    handle.dispose();
  });

  accessibilityTestWidgets('Tab reaches a row\'s chips and walks back out', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pumpAndSettle();
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');

    // Row 1 has tags, so Tab steps into its chips rather than the next row.
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(
      FocusManager.instance.primaryFocus?.debugLabel,
      'tagFilter-1-Romania',
    );

    // Tab walks chip to chip before it leaves the row.
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(
      FocusManager.instance.primaryFocus?.debugLabel,
      'tagFilter-1-Silver',
    );

    // The last chip hands focus back to the row chain.
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');

    // Shift+Tab from row 2 steps into row 1's last chip, then back to its
    // first chip, then its row.
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(
      FocusManager.instance.primaryFocus?.debugLabel,
      'tagFilter-1-Silver',
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(
      FocusManager.instance.primaryFocus?.debugLabel,
      'tagFilter-1-Romania',
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    expect(FocusManager.instance.primaryFocus?.debugLabel, 'notesTable');
  });

  accessibilityTestWidgets('Tab reveals a chip that starts off-screen', (
    WidgetTester tester,
  ) async {
    // 800 px is a grid window narrower than the nine-column table, so Tags
    // starts beyond the right edge.
    await pumpTable(tester, size: const Size(800, 700));

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();

    final chip = find.bySemanticsLabel('Filter by tag Romania');
    expect(chip, findsOneWidget);
    final chipRect = tester.getRect(chip);
    final paneRect = tester.getRect(find.byType(SingleChildScrollView));
    expect(chipRect.left, greaterThanOrEqualTo(paneRect.left - 0.5));
    expect(chipRect.right, lessThanOrEqualTo(paneRect.right + 0.5));
  });

  testWidgets('a dataset reload rebuilds the chip focus nodes', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    final controller = await pumpTable(
      tester,
      repository: _AccessibilityRepository(
        tagsAfterReload: const ['Silver', 'Gold', 'Europe'],
      ),
    );

    expect(find.bySemanticsLabel('Filter by tag Romania'), findsOneWidget);

    // The same note ids come back with a longer tag list. A stale node cache
    // would index past the new list while building the row.
    await controller.load();
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.bySemanticsLabel('Filter by tag Romania'), findsNothing);
    expect(find.bySemanticsLabel('Filter by tag Silver'), findsOneWidget);
    expect(find.bySemanticsLabel('Filter by tag Gold'), findsOneWidget);
    expect(find.bySemanticsLabel('Filter by tag Europe'), findsOneWidget);

    handle.dispose();
  });

  accessibilityTestWidgets(
    'a focused tag chip draws a ring and Enter filters',
    (WidgetTester tester) async {
      final handle = tester.ensureSemantics();
      await pumpTable(tester);

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();
      expect(
        FocusManager.instance.primaryFocus?.debugLabel,
        'tagFilter-1-Romania',
      );

      final ring = find.byKey(const ValueKey('tagChipFocusRing'));
      expect(ring, findsOneWidget);
      final decoration =
          tester.widget<DecoratedBox>(ring).decoration as BoxDecoration;
      expect((decoration.border! as Border).top.color, ViewerPalette.accent);
      expect((decoration.border! as Border).top.width, 2);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      // The chip's filter leaves only the Romania note.
      expect(find.bySemanticsLabel('1 of 3 notes'), findsOneWidget);

      handle.dispose();
    },
  );

  accessibilityTestWidgets('Space on a focused tag chip filters too', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pumpAndSettle();
    expect(chipFocusNode('tagFilter-1-Romania'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('1 of 3 notes'), findsOneWidget);
  });

  accessibilityTestWidgets('the count pill is a live region', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpTable(tester);

    final pill = find.bySemanticsLabel('3 of 3 notes');
    expect(pill, findsOneWidget);

    final before = tester.getSemantics(pill).getSemanticsData();
    expect(before.flagsCollection.isLiveRegion, isTrue);

    await tester.enterText(find.byType(TextField).first, 'P-88');
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('1 of 3 notes'), findsOneWidget);

    handle.dispose();
  });

  accessibilityTestWidgets(
    'the collection title rings on focus and names itself',
    (WidgetTester tester) async {
      await pumpTable(tester);

      final title = find.byKey(const ValueKey('collectionTitle'));
      final titleFocus = tester.widget<Focus>(
        find.ancestor(of: title, matching: find.byType(Focus)).first,
      );
      titleFocus.focusNode!.requestFocus();
      await tester.pumpAndSettle();

      final ring = tester.widget<DecoratedBox>(
        find.byKey(const ValueKey('collectionTitleFocusRing')),
      );
      final decoration = ring.decoration as BoxDecoration;
      expect((decoration.border! as Border).top.color, ViewerPalette.accent);
      expect((decoration.border! as Border).top.width, 2);

      final tooltip = tester.widget<Tooltip>(
        find.ancestor(of: title, matching: find.byType(Tooltip)).first,
      );
      expect(tooltip.message, "Switch collection: Serban's Notes");
    },
  );

  accessibilityTestWidgets('Ctrl+C copies the selected row serial', (
    WidgetTester tester,
  ) async {
    final clipboard = _clipboardRecorder(tester);
    await pumpTable(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.pump();

    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyC);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pump();

    expect(clipboard, ['123456']);
  });

  accessibilityTestWidgets('right click offers the catalog and serial copy', (
    WidgetTester tester,
  ) async {
    final clipboard = _clipboardRecorder(tester);
    await pumpTable(tester);

    await tester.tapAt(
      tester.getCenter(find.byKey(const ValueKey('tableRow-1'))),
      buttons: kSecondaryButton,
    );
    await tester.pumpAndSettle();

    expect(find.text('Copy catalog number'), findsOneWidget);
    await tester.tap(find.text('Copy serial'));
    await tester.pumpAndSettle();

    expect(clipboard, ['123456']);
  });

  testWidgets('card mode keeps tag chips tappable with the same label', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    await pumpTable(tester, size: const Size(520, 900));

    final chip = find.bySemanticsLabel('Filter by tag Romania');
    expect(chip, findsOneWidget);
    final size = tester.getSize(chip);
    // The card footer keeps the full 44 pt width but uses a 32 pt height so
    // its runs stay close together; the grid keeps the 44 pt target.
    expect(size.width, greaterThanOrEqualTo(44));
    expect(size.height, greaterThanOrEqualTo(32));

    handle.dispose();
  });

  testWidgets('200% text leaves the chip target and layout intact', (
    WidgetTester tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2.0;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    final handle = tester.ensureSemantics();
    await pumpTable(tester, size: const Size(420, 900));

    expect(tester.takeException(), isNull);
    final chip = find.bySemanticsLabel('Filter by tag Romania');
    expect(chip, findsOneWidget);
    final size = tester.getSize(chip);
    expect(size.width, greaterThanOrEqualTo(44));
    expect(size.height, greaterThanOrEqualTo(32));

    handle.dispose();
  });
}

List<String> _clipboardRecorder(WidgetTester tester) {
  final texts = <String>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (call) async {
      if (call.method == 'Clipboard.setData') {
        texts.add((call.arguments as Map<Object?, Object?>)['text']! as String);
      }
      return null;
    },
  );
  addTearDown(
    () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      null,
    ),
  );
  return texts;
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

class _AccessibilityRepository extends ViewerRepository {
  _AccessibilityRepository({this.tagsAfterReload});

  /// The first note's tags on every load after the first. Lets a test reload
  /// the same note ids with a different tag list.
  final List<String>? tagsAfterReload;

  int _loads = 0;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    final firstNoteTags = _loads++ == 0 || tagsAfterReload == null
        ? const ['Romania', 'Silver']
        : tagsAfterReload!;
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 3,
      'source': 'imported',
      'collections': [
        {'id': 1, 'name': "Serban's Notes", 'noteCount': 3},
        {'id': 2, 'name': 'Romania · 1917', 'noteCount': 0},
      ],
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
            for (final name in firstNoteTags) {'name': name},
          ],
          'images': [],
          'scrapedData': null,
        },
        {
          'id': 2,
          'collectionId': 1,
          'displayOrder': 2,
          'denomination': '1 Leu',
          'issueDate': '1917',
          'catalogNumber': 'P-5',
          'gradingCompany': 'PMG',
          'grade': '50',
          'watermark': '',
          'serial': '654321',
          'url': '',
          'notes': '',
          'scrapeStatus': 'done',
          'scrapeError': '',
          'tags': [],
          'images': [],
          'scrapedData': null,
        },
        {
          'id': 3,
          'collectionId': 1,
          'displayOrder': 3,
          'denomination': '10 Bani',
          'issueDate': '1900',
          'catalogNumber': 'P-1',
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
