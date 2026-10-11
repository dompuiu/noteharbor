class ViewerCollection {
  const ViewerCollection({
    required this.id,
    required this.name,
    required this.noteCount,
  });

  final int id;
  final String name;
  final int noteCount;

  factory ViewerCollection.fromJson(Map<String, dynamic> json) {
    return ViewerCollection(
      id: (json['id'] as num?)?.toInt() ?? 0,
      name: '${json['name'] ?? ''}'.trim(),
      noteCount: (json['noteCount'] as num?)?.toInt() ?? 0,
    );
  }
}
