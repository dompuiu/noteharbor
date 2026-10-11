import 'package:flutter/foundation.dart';

import '../models/note_record.dart';
import '../models/viewer_collection.dart';
import '../models/viewer_dataset.dart';
import 'last_collection_store.dart';
import 'viewer_repository.dart';

class DatasetController extends ChangeNotifier {
  DatasetController({ViewerRepository? repository, LastCollectionStore? selectionStore})
      : _repository = repository ?? ViewerRepository(),
        _selectionStore = selectionStore ?? createLastCollectionStore();

  final ViewerRepository _repository;
  final LastCollectionStore _selectionStore;

  ViewerDataset? _dataset;
  Object? _error;
  bool _isLoading = false;
  bool _isMutating = false;
  int? _activeCollectionId;

  /// Selection persistence is best-effort: the platform channel behind the
  /// file store may stall (or be absent in tests), and that must never block
  /// collection loading.
  static const Duration _selectionStoreTimeout = Duration(seconds: 2);

  ViewerDataset? get dataset => _dataset;
  Object? get error => _error;
  bool get isLoading => _isLoading;
  bool get isMutating => _isMutating;
  bool get canManageImportedDatasets => _repository.canManageImportedDatasets;
  int? get activeCollectionId => _activeCollectionId;

  ViewerCollection? get activeCollection {
    final collections = _dataset?.collections;
    if (collections == null || collections.isEmpty) {
      return null;
    }

    final activeId = _activeCollectionId;
    if (activeId == null) {
      return collections.first;
    }

    for (final collection in collections) {
      if (collection.id == activeId) {
        return collection;
      }
    }

    return collections.first;
  }

  List<NoteRecord> get activeCollectionNotes {
    final notes = _dataset?.notes;
    if (notes == null || notes.isEmpty) {
      return const <NoteRecord>[];
    }

    final collection = activeCollection;
    if (collection == null) {
      return notes;
    }

    return notes.where((note) => note.collectionId == collection.id).toList(growable: false);
  }

  Future<void> load() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _dataset = await _repository.loadDataset();
      await _restoreSavedSelection();
    } catch (error) {
      _error = error;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> importArchive(String archivePath) async {
    _isMutating = true;
    _error = null;
    notifyListeners();

    try {
      await _repository.importArchive(archivePath);
      _dataset = await _repository.loadDataset();
      await _restoreSavedSelection();
    } catch (error) {
      _error = error;
      rethrow;
    } finally {
      _isMutating = false;
      notifyListeners();
    }
  }

  Future<void> deleteCollection(int collectionId, {String? collectionName}) async {
    _isMutating = true;
    _error = null;
    notifyListeners();

    try {
      await _repository.deleteCollection(collectionId, collectionName: collectionName);
      _dataset = await _repository.loadDataset();
      await _restoreSavedSelection();
    } catch (error) {
      _error = error;
      rethrow;
    } finally {
      _isMutating = false;
      notifyListeners();
    }
  }

  Future<void> deleteImportedDataset() async {
    _isMutating = true;
    _error = null;
    notifyListeners();

    try {
      await _repository.deleteImportedDataset();
      _dataset = null;
      _activeCollectionId = null;
      await _clearSavedSelection();
    } catch (error) {
      _error = error;
      rethrow;
    } finally {
      _isMutating = false;
      notifyListeners();
    }
  }

  Future<void> selectCollection(int collectionId) async {
    final collections = _dataset?.collections ?? const <ViewerCollection>[];

    ViewerCollection? selected;
    for (final collection in collections) {
      if (collection.id == collectionId) {
        selected = collection;
        break;
      }
    }
    if (selected == null) {
      return;
    }

    if (_activeCollectionId == collectionId) {
      return;
    }

    _activeCollectionId = collectionId;
    notifyListeners();
    await _saveSelection(selected);
  }

  /// Picks the active collection after the dataset (re)loads: the in-memory
  /// selection wins when it still exists, then the persisted ID, then the
  /// persisted name (IDs churn on re-import), then the first collection.
  /// The resolved selection is persisted so restarts restore it.
  Future<void> _restoreSavedSelection() async {
    final collections = _dataset?.collections ?? const <ViewerCollection>[];

    if (collections.isEmpty) {
      _activeCollectionId = null;
      return;
    }

    final activeId = _activeCollectionId;
    if (activeId != null && collections.any((collection) => collection.id == activeId)) {
      await _persistActiveSelection(collections);
      return;
    }

    LastCollectionSelection? saved;
    try {
      saved = await _selectionStore.load().timeout(
        _selectionStoreTimeout,
        onTimeout: () => null,
      );
    } catch (_) {
      saved = null;
    }

    if (saved != null) {
      final savedId = saved.collectionId;
      if (savedId != null && collections.any((collection) => collection.id == savedId)) {
        _activeCollectionId = savedId;
        await _persistActiveSelection(collections);
        return;
      }

      final savedName = saved.collectionName?.trim().toLowerCase();
      if (savedName != null && savedName.isNotEmpty) {
        for (final collection in collections) {
          if (collection.name.trim().toLowerCase() == savedName) {
            _activeCollectionId = collection.id;
            await _persistActiveSelection(collections);
            return;
          }
        }
      }
    }

    _activeCollectionId = collections.first.id;
    await _persistActiveSelection(collections);
  }

  Future<void> _saveSelection(ViewerCollection collection) async {
    try {
      await _selectionStore
          .save(
            LastCollectionSelection(
              collectionId: collection.id,
              collectionName: collection.name,
            ),
          )
          .timeout(_selectionStoreTimeout);
    } catch (_) {
      // Best effort: selection persistence must never break the app.
    }
  }

  Future<void> _clearSavedSelection() async {
    try {
      await _selectionStore.clear().timeout(_selectionStoreTimeout);
    } catch (_) {
      // Best effort.
    }
  }

  Future<void> _persistActiveSelection(List<ViewerCollection> collections) async {
    ViewerCollection? active;
    for (final collection in collections) {
      if (collection.id == _activeCollectionId) {
        active = collection;
        break;
      }
    }
    if (active == null) {
      return;
    }
    await _saveSelection(active);
  }
}
