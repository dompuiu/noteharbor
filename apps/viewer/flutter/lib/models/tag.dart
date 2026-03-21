class Tag {
  const Tag({required this.name, this.id});

  final int? id;
  final String name;

  factory Tag.fromJson(Map<String, dynamic> json) {
    return Tag(
      id: json['id'] is int ? json['id'] as int : int.tryParse('${json['id'] ?? ''}'),
      name: '${json['name'] ?? ''}'.trim(),
    );
  }
}
