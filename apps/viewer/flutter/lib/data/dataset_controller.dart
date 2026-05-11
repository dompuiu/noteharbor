import 'package:flutter/foundation.dart';

import '../models/note_record.dart';
import '../models/viewer_collection.dart';
import '../models/viewer_dataset.dart';
import 'viewer_repository.dart';

class DatasetController extends ChangeNotifier {
  DatasetController({ViewerRepository? repository})
      : _repository = repository ?? ViewerRepository();

  final ViewerRepository _repository;

  ViewerDataset? _dataset;
  Object? _error;
  bool _isLoading = false;
  bool _isMutating = false;
  int? _activeCollectionId;

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
      _syncActiveCollectionId();
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
      _syncActiveCollectionId();
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
      _dataset = await _repository.loadDataset();
      _syncActiveCollectionId();
    } catch (error) {
      _error = error;
      rethrow;
    } finally {
      _isMutating = false;
      notifyListeners();
    }
  }

  void selectCollection(int collectionId) {
    final collections = _dataset?.collections ?? const <ViewerCollection>[];

    if (!collections.any((collection) => collection.id == collectionId)) {
      return;
    }

    if (_activeCollectionId == collectionId) {
      return;
    }

    _activeCollectionId = collectionId;
    notifyListeners();
  }

  void _syncActiveCollectionId() {
    final collections = _dataset?.collections ?? const <ViewerCollection>[];

    if (collections.isEmpty) {
      _activeCollectionId = null;
      return;
    }

    final activeId = _activeCollectionId;
    if (activeId != null && collections.any((collection) => collection.id == activeId)) {
      return;
    }

    for (final collection in collections) {
      if (collection.isDefault) {
        _activeCollectionId = collection.id;
        return;
      }
    }

    for (final collection in collections) {
      if (collection.name.trim().toLowerCase() == 'default') {
        _activeCollectionId = collection.id;
        return;
      }
    }

    _activeCollectionId = collections.first.id;
  }
}
