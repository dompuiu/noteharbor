import 'note_image.dart';
import 'tag.dart';

class NoteRecord {
  const NoteRecord({
    required this.id,
    required this.displayOrder,
    required this.denomination,
    required this.issueDate,
    required this.catalogNumber,
    required this.gradingCompany,
    required this.grade,
    required this.watermark,
    required this.serial,
    required this.url,
    required this.notes,
    required this.scrapeStatus,
    required this.scrapeError,
    required this.tags,
    required this.images,
    required this.scrapedData,
  });

  final int id;
  final int displayOrder;
  final String denomination;
  final String issueDate;
  final String catalogNumber;
  final String gradingCompany;
  final String grade;
  final String watermark;
  final String serial;
  final String url;
  final String notes;
  final String scrapeStatus;
  final String scrapeError;
  final List<Tag> tags;
  final List<NoteImage> images;
  final Map<String, dynamic>? scrapedData;

  String get title {
    if (denomination.isNotEmpty && catalogNumber.isNotEmpty) {
      return '$denomination - $catalogNumber';
    }

    return denomination.isNotEmpty ? denomination : 'Untitled note';
  }

  String get tagsLabel => tags.map((tag) => tag.name).where((name) => name.isNotEmpty).join(', ');

  String valueForColumn(String key) {
    switch (key) {
      case 'denomination':
        return denomination;
      case 'issueDate':
        return issueDate;
      case 'catalogNumber':
        return catalogNumber;
      case 'gradingCompany':
        return gradingCompany;
      case 'grade':
        return grade;
      case 'serial':
        return serial;
      case 'tags':
        return tagsLabel;
      case 'displayOrder':
        return '$displayOrder';
      default:
        return '';
    }
  }

  NoteImage? imageFor(String type, String variant) {
    for (final image in images) {
      if (image.type == type && image.variant == variant) {
        return image;
      }
    }

    return null;
  }

  NoteImage? previewFor(String type) {
    return imageFor(type, 'thumbnail') ?? imageFor(type, 'full');
  }

  NoteImage? fullFor(String type) {
    return imageFor(type, 'full') ?? imageFor(type, 'thumbnail');
  }

  factory NoteRecord.fromJson(Map<String, dynamic> json) {
    return NoteRecord(
      id: (json['id'] as num?)?.toInt() ?? 0,
      displayOrder: (json['displayOrder'] as num?)?.toInt() ?? 0,
      denomination: '${json['denomination'] ?? ''}',
      issueDate: '${json['issueDate'] ?? ''}',
      catalogNumber: '${json['catalogNumber'] ?? ''}',
      gradingCompany: '${json['gradingCompany'] ?? ''}',
      grade: '${json['grade'] ?? ''}',
      watermark: '${json['watermark'] ?? ''}',
      serial: '${json['serial'] ?? ''}',
      url: '${json['url'] ?? ''}',
      notes: '${json['notes'] ?? ''}',
      scrapeStatus: '${json['scrapeStatus'] ?? ''}',
      scrapeError: '${json['scrapeError'] ?? ''}',
      tags: (json['tags'] as List<dynamic>? ?? <dynamic>[])
          .whereType<Map<String, dynamic>>()
          .map(Tag.fromJson)
          .toList(growable: false),
      images: (json['images'] as List<dynamic>? ?? <dynamic>[])
          .whereType<Map<String, dynamic>>()
          .map(NoteImage.fromJson)
          .toList(growable: false),
      scrapedData: json['scrapedData'] is Map<String, dynamic>
          ? json['scrapedData'] as Map<String, dynamic>
          : null,
    );
  }
}
