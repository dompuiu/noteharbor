import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/models/dataset_source.dart';
import 'package:note_harbor_viewer/models/viewer_collection.dart';
import 'package:note_harbor_viewer/models/viewer_dataset.dart';

void main() {
  const alpha = ViewerCollection(id: 11, name: 'Alpha', noteCount: 2);
  const beta = ViewerCollection(id: 22, name: 'Beta', noteCount: 3);

  test('load with no saved selection activates and persists the first collection', () async {
    final store = _MemoryLastCollectionStore();
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );

    await controller.load();

    expect(controller.activeCollectionId, 11);
    expect(store.saved?.collectionId, 11);
    expect(store.saved?.collectionName, 'Alpha');
  });

  test('load restores the saved collection id', () async {
    final store = _MemoryLastCollectionStore(
      const LastCollectionSelection(collectionId: 22, collectionName: 'Beta'),
    );
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );

    await controller.load();

    expect(controller.activeCollectionId, 22);
  });

  test('load falls back to the saved name when ids churned on re-import', () async {
    // Re-imports delete and re-insert collections, so IDs change.
    const renamedAlpha = ViewerCollection(id: 101, name: 'Alpha', noteCount: 2);
    const renamedBeta = ViewerCollection(id: 202, name: 'Beta', noteCount: 3);
    final store = _MemoryLastCollectionStore(
      const LastCollectionSelection(collectionId: 22, collectionName: 'Beta'),
    );
    final controller = DatasetController(
      repository: _FakeRepository([renamedAlpha, renamedBeta]),
      selectionStore: store,
    );

    await controller.load();

    expect(controller.activeCollectionId, 202);
    // Re-persisted with the fresh ID so the next start hits the fast path.
    expect(store.saved?.collectionId, 202);
  });

  test('load falls back to the first collection when nothing matches', () async {
    final store = _MemoryLastCollectionStore(
      const LastCollectionSelection(collectionId: 999, collectionName: 'Gone'),
    );
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );

    await controller.load();

    expect(controller.activeCollectionId, 11);
  });

  test('selectCollection persists the selection and ignores unknown ids', () async {
    final store = _MemoryLastCollectionStore();
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );
    await controller.load();

    await controller.selectCollection(22);

    expect(controller.activeCollectionId, 22);
    expect(store.saved?.collectionId, 22);
    expect(store.saved?.collectionName, 'Beta');

    await controller.selectCollection(999);
    expect(controller.activeCollectionId, 22);
  });

  test('deleteImportedDataset clears the saved selection', () async {
    final store = _MemoryLastCollectionStore(
      const LastCollectionSelection(collectionId: 22, collectionName: 'Beta'),
    );
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );
    await controller.load();

    await controller.deleteImportedDataset();

    expect(controller.dataset, isNull);
    expect(controller.activeCollectionId, isNull);
    expect(store.saved, isNull);
    expect(store.cleared, isTrue);
  });

  test('deleteCollection re-resolves to a remaining collection', () async {
    final repository = _FakeRepository([alpha, beta]);
    final store = _MemoryLastCollectionStore();
    final controller = DatasetController(
      repository: repository,
      selectionStore: store,
    );
    await controller.load();
    await controller.selectCollection(22);

    await controller.deleteCollection(22, collectionName: 'Beta');

    expect(controller.activeCollectionId, 11);
    expect(store.saved?.collectionId, 11);
  });
}

class _MemoryLastCollectionStore implements LastCollectionStore {
  _MemoryLastCollectionStore([this.saved]);

  LastCollectionSelection? saved;
  bool cleared = false;

  @override
  Future<LastCollectionSelection?> load() async => saved;

  @override
  Future<void> save(LastCollectionSelection selection) async {
    saved = selection;
  }

  @override
  Future<void> clear() async {
    saved = null;
    cleared = true;
  }
}

class _FakeRepository extends ViewerRepository {
  _FakeRepository(this.collections);

  List<ViewerCollection> collections;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset(
      generatedAt: '2026-03-28T12:00:00Z',
      noteCount: 0,
      notes: const [],
      collections: List.of(collections),
      source: DatasetSource.imported,
    );
  }

  @override
  Future<void> deleteCollection(int collectionId, {String? collectionName}) async {
    collections.removeWhere((collection) => collection.id == collectionId);
  }

  @override
  Future<void> deleteImportedDataset() async {
    collections = [];
  }
}
