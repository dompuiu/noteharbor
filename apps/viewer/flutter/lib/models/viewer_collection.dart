class ViewerCollection {
  const ViewerCollection({
    required this.id,
    required this.name,
    required this.noteCount,
    required this.isDefault,
  });

  final int id;
  final String name;
  final int noteCount;
  final bool isDefault;

  factory ViewerCollection.fromJson(Map<String, dynamic> json) {
    return ViewerCollection(
      id: (json['id'] as num?)?.toInt() ?? 0,
      name: '${json['name'] ?? ''}'.trim(),
      noteCount: (json['noteCount'] as num?)?.toInt() ?? 0,
      isDefault: json['isDefault'] == true || json['is_default'] == 1,
    );
  }
}
