import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;

import '../models/viewer_dataset.dart';

class ViewerRepository {
  const ViewerRepository();

  Future<ViewerDataset> loadDataset() async {
    final rawJson = await rootBundle.loadString('assets/data/notes.json');
    final decoded = jsonDecode(rawJson) as Map<String, dynamic>;
    return ViewerDataset.fromJson(decoded);
  }
}
