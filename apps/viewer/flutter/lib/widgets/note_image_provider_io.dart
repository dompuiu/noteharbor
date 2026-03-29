import 'dart:io';

import 'package:flutter/painting.dart';

import '../models/note_image.dart';

ImageProvider<Object> createNoteImageProvider(NoteImage image) {
  if (image.filePath != null && image.filePath!.trim().isNotEmpty) {
    return FileImage(File(image.filePath!));
  }

  return AssetImage(image.assetPath ?? '');
}
