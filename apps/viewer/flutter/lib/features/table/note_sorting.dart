import '../../models/note_record.dart';

/// Sorts a copy of [notes] by [column] in [ascending] order.
///
/// The Viewer's sortable columns read as domain values, not as raw strings:
/// denominations compare by amount, catalog numbers by family (natural
/// order), dates chronologically, and grades by number with paper-quality
/// qualifiers as the tiebreaker. Free-text columns keep a case-insensitive
/// string order. Equal keys fall back to the collection's display order so
/// the result is deterministic and never depends on the sort algorithm.
List<NoteRecord> sortNotes(
  Iterable<NoteRecord> notes, {
  required String column,
  required bool ascending,
}) {
  final sorted = List<NoteRecord>.of(notes);
  sorted.sort((left, right) {
    final result = _compareNotes(left, right, column);
    if (result == 0) {
      return left.displayOrder.compareTo(right.displayOrder);
    }
    return ascending ? result : -result;
  });
  return sorted;
}

int _compareNotes(NoteRecord left, NoteRecord right, String column) {
  switch (column) {
    case 'displayOrder':
      return left.displayOrder.compareTo(right.displayOrder);
    case 'denomination':
      return _compareDenominations(left.denomination, right.denomination);
    case 'catalogNumber':
      return _compareCatalogNumbers(left.catalogNumber, right.catalogNumber);
    case 'issueDate':
      return _compareIssueDates(left.issueDate, right.issueDate);
    case 'grade':
      return _compareGrades(left.grade, right.grade);
    default:
      return _compareText(
        left.valueForColumn(column),
        right.valueForColumn(column),
      );
  }
}

int _compareText(String left, String right) {
  final result = left.toLowerCase().compareTo(right.toLowerCase());
  return result != 0 ? result : left.compareTo(right);
}

// ---------------------------------------------------------------------------
// Denomination: the numeric amount, so 5 < 20 < 100 < 1,000. Currency words
// and grouping punctuation do not participate.
// ---------------------------------------------------------------------------

int _compareDenominations(String left, String right) {
  final leftAmount = _denominationAmount(left);
  final rightAmount = _denominationAmount(right);
  if (leftAmount != null && rightAmount != null && leftAmount != rightAmount) {
    return leftAmount.compareTo(rightAmount);
  }
  if (leftAmount != null && rightAmount == null) {
    return -1;
  }
  if (leftAmount == null && rightAmount != null) {
    return 1;
  }
  return _compareText(left, right);
}

int? _denominationAmount(String value) {
  final digits = value.replaceAll(RegExp(r'[^0-9]'), '');
  return digits.isEmpty ? null : int.tryParse(digits);
}

// ---------------------------------------------------------------------------
// Catalog: natural order, so a family's base number comes before its letter
// variants and the next family follows (22 < 22a < 22b < 220). That is the
// same family rule the catalog filter uses: a base number plus at most one
// trailing letter (CONTEXT.md, "Catalog family").
// ---------------------------------------------------------------------------

int _compareCatalogNumbers(String left, String right) {
  final leftLower = left.toLowerCase();
  final rightLower = right.toLowerCase();
  var leftIndex = 0;
  var rightIndex = 0;

  while (leftIndex < leftLower.length && rightIndex < rightLower.length) {
    final leftDigit = _isAsciiDigit(leftLower.codeUnitAt(leftIndex));
    final rightDigit = _isAsciiDigit(rightLower.codeUnitAt(rightIndex));

    if (leftDigit && rightDigit) {
      var leftEnd = leftIndex;
      var rightEnd = rightIndex;
      while (leftEnd < leftLower.length &&
          _isAsciiDigit(leftLower.codeUnitAt(leftEnd))) {
        leftEnd++;
      }
      while (rightEnd < rightLower.length &&
          _isAsciiDigit(rightLower.codeUnitAt(rightEnd))) {
        rightEnd++;
      }

      final leftNumber = _stripLeadingZeros(
        leftLower.substring(leftIndex, leftEnd),
      );
      final rightNumber = _stripLeadingZeros(
        rightLower.substring(rightIndex, rightEnd),
      );
      final lengthResult = leftNumber.length.compareTo(rightNumber.length);
      if (lengthResult != 0) {
        return lengthResult;
      }
      final numberResult = leftNumber.compareTo(rightNumber);
      if (numberResult != 0) {
        return numberResult;
      }

      leftIndex = leftEnd;
      rightIndex = rightEnd;
      continue;
    }

    final leftCodeUnit = leftLower.codeUnitAt(leftIndex);
    final rightCodeUnit = rightLower.codeUnitAt(rightIndex);
    if (leftCodeUnit != rightCodeUnit) {
      return leftCodeUnit.compareTo(rightCodeUnit);
    }
    leftIndex++;
    rightIndex++;
  }

  if (leftIndex < leftLower.length) {
    return 1;
  }
  if (rightIndex < rightLower.length) {
    return -1;
  }
  // Case-insensitive match: keep uppercase variants before lowercase ones so
  // the order stays deterministic.
  return left.compareTo(right);
}

bool _isAsciiDigit(int codeUnit) => codeUnit >= 48 && codeUnit <= 57;

