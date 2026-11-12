import 'dart:io';

import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/import/import_dataset_screen.dart';
import 'package:note_harbor_viewer/models/archive_preview.dart';
import 'package:note_harbor_viewer/models/viewer_collection.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  late Directory tempDir;
  late File archiveFile;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('t18-outcome-');
    archiveFile = File('${tempDir.path}${Platform.pathSeparator}coins.zip');
    await archiveFile.writeAsString('archive bytes');
  });

  tearDown(() async {
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  Future<DatasetController> readyController({
    required List<ViewerCollection> installed,
    List<ViewerCollection> imported = const [],
    Object? failure,
    bool firstRun = false,
  }) async {
    final controller = DatasetController(
      repository: _OutcomeRepository(
        installed: installed,
        imported: imported,
        failure: failure,
        firstRun: firstRun,
      ),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();
    return controller;
  }

  Future<void> pumpImportRoute(
    WidgetTester tester,
    DatasetController controller,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (context) =>
                        ImportDatasetScreen(controller: controller),
                  ),
                ),
                child: const Text('Open imports'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open imports'));
    await tester.pumpAndSettle();
  }

  Future<void> dropArchive(WidgetTester tester) async {
    // Staging copies the dropped file with real disk IO, which only runs under
    // runAsync.
    await tester.runAsync(() async {
      tester.widget<DropTarget>(find.byType(DropTarget)).onDragDone!(
        DropDoneDetails(
          files: [DropItemFile(archiveFile.path)],
          localPosition: Offset.zero,
          globalPosition: Offset.zero,
        ),
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpAndSettle();
  }

  Future<void> confirmImport(WidgetTester tester) async {
    await dropArchive(tester);
    await tester.scrollUntilVisible(find.text('Import archive'), 200);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Import archive'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('importArchiveConfirm')));
    await tester.pumpAndSettle();
  }

  List<String> captureAnnouncements(WidgetTester tester) {
    final announcements = <String>[];
    tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(
      SystemChannels.accessibility,
      (message) async {
        if (message is Map && message['type'] == 'announce') {
          final data = message['data'];
          if (data is Map && data['message'] is String) {
            announcements.add(data['message'] as String);
          }
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger
          .setMockDecodedMessageHandler<Object?>(
              SystemChannels.accessibility, null),
    );
    return announcements;
  }

  String debugLabel(WidgetTester tester) =>
      tester.binding.focusManager.primaryFocus?.debugLabel ?? '';

  testWidgets(
      'a successful import is announced and offers the first imported '
      'collection', (WidgetTester tester) async {
    final controller = await readyController(
      installed: const [ViewerCollection(id: 11, name: 'Alpha', noteCount: 2)],
      imported: const [
        ViewerCollection(id: 2, name: 'Bulgaria', noteCount: 3),
        ViewerCollection(id: 3, name: 'Greece', noteCount: 1),
      ],
    );
    final announcements = captureAnnouncements(tester);

    await pumpImportRoute(tester, controller);
    await confirmImport(tester);

    expect(find.text('Imported coins.zip.'), findsOneWidget);
    expect(find.text('View Bulgaria'), findsOneWidget);
    expect(
      announcements,
      contains('Imported coins.zip. View Bulgaria to browse its notes.'),
    );
    expect(debugLabel(tester), 'importViewCollection');

    await tester.tap(find.text('View Bulgaria'));
    await tester.pumpAndSettle();

    expect(find.byType(ImportDatasetScreen), findsNothing);
    expect(controller.activeCollectionId, 77);
  });

  testWidgets(
      'first-run success announces only the outcome: the table '
      'replaces the screen, so there is no View action', (
    WidgetTester tester,
  ) async {
    final controller = await readyController(
      installed: const [],
      imported: const [
        ViewerCollection(id: 2, name: 'Bulgaria', noteCount: 3),
      ],
      firstRun: true,
    );
    final announcements = captureAnnouncements(tester);

    await tester.pumpWidget(
      MaterialApp(home: ImportDatasetScreen(controller: controller)),
    );
    await tester.pumpAndSettle();
    await confirmImport(tester);

    expect(find.text('Imported coins.zip.'), findsOneWidget);
    expect(find.byKey(const ValueKey('importOutcomeView')), findsNothing);
    expect(announcements, contains('Imported coins.zip.'));
    expect(debugLabel(tester), 'importStatusDismiss');
  });

  testWidgets('an unreadable preview offers no View action', (
    WidgetTester tester,
  ) async {
    final controller = await readyController(
      installed: const [ViewerCollection(id: 11, name: 'Alpha', noteCount: 2)],
      imported: const [],
    );
    final announcements = captureAnnouncements(tester);

    await pumpImportRoute(tester, controller);
    await confirmImport(tester);

    // The archive's collections are unknown, so the banner never claims a
    // collection the archive may not hold.
    expect(find.text('Imported coins.zip.'), findsOneWidget);
    expect(find.byKey(const ValueKey('importOutcomeView')), findsNothing);
    expect(announcements, contains('Imported coins.zip.'));
    expect(debugLabel(tester), 'importStatusDismiss');
  });

  testWidgets(
      'a failure keeps its place and turns a Bad state into a human '
      'sentence with the recovery step', (WidgetTester tester) async {
    final controller = await readyController(
      installed: const [ViewerCollection(id: 11, name: 'Alpha', noteCount: 2)],
      failure: StateError('Archive contains no collections.'),
    );
    final announcements = captureAnnouncements(tester);

    await pumpImportRoute(tester, controller);
    await confirmImport(tester);

    const expected =
        'Could not import the archive: Archive contains no collections. '
        'Choose the archive again and retry, or try a different archive.';
    expect(find.text(expected), findsOneWidget);
    expect(find.textContaining('Bad state:'), findsNothing);
    expect(announcements, contains(expected));
    expect(debugLabel(tester), 'importButton');

    // The failure remains until the import is retried or dismissed.
    await tester.pump(const Duration(seconds: 10));
    expect(find.text(expected), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('importOutcomeDismiss')));
    await tester.pumpAndSettle();
    expect(find.text(expected), findsNothing);
    expect(debugLabel(tester), 'importButton');
  });

  testWidgets('an error survives a collection change in the panel above', (
    WidgetTester tester,
  ) async {
    final controller = await readyController(
      installed: const [
        ViewerCollection(id: 11, name: 'Alpha', noteCount: 2),
        ViewerCollection(id: 22, name: 'Beta', noteCount: 3),
      ],
      failure: StateError('Archive contains no collections.'),
    );

    await pumpImportRoute(tester, controller);
    await confirmImport(tester);
    final banner = find.textContaining('Could not import the archive:');

    await tester.scrollUntilVisible(
      find.byType(DropdownButtonFormField<int>),
      -200,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<int>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Beta (3)').last);
    await tester.pumpAndSettle();

    expect(banner, findsOneWidget);
  });

  testWidgets('a failure drops the Exception prefix too', (
    WidgetTester tester,
  ) async {
    final controller = await readyController(
      installed: const [ViewerCollection(id: 11, name: 'Alpha', noteCount: 2)],
      failure: Exception('The archive is unreadable.'),
    );

    await pumpImportRoute(tester, controller);
    await confirmImport(tester);

    const expected = 'Could not import the archive: The archive is unreadable. '
        'Choose the archive again and retry, or try a different archive.';
    expect(find.text(expected), findsOneWidget);
    expect(find.textContaining('Exception:'), findsNothing);
  });

  testWidgets('a bodiless error falls back to the generic sentence', (
    WidgetTester tester,
  ) async {
    final controller = await readyController(
      installed: const [ViewerCollection(id: 11, name: 'Alpha', noteCount: 2)],
      failure: Exception(),
    );

    await pumpImportRoute(tester, controller);
    await confirmImport(tester);

    const expected =
        'Could not import the archive. Choose the archive again and retry, '
        'or try a different archive.';
    expect(find.text(expected), findsOneWidget);
    expect(find.textContaining('Could not import the archive: Exception'),
        findsNothing);
  });

  testWidgets('a successful import returns a scrolled page to the top', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(500, 560);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final controller = await readyController(
      installed: const [ViewerCollection(id: 11, name: 'Alpha', noteCount: 2)],
      imported: const [
        ViewerCollection(id: 2, name: 'Bulgaria', noteCount: 3),
      ],
    );

    await pumpImportRoute(tester, controller);
    final listView = tester.widget<ListView>(find.byType(ListView));
    await tester.drag(find.byType(ListView), const Offset(0, -240));
    await tester.pumpAndSettle();
    expect(listView.controller!.offset, greaterThan(0));

    await confirmImport(tester);

    expect(listView.controller!.offset, 0);
    expect(find.text('View Bulgaria'), findsOneWidget);
  });
}

class _OutcomeRepository extends ViewerRepository {
  _OutcomeRepository({
    required List<ViewerCollection> installed,
    this.imported = const [],
    this.failure,
    this.firstRun = false,
  }) : _collections = [...installed];

  final List<ViewerCollection> imported;
  final Object? failure;
  final bool firstRun;

  List<ViewerCollection> _collections;
  bool _importedOnce = false;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ArchivePreview?> peekArchive(String archivePath) async {
    return ArchivePreview(
      generatedAt: '2026-03-28T12:00:00Z',
      collections: imported,
    );
  }

  @override
  Future<ViewerDataset> loadDataset() async {
    if (firstRun && !_importedOnce) {
      throw const NoImportedDatasetException();
    }
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 0,
      'source': 'imported',
      'notes': const [],
      'collections': [
        for (final collection in _collections)
          {
            'id': collection.id,
            'name': collection.name,
            'noteCount': collection.noteCount,
          },
      ],
    });
  }

  @override
  Future<void> importArchive(String archivePath) async {
    final failure = this.failure;
    if (failure != null) {
      throw failure;
    }
    // Re-imported collections churn their IDs, like the real store.
    _collections = [
      ..._collections,
      for (final (index, collection) in imported.indexed)
        ViewerCollection(
          id: 77 + index,
          name: collection.name,
          noteCount: collection.noteCount,
        ),
    ];
    _importedOnce = true;
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
