import 'package:flutter/foundation.dart';

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

  ViewerDataset? get dataset => _dataset;
  Object? get error => _error;
  bool get isLoading => _isLoading;
  bool get isMutating => _isMutating;
  bool get canManageImportedDatasets => _repository.canManageImportedDatasets;

  Future<void> load() async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _dataset = await _repository.loadDataset();
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
    } catch (error) {
      _error = error;
      rethrow;
    } finally {
      _isMutating = false;
      notifyListeners();
    }
  }
}