String _stripLeadingZeros(String digits) {
  var start = 0;
  while (start < digits.length - 1 && digits.codeUnitAt(start) == 48) {
    start++;
  }
  return digits.substring(start);
}

// ---------------------------------------------------------------------------
// Issue date: free text. Year-only values and ranges are approximate and sit
// at the start of their year; an ND range sorts with its range's start year,
// after the exact start year and range without the ND marker. Unparseable
// values (including blank) sort after every parsed date, in string order.
// ---------------------------------------------------------------------------

int _compareIssueDates(String left, String right) {
  final leftDate = _parseIssueDate(left);
  final rightDate = _parseIssueDate(right);

  if (leftDate == null && rightDate == null) {
    return _compareText(left, right);
  }
  if (leftDate == null) {
    return 1;
  }
  if (rightDate == null) {
    return -1;
  }

  final yearResult = leftDate.startYear.compareTo(rightDate.startYear);
  if (yearResult != 0) {
    return yearResult;
  }
  final monthResult = leftDate.month.compareTo(rightDate.month);
  if (monthResult != 0) {
    return monthResult;
  }
  final dayResult = leftDate.day.compareTo(rightDate.day);
  if (dayResult != 0) {
    return dayResult;
  }
  final endResult = leftDate.endYear.compareTo(rightDate.endYear);
  if (endResult != 0) {
    return endResult;
  }
  return _compareText(left, right);
}

class _IssueDate {
  const _IssueDate({
    required this.startYear,
    required this.endYear,
    this.month = 0,
    this.day = 0,
  });

  final int startYear;
  final int endYear;
  final int month;
  final int day;
}

final RegExp _monthDayYearPattern = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$');
final RegExp _yearPattern = RegExp(r'^(\d{4})$');
final RegExp _yearRangePattern = RegExp(r'^(\d{4})\s*-\s*(\d{2}|\d{4})$');
final RegExp _noDateRangePattern = RegExp(
  r'^ND\s*\(\s*(\d{4})(?:\s*-\s*(\d{2}|\d{4}))?\s*\)$',
  caseSensitive: false,
);

_IssueDate? _parseIssueDate(String raw) {
  final value = raw.trim();
  if (value.isEmpty) {
    return null;
  }

  final monthDayYear = _monthDayYearPattern.firstMatch(value);
  if (monthDayYear != null) {
    final month = int.parse(monthDayYear.group(1)!);
    final day = int.parse(monthDayYear.group(2)!);
    final year = int.parse(monthDayYear.group(3)!);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    return _IssueDate(startYear: year, endYear: year, month: month, day: day);
  }

  final noDateRange = _noDateRangePattern.firstMatch(value);
  if (noDateRange != null) {
    final startYear = int.parse(noDateRange.group(1)!);
    return _IssueDate(
      startYear: startYear,
      endYear: _rangeEndYear(startYear, noDateRange.group(2)),
    );
  }

  final range = _yearRangePattern.firstMatch(value);
  if (range != null) {
    final startYear = int.parse(range.group(1)!);
    return _IssueDate(
      startYear: startYear,
      endYear: _rangeEndYear(startYear, range.group(2)),
    );
  }

  final year = _yearPattern.firstMatch(value);
  if (year != null) {
    final parsed = int.parse(year.group(1)!);
    return _IssueDate(startYear: parsed, endYear: parsed);
  }

  return null;
}

/// Reads a range's right-hand year. A two-digit year stays in the start
/// year's century unless that would put it before the start (1999-01).
int _rangeEndYear(int startYear, String? rawEnd) {
  if (rawEnd == null) {
    return startYear;
  }
  if (rawEnd.length == 4) {
    return int.parse(rawEnd);
  }

  final end = (startYear ~/ 100) * 100 + int.parse(rawEnd);
  return end < startYear ? end + 100 : end;
}

// ---------------------------------------------------------------------------
// Grade: the numeric grade first, then the paper-quality qualifier. NET is a
// net (problem) grade, so it sorts below an unqualified note; PPQ and EPQ
// variants sort above it. Unknown suffixes tie and fall back to string order.
// ---------------------------------------------------------------------------

int _compareGrades(String left, String right) {
  final leftNumber = _gradeNumber(left);
  final rightNumber = _gradeNumber(right);

  if (leftNumber != null && rightNumber != null && leftNumber != rightNumber) {
    return leftNumber.compareTo(rightNumber);
  }
  if (leftNumber != null && rightNumber == null) {
    return -1;
  }
  if (leftNumber == null && rightNumber != null) {
    return 1;
  }

  if (leftNumber != null && rightNumber != null) {
    final qualifierResult = _gradeQualifierRank(left)
        .compareTo(_gradeQualifierRank(right));
    if (qualifierResult != 0) {
      return qualifierResult;
    }
  }

  return _compareText(left, right);
}

int? _gradeNumber(String value) {
  final match = RegExp(r'\d+').firstMatch(value);
  return match == null ? null : int.tryParse(match.group(0)!);
}

int _gradeQualifierRank(String value) {
  final upper = value.toUpperCase();
  if (upper.contains('EPQ')) {
    return 3;
  }
  if (upper.contains('PPQ')) {
    return 2;
  }
  if (upper.contains('NET')) {
    return 0;
  }
  return 1;
}
