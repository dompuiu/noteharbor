class NoteImage {
  const NoteImage({
    this.assetPath,
    this.filePath,
    required this.type,
    required this.variant,
    this.sourceUrl,
  });

  final String? assetPath;
  final String? filePath;
  final String type;
  final String variant;
  final String? sourceUrl;

  bool get isFront => type == 'front';

  bool get isFull => variant == 'full';

  String get cacheKey => assetPath ?? filePath ?? '$type-$variant';

  String get displayLabel {
    final typeLabel = type.isEmpty ? 'Image' : '${type[0].toUpperCase()}${type.substring(1)}';
    final variantLabel = variant == 'thumbnail' ? 'Thumbnail' : 'Full';
    return '$typeLabel $variantLabel';
  }

  factory NoteImage.fromJson(Map<String, dynamic> json) {
    final assetPath = json['assetPath'] == null ? null : '${json['assetPath']}'.trim();
    final filePath = json['filePath'] == null ? null : '${json['filePath']}'.trim();

    return NoteImage(
      assetPath: assetPath == null || assetPath.isEmpty ? null : assetPath,
      filePath: filePath == null || filePath.isEmpty ? null : filePath,
      type: '${json['type'] ?? ''}',
      variant: '${json['variant'] ?? ''}',
      sourceUrl: json['sourceUrl'] == null ? null : '${json['sourceUrl']}',
    );
  }
}
