import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/data/dataset_controller.dart';
import 'package:note_harbor_viewer/data/last_collection_store.dart';
import 'package:note_harbor_viewer/data/viewer_repository.dart';
import 'package:note_harbor_viewer/models/dataset_source.dart';
import 'package:note_harbor_viewer/models/note_record.dart';
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

  test('showAllNotes returns notes from every collection', () async {
    final repository = _FakeRepository(
      [alpha, beta],
      notes: [_note(1, 11), _note(2, 11), _note(3, 22)],
    );
    final controller = DatasetController(
      repository: repository,
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    expect(controller.showingAllNotes, isFalse);
    expect(controller.activeCollectionNotes.map((note) => note.id), [1, 2]);

    await controller.showAllNotes();

    expect(controller.showingAllNotes, isTrue);
    expect(controller.activeCollectionNotes.map((note) => note.id), [1, 2, 3]);
    // The scope does not move the active collection.
    expect(controller.activeCollectionId, 11);
    expect(controller.activeCollection?.id, 11);
  });

  test('selectCollection leaves All notes even when the id does not change', () async {
    final store = _MemoryLastCollectionStore();
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );
    await controller.load();
    await controller.showAllNotes();

    await controller.selectCollection(11);

    expect(controller.showingAllNotes, isFalse);
    expect(controller.activeCollectionId, 11);
    expect(store.saved?.collectionId, 11);
    expect(store.saved?.allCollections, isFalse);
  });

  test('the All notes flag is saved and restored with the collection', () async {
    final store = _MemoryLastCollectionStore();
    final repository = _FakeRepository([alpha, beta]);
    final controller = DatasetController(
      repository: repository,
      selectionStore: store,
    );
    await controller.load();
    await controller.selectCollection(22);
    await controller.showAllNotes();

    expect(store.saved?.collectionId, 22);
    expect(store.saved?.allCollections, isTrue);

    final restored = DatasetController(
      repository: repository,
      selectionStore: store,
    );
    await restored.load();

    expect(restored.showingAllNotes, isTrue);
    expect(restored.activeCollectionId, 22);
  });

  test('a saved file without the All notes flag keeps the collection scope', () async {
    final store = _MemoryLastCollectionStore(
      const LastCollectionSelection(collectionId: 22, collectionName: 'Beta'),
    );
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );

    await controller.load();

    expect(controller.showingAllNotes, isFalse);
    expect(controller.activeCollectionId, 22);
  });

  test('importArchive preserves the All notes scope', () async {
    final repository = _FakeRepository([alpha, beta]);
    final controller = DatasetController(
      repository: repository,
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();
    await controller.showAllNotes();

    await controller.importArchive('archive.nh');

    expect(controller.showingAllNotes, isTrue);
  });

  test('deleteCollection preserves the All notes scope', () async {
    final repository = _FakeRepository([alpha, beta]);
    final controller = DatasetController(
      repository: repository,
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();
    await controller.showAllNotes();

    await controller.deleteCollection(22, collectionName: 'Beta');

    expect(controller.showingAllNotes, isTrue);
    expect(controller.activeCollectionId, 11);
  });

  test('deleteImportedDataset clears the All notes scope', () async {
    final store = _MemoryLastCollectionStore();
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );
    await controller.load();
    await controller.showAllNotes();

    await controller.deleteImportedDataset();

    expect(controller.showingAllNotes, isFalse);
    expect(controller.activeCollectionNotes, isEmpty);
    expect(store.saved, isNull);
  });

  test('showAllNotes does nothing without collections', () async {
    final controller = DatasetController(
      repository: _FakeRepository(const []),
      selectionStore: _MemoryLastCollectionStore(),
    );
    await controller.load();

    await controller.showAllNotes();

    expect(controller.showingAllNotes, isFalse);
  });

  test('deleting the active collection keeps All notes on the first remaining', () async {
    final repository = _FakeRepository([alpha, beta]);
    final store = _MemoryLastCollectionStore();
    final controller = DatasetController(
      repository: repository,
      selectionStore: store,
    );
    await controller.load();
    await controller.showAllNotes();

    await controller.deleteCollection(11, collectionName: 'Alpha');

    expect(controller.showingAllNotes, isTrue);
    expect(controller.activeCollectionId, 22);
    expect(store.saved?.collectionId, 22);
    expect(store.saved?.allCollections, isTrue);
  });

  test('load restores All notes alongside a name-matched collection', () async {
    const renamedBeta = ViewerCollection(id: 202, name: 'Beta', noteCount: 3);
    final store = _MemoryLastCollectionStore(
      const LastCollectionSelection(
        collectionId: 22,
        collectionName: 'Beta',
        allCollections: true,
      ),
    );
    final controller = DatasetController(
      repository: _FakeRepository([alpha, renamedBeta]),
      selectionStore: store,
    );

    await controller.load();

    expect(controller.activeCollectionId, 202);
    expect(controller.showingAllNotes, isTrue);
  });

  test('an unreadable saved state does not drop the in-memory All notes scope', () async {
    final store = _MemoryLastCollectionStore();
    final controller = DatasetController(
      repository: _FakeRepository([alpha, beta]),
      selectionStore: store,
    );
    await controller.load();
    await controller.showAllNotes();
    store.failLoad = true;

    await controller.importArchive('archive.nh');

    expect(controller.showingAllNotes, isTrue);
  });

  group('LastCollectionSelection json', () {
    test('an old file without the flag reads as collection scope', () {
      final selection = LastCollectionSelection.fromJson(const {
        'lastCollectionId': 22,
        'lastCollectionName': 'Beta',
      });

      expect(selection.collectionId, 22);
      expect(selection.collectionName, 'Beta');
      expect(selection.allCollections, isFalse);
    });

    test('a true flag reads as All notes and serializes back', () {
      final selection = LastCollectionSelection.fromJson(const {
        'lastCollectionId': 22,
        'lastCollectionName': 'Beta',
        'allCollections': true,
      });

      expect(selection.allCollections, isTrue);
      expect(selection.toJson()['allCollections'], isTrue);
    });

    test('a non-boolean flag is treated as off', () {
      final selection = LastCollectionSelection.fromJson(const {
        'lastCollectionId': 22,
        'allCollections': 'yes',
      });

      expect(selection.allCollections, isFalse);
    });

    test('All notes alone is not an empty selection', () {
      const selection = LastCollectionSelection(allCollections: true);

      expect(selection.isEmpty, isFalse);
    });
  });
}

