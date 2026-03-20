class NoteImage {
  const NoteImage({
    required this.assetPath,
    required this.type,
    required this.variant,
    this.sourceUrl,
  });

  final String assetPath;
  final String type;
  final String variant;
  final String? sourceUrl;

  bool get isFront => type == 'front';

  bool get isFull => variant == 'full';

  String get displayLabel {
    final typeLabel = type.isEmpty ? 'Image' : '${type[0].toUpperCase()}${type.substring(1)}';
    final variantLabel = variant == 'thumbnail' ? 'Thumbnail' : 'Full';
    return '$typeLabel $variantLabel';
  }

  factory NoteImage.fromJson(Map<String, dynamic> json) {
    return NoteImage(
      assetPath: '${json['assetPath'] ?? ''}',
      type: '${json['type'] ?? ''}',
      variant: '${json['variant'] ?? ''}',
      sourceUrl: json['sourceUrl'] == null ? null : '${json['sourceUrl']}',
    );
  }
}
