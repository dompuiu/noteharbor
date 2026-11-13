import 'package:flutter/foundation.dart';

import '../models/archive_preview.dart';
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
  Object? _loadError;
  bool _isLoading = false;
  bool _isMutating = false;
  int? _activeCollectionId;
  bool _showingAllNotes = false;

  /// Selection persistence is best-effort: the platform channel behind the
  /// file store may stall (or be absent in tests), and that must never block
  /// collection loading.
  static const Duration _selectionStoreTimeout = Duration(seconds: 2);

  ViewerDataset? get dataset => _dataset;
  Object? get error => _error;

  /// The last dataset load failure. Mutation failures stay on [error] so a
  /// failed import does not replace the Import screen with the table's error
  /// card; only a real load failure should do that.
  Object? get loadError => _loadError;
  bool get isLoading => _isLoading;
  bool get isMutating => _isMutating;
  bool get canManageImportedDatasets => _repository.canManageImportedDatasets;
  int? get activeCollectionId => _activeCollectionId;

  /// Whether the table shows every note in the dataset instead of only the
  /// active collection's notes.
  bool get showingAllNotes => _showingAllNotes;

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

    if (_showingAllNotes) {
      return List<NoteRecord>.unmodifiable(notes);
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
    _loadError = null;
    notifyListeners();

    try {
      _dataset = await _repository.loadDataset();
      await _restoreSavedSelection();
    } catch (error) {
      _error = error;
      _loadError = error;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  /// The installed archive's folder, for the desktop's Show in folder action.
  Future<String?> importedArchiveDirectory() {
    return _repository.importedArchiveDirectory();
  }

  /// Reads what [archivePath] holds without installing it, for the import
  /// confirmation's collection list. A failed read is reported by the dialog,
  /// not here, so it must not touch the controller's error state.
  Future<ArchivePreview?> peekArchive(String archivePath) {
    return _repository.peekArchive(archivePath);
  }

  Future<void> importArchive(String archivePath) async {
    _isMutating = true;
    _error = null;
    _loadError = null;
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
    _loadError = null;
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
    _loadError = null;
    notifyListeners();

    try {
      await _repository.deleteImportedDataset();
      _dataset = null;
      _activeCollectionId = null;
      _showingAllNotes = false;
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
    if (!collections.any((collection) => collection.id == collectionId)) {
      return;
    }

    if (_activeCollectionId == collectionId && !_showingAllNotes) {
      return;
    }

    _showingAllNotes = false;
    _activeCollectionId = collectionId;
    notifyListeners();
    await _persistActiveSelection();
  }

  /// Switches the table to every note in the dataset. The active collection
  /// stays selected, so leaving All notes returns to it.
  Future<void> showAllNotes() async {
    if (_showingAllNotes || activeCollection == null) {
      return;
    }

    _showingAllNotes = true;
    notifyListeners();
    await _persistActiveSelection();
  }

  /// Picks the active collection after the dataset (re)loads, then re-applies
  /// the persisted All notes flag. The failed-read fallback keeps the
  /// in-memory scope, so an import or delete cannot drop it just because
  /// selection persistence is best-effort.
  Future<void> _restoreSavedSelection() async {
    final collections = _dataset?.collections ?? const <ViewerCollection>[];

    if (collections.isEmpty) {
      _activeCollectionId = null;
      _showingAllNotes = false;
      return;
    }

    final saved = await _loadSavedSelection();
    _activeCollectionId = _resolveActiveCollectionId(collections, saved);
    _showingAllNotes = saved?.allCollections ?? _showingAllNotes;
    await _persistActiveSelection();
  }

  /// The in-memory selection wins when it still exists, then the persisted
  /// ID, then the persisted name (IDs churn on re-import), then the first
  /// collection.
  int _resolveActiveCollectionId(
    List<ViewerCollection> collections,
    LastCollectionSelection? saved,
  ) {
    final activeId = _activeCollectionId;
    if (activeId != null && collections.any((collection) => collection.id == activeId)) {
      return activeId;
    }

    final savedId = saved?.collectionId;
    if (savedId != null && collections.any((collection) => collection.id == savedId)) {
      return savedId;
    }

    final savedName = saved?.collectionName?.trim().toLowerCase();
    if (savedName != null && savedName.isNotEmpty) {
      for (final collection in collections) {
        if (collection.name.trim().toLowerCase() == savedName) {
          return collection.id;
        }
      }
    }

    return collections.first.id;
  }

  Future<LastCollectionSelection?> _loadSavedSelection() async {
    try {
      return await _selectionStore.load().timeout(
        _selectionStoreTimeout,
        onTimeout: () => null,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _saveSelection(ViewerCollection collection) async {
    try {
      await _selectionStore
          .save(
            LastCollectionSelection(
              collectionId: collection.id,
              collectionName: collection.name,
              allCollections: _showingAllNotes,
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

  Future<void> _persistActiveSelection() async {
    final active = activeCollection;
    if (active == null) {
      return;
    }
    await _saveSelection(active);
  }
}
