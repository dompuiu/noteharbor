enum DatasetSource {
  bundled,
  imported,
}

extension DatasetSourceLabel on DatasetSource {
  String get label {
    switch (this) {
      case DatasetSource.bundled:
        return 'Using bundled archive';
      case DatasetSource.imported:
        return 'Using imported archive';
    }
  }
}
