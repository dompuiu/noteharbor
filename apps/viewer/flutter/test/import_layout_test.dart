import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/native_dataset_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/features/import/import_dataset_screen.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  Future<DatasetController> loadedController({
    String? directory,
    List<Map<String, Object?>> collections = const [
      {'id': 1, 'name': 'Alpha', 'noteCount': 2},
    ],
  }) async {
    final controller = DatasetController(
      repository: _LayoutRepository(
        directory: directory,
        collections: collections,
      ),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();
    return controller;
  }

  Future<void> pumpImportScreen(
    WidgetTester tester,
    DatasetController controller, {
    TargetPlatform platform = TargetPlatform.windows,
    Future<bool> Function(String path)? revealFolder,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(platform: platform),
        home: ImportDatasetScreen(
          controller: controller,
          revealFolder: revealFolder ?? (_) async => true,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('the page keeps a readable measure on a wide desktop', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await pumpImportScreen(tester, await loadedController());

    final listView = tester.widget<ListView>(find.byType(ListView));
    final padding = listView.padding! as EdgeInsets;
    expect(padding.left, 280);
    expect(padding.right, 280);
  });

  testWidgets('a narrow window still fills the page', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(500, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await pumpImportScreen(tester, await loadedController());

    final listView = tester.widget<ListView>(find.byType(ListView));
    final padding = listView.padding! as EdgeInsets;
    expect(padding.left, 20);
    expect(padding.right, 20);
  });

  testWidgets('a window just past the measure keeps the page inset', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(740, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await pumpImportScreen(tester, await loadedController());

    final listView = tester.widget<ListView>(find.byType(ListView));
    final padding = listView.padding! as EdgeInsets;
    expect(padding.left, 20);
    expect(padding.right, 20);
  });

  testWidgets('Show in folder reveals the imported archive directory', (
    WidgetTester tester,
  ) async {
    final opened = <String>[];
    final controller = await loadedController(
      directory: r'C:\NoteHarbor\imported_dataset',
    );

    await pumpImportScreen(
      tester,
      controller,
      revealFolder: (path) async {
        opened.add(path);
        return true;
      },
    );

    expect(find.text('Show in folder'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('showArchiveInFolder')));
    await tester.pumpAndSettle();

    expect(opened, [r'C:\NoteHarbor\imported_dataset']);
    expect(find.text('Could not open the archive folder.'), findsNothing);
  });

  testWidgets('a refused launch reports in the status banner', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    final controller = await loadedController(
      directory: r'C:\NoteHarbor\imported_dataset',
    );

    await pumpImportScreen(
      tester,
      controller,
      revealFolder: (_) async => false,
    );

    await tester.tap(find.byKey(const ValueKey('showArchiveInFolder')));
    await tester.pumpAndSettle();

    expect(find.text('Could not open the archive folder.'), findsOneWidget);
  });

  testWidgets('a desktop archive without collections still offers the action', (
    WidgetTester tester,
  ) async {
    final opened = <String>[];
    final controller = await loadedController(
      directory: '/noteharbor/imported_dataset',
      collections: const [],
    );

    await pumpImportScreen(
      tester,
      controller,
      revealFolder: (path) async {
        opened.add(path);
        return true;
      },
    );

    expect(find.text('ARCHIVE ON THIS DEVICE'), findsNothing);
    expect(find.text('Show in folder'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('showArchiveInFolder')));
    await tester.pumpAndSettle();

    expect(opened, ['/noteharbor/imported_dataset']);
  });

  testWidgets('phones have no Show in folder action', (
    WidgetTester tester,
  ) async {
    await pumpImportScreen(
      tester,
      await loadedController(directory: '/noteharbor/imported_dataset'),
      platform: TargetPlatform.iOS,
    );

    expect(find.byKey(const ValueKey('showArchiveInFolder')), findsNothing);
  });

  test('the repository maps the installed archive to its root path', () async {
    final repository = ViewerRepository(nativeDatasetStore: const _FakeStore());

    expect(
      await repository.importedArchiveDirectory(),
      r'C:\NoteHarbor\imported_dataset',
    );
  });

  test(
    'the repository exposes no folder when it cannot manage archives',
    () async {
      final repository = ViewerRepository(
        nativeDatasetStore: const _UnsupportedStore(),
      );

      expect(await repository.importedArchiveDirectory(), isNull);
    },
  );
}

class _LayoutRepository extends ViewerRepository {
  _LayoutRepository({this.directory, required this.collections});

  final String? directory;
  final List<Map<String, Object?>> collections;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<String?> importedArchiveDirectory() async => directory;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset.fromJson({
      'generatedAt': '2026-03-28T12:00:00Z',
      'noteCount': 2,
      'source': 'imported',
      'notes': const [],
      'collections': List.of(collections),
    });
  }
}

class _FakeStore extends NativeDatasetStore {
  const _FakeStore();

  @override
  bool get isSupported => true;

  @override
  Future<ImportedDatasetLocation?> getImportedDatasetLocation() async {
    return const ImportedDatasetLocation(
      rootPath: r'C:\NoteHarbor\imported_dataset',
      databasePath: r'C:\NoteHarbor\imported_dataset\banknotes.db',
      imagesDirectoryPath: r'C:\NoteHarbor\imported_dataset\images',
    );
  }
}

class _UnsupportedStore extends NativeDatasetStore {
  const _UnsupportedStore();

  @override
  bool get isSupported => false;
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
