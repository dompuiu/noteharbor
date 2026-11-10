import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_app.dart';
import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/table/notes_table_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<void> pumpTable(
    WidgetTester tester, {
    Size size = const Size(1829, 1000),
    double textScale = 1,
    ViewerRepository? repository,
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);

    final controller = DatasetController(
      repository: repository ?? _TypeRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: size,
            textScaler: TextScaler.linear(textScale),
          ),
          child: NotesTableScreen(controller: controller),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  TextStyle paragraphStyle(WidgetTester tester, Finder finder) {
    return tester.renderObject<RenderParagraph>(finder).text.style!;
  }

  testWidgets('grid cells wear the Data, Code, ID, and Grade roles', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    final denomination = paragraphStyle(tester, find.text('5 Lei'));
    expect(denomination.fontSize, 13.5);
    expect(denomination.fontWeight, FontWeight.w600);
    expect(denomination.color, ViewerPalette.text);

    final serial = paragraphStyle(tester, find.text('123456'));
    expect(serial.fontSize, 13);
    expect(serial.fontWeight, FontWeight.w500);
    expect(serial.letterSpacing, closeTo(0.045, 0.001));
    expect(serial.color, ViewerPalette.textMuted);

    final id = paragraphStyle(
      tester,
      find.descendant(
        of: find.byKey(const ValueKey('pinnedTableRow-1')),
        matching: find.text('1'),
      ),
    );
    expect(id.fontSize, 13.5);
    expect(id.color, ViewerPalette.textFaint);

    final gradeText = paragraphStyle(tester, find.text('66'));
    expect(gradeText.fontSize, 13);
    expect(gradeText.fontWeight, FontWeight.w600);

    final pill = tester.widget<Container>(
      find
          .ancestor(of: find.text('66'), matching: find.byType(Container))
          .first,
    );
    expect(
      (pill.decoration! as BoxDecoration).color,
      ViewerPalette.successSoft,
    );
    expect(
      (pill.decoration! as BoxDecoration).borderRadius,
      BorderRadius.circular(ViewerPalette.radiusPill),
    );
  });

  testWidgets('empty values share one muted dash', (WidgetTester tester) async {
    await pumpTable(tester);

    final dashes = find.text('-');
    expect(dashes, findsWidgets);
    for (final element in dashes.evaluate()) {
      final paragraph = element.renderObject! as RenderParagraph;
      expect(paragraph.text.style?.color, ViewerPalette.textFaint);
      expect(paragraph.text.style?.fontSize, 13.5);
    }
  });

  testWidgets('the header count reads as notes, then visible of total', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    expect(find.text('3 notes'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'P-88');
    await tester.pumpAndSettle();

    expect(find.text('1 of 3'), findsOneWidget);
    expect(find.text('1 of 3 · Sorted by ID ↑'), findsOneWidget);
  });

  testWidgets('the filter scope tooltip names the action, not the field', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester);

    expect(
      find.byWidgetPredicate(
        (widget) => widget is Tooltip && widget.message == 'Filter by',
      ),
      findsOneWidget,
    );
  });

  testWidgets('long tag runs fall back to a dashed +N more chip', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, repository: _TypeRepository(manyTags: true));

    final tagCell = tester.getRect(
      find.byKey(const ValueKey('tableHeaderCell-tags')),
    );
    expect(tagCell.width, closeTo(320, 1));

    final overflow = find.byKey(const ValueKey('tagOverflowChip'));
    expect(overflow, findsOneWidget);
    expect(find.textContaining(' more'), findsOneWidget);

    // Every visible chip stays inside the Tags column instead of running
    // under the card edge.
    final chipLabels = tester
        .widgetList<Text>(find.byType(Text))
        .map((text) => text.data)
        .whereType<String>()
        .where((label) => label.startsWith('Tag '));
    expect(chipLabels, isNotEmpty);
    for (final label in chipLabels) {
      expect(
        tester.getRect(find.text(label)).right,
        lessThanOrEqualTo(tagCell.right),
      );
    }
  });

  testWidgets('200% text scale keeps many tags inside the capped column', (
    WidgetTester tester,
  ) async {
    await pumpTable(
      tester,
      textScale: 2,
      repository: _TypeRepository(manyTags: true),
    );

    expect(tester.takeException(), isNull);

    final tagCell = tester.getRect(
      find.byKey(const ValueKey('tableHeaderCell-tags')),
    );
    expect(tagCell.width, closeTo(320, 1));

    final overflow = find.byKey(const ValueKey('tagOverflowChip'));
    expect(overflow, findsOneWidget);
    expect(tester.getRect(overflow).right, lessThanOrEqualTo(tagCell.right));
  });

  testWidgets('picking a hidden tag from +N more filters the table', (
    WidgetTester tester,
  ) async {
    await pumpTable(tester, repository: _TypeRepository(manyTags: true));

    await tester.tap(find.byKey(const ValueKey('tagOverflowChip')));
    await tester.pumpAndSettle();

    final hiddenTag = find.text('Tag 12').last;
    await tester.tap(hiddenTag);
    await tester.pumpAndSettle();

    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      'Tag 12',
    );
    expect(find.text('1 of 3'), findsOneWidget);
    expect(find.text('5 Lei'), findsOneWidget);
    expect(find.text('Empty note'), findsNothing);
  });

  testWidgets('a loading table shows the in-card loading state', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(
      repository: _PendingRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    unawaited(controller.load());

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pump();

    expect(find.byKey(const ValueKey('tableLoadingCard')), findsOneWidget);
    expect(find.text('Loading notes…'), findsOneWidget);
    expect(
      find.text('Reading the collection from the archive.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a load error shows a clean card and a working retry', (
    WidgetTester tester,
  ) async {
    final repository = _RetryRepository();
    final controller = DatasetController(
      repository: repository,
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(
      MaterialApp(home: NotesTableScreen(controller: controller)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('tableErrorCard')), findsOneWidget);
    expect(find.text('Couldn’t load notes'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    // The raw exception never reaches the user.
    expect(find.textContaining('secret raw failure'), findsNothing);

    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('tableErrorCard')), findsNothing);
    expect(find.text('5 Lei'), findsOneWidget);
  });

  testWidgets('first run opens Import, not the load-error card', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(
      repository: _NoArchiveRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(ViewerApp(controller: controller));
    await tester.pumpAndSettle();

    expect(find.text('IMPORT DATA TO GET STARTED'), findsOneWidget);
    expect(find.byKey(const ValueKey('tableErrorCard')), findsNothing);
  });

  testWidgets('a real load failure routes to the table error card', (
    WidgetTester tester,
  ) async {
    final controller = DatasetController(
      repository: _BrokenRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await tester.pumpWidget(ViewerApp(controller: controller));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('tableErrorCard')), findsOneWidget);
    expect(find.text('Couldn’t load notes'), findsOneWidget);
    expect(find.textContaining('archive is corrupt'), findsNothing);
  });

  testWidgets('empty and error states scroll at 320x480 and 200% text', (
    WidgetTester tester,
  ) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = const Size(320, 480);
    addTearDown(tester.view.reset);

    final emptyController = DatasetController(
      repository: _TypeRepository(empty: true),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await emptyController.load();

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(320, 480),
            textScaler: TextScaler.linear(2),
          ),
          child: NotesTableScreen(controller: emptyController),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('This collection is empty'), findsOneWidget);
    expect(find.byKey(const ValueKey('emptyStateImport')), findsOneWidget);
    expect(tester.takeException(), isNull);

    final errorController = DatasetController(
      repository: _BrokenRepository(),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await errorController.load();

    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(320, 480),
            textScaler: TextScaler.linear(2),
          ),
          child: NotesTableScreen(controller: errorController),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('tableErrorCard')), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
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

class _TypeRepository extends ViewerRepository {
  _TypeRepository({this.manyTags = false, this.empty = false});

  final bool manyTags;
  final bool empty;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    final notes = <Map<String, Object?>>[
      {
        'id': 1,
        'collectionId': 1,
        'displayOrder': 1,
        'denomination': '5 Lei',
        'issueDate': '1966',
        'catalogNumber': 'P-88',
        'gradingCompany': 'PMG',
        'grade': '66',
        'serial': '123456',
        'url': '',
        'notes': '',
        'scrapeStatus': 'done',
        'scrapeError': '',
        'tags': manyTags
            ? [
                for (var tag = 1; tag <= 12; tag++) {'name': 'Tag $tag'},
              ]
            : [
                {'name': 'Romania'},
              ],
        'images': [],
        'scrapedData': null,
      },
      {
        'id': 2,
        'collectionId': 1,
        'displayOrder': 2,
        'denomination': 'Empty note',
        'issueDate': '',
        'catalogNumber': '',
        'gradingCompany': '',
        'grade': '',
        'serial': '',
        'url': '',
        'notes': '',
        'scrapeStatus': 'done',
        'scrapeError': '',
        'tags': <Map<String, Object?>>[],
        'images': [],
        'scrapedData': null,
      },
      {
        'id': 3,
        'collectionId': 1,
        'displayOrder': 3,
        'denomination': '10 Lei',
        'issueDate': '1967',
        'catalogNumber': 'P-89',
        'gradingCompany': 'PCGS',
        'grade': '64',
        'serial': '654321',
        'url': '',
        'notes': '',
        'scrapeStatus': 'done',
        'scrapeError': '',
        'tags': <Map<String, Object?>>[],
        'images': [],
        'scrapedData': null,
      },
    ];

    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': empty ? 0 : notes.length,
      'source': 'imported',
      'collections': [
        {
          'id': 1,
          'name': 'Test Collection',
          'noteCount': empty ? 0 : notes.length,
        },
      ],
      'notes': empty ? <Map<String, Object?>>[] : notes,
    });
  }
}

class _PendingRepository extends ViewerRepository {
  final Completer<ViewerDataset> _never = Completer<ViewerDataset>();

  @override
  Future<ViewerDataset> loadDataset() => _never.future;
}

class _NoArchiveRepository extends ViewerRepository {
  @override
  Future<ViewerDataset> loadDataset() {
    throw const NoImportedDatasetException();
  }
}

class _BrokenRepository extends ViewerRepository {
  @override
  Future<ViewerDataset> loadDataset() {
    throw StateError('archive is corrupt');
  }
}

class _RetryRepository extends ViewerRepository {
  var _attempts = 0;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    _attempts++;
    if (_attempts == 1) {
      throw StateError('secret raw failure');
    }
    return _TypeRepository().loadDataset();
  }
}
