import 'package:flutter/painting.dart';

import '../models/note_image.dart';

ImageProvider<Object> createNoteImageProvider(NoteImage image) {
  return AssetImage(image.assetPath ?? '');
}
