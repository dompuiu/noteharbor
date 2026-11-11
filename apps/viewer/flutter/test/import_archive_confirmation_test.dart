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
    tempDir = await Directory.systemTemp.createTemp('t16-import-');
    archiveFile = File('${tempDir.path}${Platform.pathSeparator}coins.zip');
    await archiveFile.writeAsString('archive bytes');
  });

  tearDown(() async {
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  Future<void> pumpScreen(
    WidgetTester tester,
    _ConfirmationRepository repository,
  ) async {
    final controller = DatasetController(
      repository: repository,
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();
    await tester.pumpWidget(
      MaterialApp(home: ImportDatasetScreen(controller: controller)),
    );
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

  Future<void> openImportDialog(WidgetTester tester) async {
    await dropArchive(tester);
    await tester.scrollUntilVisible(find.text('Import archive'), 200);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Import archive'));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey('importArchiveDialog')),
      findsOneWidget,
    );
  }

  testWidgets('the confirm dialog names the archive and its collections', (
    WidgetTester tester,
  ) async {
    final repository = _ConfirmationRepository(
      installed: const [
        ViewerCollection(id: 11, name: 'Romania', noteCount: 2),
        ViewerCollection(id: 22, name: 'Beta', noteCount: 3),
      ],
      preview: const ArchivePreview(
        generatedAt: '2026-03-28T12:00:00Z',
        collections: [
          ViewerCollection(id: 1, name: 'Romania', noteCount: 5),
          ViewerCollection(id: 2, name: 'Bulgaria', noteCount: 0),
          ViewerCollection(id: 3, name: 'Greece', noteCount: 1),
        ],
      ),
    );
    await pumpScreen(tester, repository);

    await openImportDialog(tester);

    expect(find.text('Import "coins.zip"?'), findsOneWidget);
    // The dialog read the staged archive that the screen selected.
    expect(repository.peekedPaths, hasLength(1));
    expect(
      repository.peekedPaths.single,
      endsWith('${Platform.pathSeparator}archive.zip'),
    );
    expect(find.text('This archive contains 3 collections.'), findsOneWidget);
    // Only Romania is installed; Beta is absent from the archive and is not
    // mentioned as at risk.
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('importArchiveDialog')),
        matching: find.text('Beta'),
      ),
      findsNothing,
    );
    expect(find.text('Replaces'), findsOneWidget);
    expect(find.text('New'), findsNWidgets(2));
    expect(
      find.widgetWithText(FilledButton, 'Import 3 collections'),
      findsOneWidget,
    );
  });

  testWidgets('Cancel closes the dialog without importing', (
    WidgetTester tester,
  ) async {
    final repository = _ConfirmationRepository(
      installed: const [
        ViewerCollection(id: 11, name: 'Romania', noteCount: 2),
      ],
      preview: const ArchivePreview(
        generatedAt: '2026-03-28T12:00:00Z',
        collections: [
          ViewerCollection(id: 1, name: 'Romania', noteCount: 5),
        ],
      ),
    );
    await pumpScreen(tester, repository);
    await openImportDialog(tester);

    await tester.tap(find.byKey(const ValueKey('importArchiveCancel')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('importArchiveDialog')), findsNothing);
    expect(repository.importCount, 0);
    // Still on the import screen, with the archive still selected.
    expect(find.text('IMPORT ARCHIVE'), findsWidgets);
    expect(find.text('coins.zip'), findsOneWidget);
  });

  testWidgets('Escape closes the dialog without importing', (
    WidgetTester tester,
  ) async {
    final repository = _ConfirmationRepository();
    await pumpScreen(tester, repository);
    await openImportDialog(tester);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('importArchiveDialog')), findsNothing);
    expect(repository.importCount, 0);
    expect(find.text('IMPORT ARCHIVE'), findsWidgets);
  });

  testWidgets('confirming imports the selected archive', (
    WidgetTester tester,
  ) async {
    final repository = _ConfirmationRepository();
    await pumpScreen(tester, repository);
    await openImportDialog(tester);

    await tester.tap(find.byKey(const ValueKey('importArchiveConfirm')));
    await tester.pumpAndSettle();

    expect(repository.importCount, 1);
    expect(find.text('Imported coins.zip.'), findsOneWidget);
  });
}

class _ConfirmationRepository extends ViewerRepository {
  _ConfirmationRepository({
    this.installed = const [],
    this.preview,
  });

  final List<ViewerCollection> installed;
  final ArchivePreview? preview;
  final List<String> peekedPaths = [];
  int importCount = 0;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ArchivePreview?> peekArchive(String archivePath) async {
    peekedPaths.add(archivePath);
    return preview;
  }

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 0,
      'source': 'imported',
      'notes': const [],
      'collections': [
        for (final collection in installed)
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
    importCount += 1;
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