NoteRecord _note(int id, int collectionId) {
  return NoteRecord(
    id: id,
    collectionId: collectionId,
    displayOrder: 0,
    denomination: 'Note $id',
    issueDate: '',
    catalogNumber: '',
    gradingCompany: '',
    grade: '',
    watermark: '',
    serial: '',
    url: '',
    notes: '',
    scrapeStatus: '',
    scrapeError: '',
    tags: const [],
    images: const [],
    scrapedData: null,
  );
}

class _MemoryLastCollectionStore implements LastCollectionStore {
  _MemoryLastCollectionStore([this.saved]);

  LastCollectionSelection? saved;
  bool cleared = false;
  bool failLoad = false;

  @override
  Future<LastCollectionSelection?> load() async {
    if (failLoad) {
      throw StateError('selection store unavailable');
    }
    return saved;
  }

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
  _FakeRepository(this.collections, {this.notes = const []});

  List<ViewerCollection> collections;
  final List<NoteRecord> notes;

  @override
  bool get canManageImportedDatasets => true;

  @override
  Future<ViewerDataset> loadDataset() async {
    return ViewerDataset(
      generatedAt: '2026-03-28T12:00:00Z',
      noteCount: notes.length,
      notes: List.of(notes),
      collections: List.of(collections),
      source: DatasetSource.imported,
    );
  }

  @override
  Future<void> importArchive(String archivePath) async {}

  @override
  Future<void> deleteCollection(int collectionId, {String? collectionName}) async {
    collections.removeWhere((collection) => collection.id == collectionId);
  }

  @override
  Future<void> deleteImportedDataset() async {
    collections = [];
  }
}
