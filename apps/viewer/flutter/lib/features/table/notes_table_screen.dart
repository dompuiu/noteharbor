import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import '../../app/viewer_palette.dart';
import '../../data/dataset_controller.dart';
import '../../models/note_image.dart';
import '../../models/note_record.dart';
import '../../models/tag.dart';
import '../../models/viewer_collection.dart';
import '../../widgets/mouse_drag_scroll_behavior.dart';
import '../../widgets/note_image_provider.dart';
import '../import/import_dataset_screen.dart';
import '../slideshow/note_slideshow_screen.dart';
import 'note_sorting.dart';

/// Minimum column widths for the nine-column grid. On a window wider than the
/// grid needs, [_calculateColumnWidths] spreads the spare width across the
/// scrolling columns so the row content always reaches the card's right edge.
const double _kOrderColumnWidth = 56;
const double _kFrontColumnWidth = 88;
const double _kDenominationColumnWidth = 190;
const double _kDateColumnWidth = 120;
const double _kCatalogColumnWidth = 130;
const double _kCompanyColumnWidth = 120;
const double _kGradeColumnWidth = 110;
const double _kSerialColumnWidth = 140;
const double _kDefaultTagsColumnWidth = 160;

/// Tags may grow into spare width, but only this far: a long tag run keeps a
/// readable column and the rest of the spare width goes to the text columns.
const double _kMaxTagsColumnWidth = 320;

/// The scrolling columns' minimum widths, without Tags.
const double _kTextColumnsMinWidth =
    _kDenominationColumnWidth +
    _kDateColumnWidth +
    _kCatalogColumnWidth +
    _kCompanyColumnWidth +
    _kGradeColumnWidth +
    _kSerialColumnWidth;

/// How spare width is shared once Tags has reached its cap. The weights keep
/// the identifier columns roomier than the short Date and Grade columns.
const Map<String, double> _kColumnFlexWeights = {
  'denomination': 1.3,
  'issueDate': 0.8,
  'catalogNumber': 1.0,
  'gradingCompany': 0.8,
  'grade': 0.7,
  'serial': 1.1,
};
const double _kTableHorizontalPadding = 14;
const double _kTableHeaderHeight = 40;

/// The identity columns (ID and Front) that stay put while the rest pan.
const double _kPinnedColumnsWidth = _kOrderColumnWidth + _kFrontColumnWidth;

/// The pinned pane owns the table's left padding so the first scrolling column
/// starts flush against it.
const double _kPinnedPaneWidth =
    _kPinnedColumnsWidth + _kTableHorizontalPadding;
const double _kTableFooterHeight = 34;
const Color _kTableSurface = ViewerPalette.surface;
const Color _kTableBorder = ViewerPalette.border;
const Color _kTableCardBorder = ViewerPalette.border;
const Color _kTableHeaderBg = ViewerPalette.tableHeaderBackground;
const Color _kTableHeaderDivider = ViewerPalette.border;
const Color _kTableDivider = ViewerPalette.borderSoft;
const Color _kTableText = ViewerPalette.text;
const Color _kTableSortableHeaderText = ViewerPalette.accentStrong;
const Color _kTagChipBg = ViewerPalette.tagBackground;
const Color _kTagChipBorder = ViewerPalette.tagBorder;
const Color _kTagChipText = ViewerPalette.tagText;
const double _kFilterBarHeight = 40;
const double _kFilterBarMaxWidth = 560;
const double _kHeaderControlHeight = 40;
const double _kTagChipHorizontalPadding = 10;
const double _kTagChipHorizontalGap = 6;
const EdgeInsets _kTagChipPadding = EdgeInsets.symmetric(
  horizontal: _kTagChipHorizontalPadding,
  vertical: 4,
);

/// Width of every tag chip's tap and focus target, and the height of a grid
/// chip's. The visible pill stays at its compact height inside that area; card
/// footers shorten the height to [_kCardTagChipMinHeight].
const double _kTagChipMinTargetSize = 44;

/// Card footers trade part of the chip's vertical target for density: the
/// full-width footer can hold several runs, and a 44 pt target per run made
/// those runs look like separate blocks. 32 pt still clears the 24 pt minimum
/// for a dense metadata action, and the grid keeps the full 44 pt target.
const double _kCardTagChipMinHeight = 32;

/// The gap between chip runs in the card footer. Small on purpose: the run
/// already carries the chip's vertical target padding.
const double _kCardTagRunSpacing = 4;

/// Horizontal room the Tags cell needs beyond the measured chips: the cell's
/// own 12px gutters on both sides plus breathing room at the column edge.
const double _kTagsColumnSafetyPadding = 48;
const double _kTableRowHeight = 56;
const double _kTableRowSeparatorHeight = 1;
const double _kTableThumbnailWidth = 40;
const double _kTableThumbnailHeight = 24;
const Color _kTableThumbnailPlaceholderBg = ViewerPalette.surfaceContainer;
const Color _kTableThumbnailPlaceholderBorder = ViewerPalette.border;
const Color _kTableThumbnailPlaceholderIcon = ViewerPalette.textMuted;
const double _kCardRadius = ViewerPalette.radiusXl;
const Color _kZebraTint = ViewerPalette.rowZebra;

/// How far one Left/Right arrow press pans the table's hidden columns.
const double _kColumnScrollStep = 200;

/// The table card paints one vertical scrollbar around its whole body, so the
/// lists inside it must not add the Material desktop scrollbar of their own;
/// otherwise the pinned pane's copy shows up at the seam between the panes.
/// The card layout's list is covered too: it sits in the same card and carries
/// the same explicit scrollbar.
class _NoInnerScrollbarBehavior extends MaterialScrollBehavior {
  const _NoInnerScrollbarBehavior();

  @override
  Widget buildScrollbar(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) {
    return child;
  }
}

/// Below this available width the nine-column grid is replaced by a vertical
/// note-card list. The grid needs ~1,200 px to show every column, so a window
/// between this breakpoint and that width still pans; the card layout takes
/// over only where the grid starts cutting columns mid-value.
const double _kCardLayoutBreakpoint = 700;

/// Share of a card-width header the note counter may occupy. The rest goes to
/// the title and import action, so the counter shrinks before the row wraps.
const double _kCompactStatShare = 0.5;

/// Approximate card pitch, used only when a keyboard jump targets a card the
/// lazy list has not built yet. The exact card is aligned once it exists.
const double _kCardEstimatedExtent = 128;

/// The card's mounted image plate. Compact cards keep the note large enough to
/// recognise without crowding the text column on a 320 px phone.
const double _kCardImageWidth = 120;
const double _kCardImageHeight = 72;
const double _kCardCompactImageWidth = 88;
const double _kCardCompactImageHeight = 52;
const double _kCardCompactBreakpoint = 340;

/// The card list sits on the same quiet grey step as the table header, so the
/// white cards read as mounted plates rather than as one more white band.
const Color _kCardTray = ViewerPalette.surfaceMist;

const TextStyle _kCardLabelTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.textMuted,
  fontSize: 9.5,
  fontWeight: FontWeight.w800,
  letterSpacing: 0.9,
  height: 1,
);

const TextStyle _kCardMetaTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.textMuted,
  fontSize: 12,
  fontWeight: FontWeight.w500,
  height: 1.3,
);

/// Sortable columns in visual order, shared by the grid header chain, the
/// card sort menu, and the explicit Tab order.
const List<({String value, String label})> _kSortableColumns = [
  (value: 'displayOrder', label: '#'),
  (value: 'denomination', label: 'Denomination'),
  (value: 'issueDate', label: 'Date'),
  (value: 'catalogNumber', label: 'Catalog #'),
  (value: 'gradingCompany', label: 'Company'),
  (value: 'grade', label: 'Grade'),
  (value: 'serial', label: 'Serial'),
  (value: 'tags', label: 'Tags'),
];

/// Sortable column headers in visual order. `Front` has no sort button and is
/// skipped by the explicit Tab order: filter -> headers -> rows.
final List<String> _kSortableHeaderKeys = [
  for (final column in _kSortableColumns) column.value,
];

/// Human-readable column names for the table footer's sort summary.
const Map<String, String> _kColumnLabels = {
  'displayOrder': 'ID',
  'denomination': 'Denomination',
  'issueDate': 'Date',
  'catalogNumber': 'Catalog',
  'gradingCompany': 'Company',
  'grade': 'Grade',
  'serial': 'Serial',
  'tags': 'Tags',
};

/// Filter scopes for the unified filter bar. The select holds the field and
/// the text input holds the value, so `Catalog + "17"` replaces the removed
/// `cat: 17` inline syntax.
const String _kAllFieldsScope = 'all';
const String _kDefaultFilterScope = 'catalogNumber';

const List<({String value, String label, String hint})> _kFilterScopes = [
  (value: 'all', label: 'All fields', hint: 'Filter…'),
  (value: 'catalogNumber', label: 'Catalog', hint: 'Filter catalog…'),
  (value: 'denomination', label: 'Denomination', hint: 'Filter denomination…'),
  (value: 'issueDate', label: 'Date', hint: 'Filter date…'),
  (value: 'gradingCompany', label: 'Company', hint: 'Filter company…'),
  (value: 'grade', label: 'Grade', hint: 'Filter grade…'),
  (value: 'serial', label: 'Serial', hint: 'Filter serial…'),
  (value: 'tags', label: 'Tags', hint: 'Filter tags…'),
];

/// The cursor shown while the columns are being panned. The Windows embedder
/// has no open/closed-hand cursor: `grab`/`grabbing` are absent from its cursor
/// map and silently fall back to the plain arrow, so Windows gets the pointing
/// hand instead. Everywhere else keeps the canonical closed hand.
MouseCursor get _draggingCursor =>
    defaultTargetPlatform == TargetPlatform.windows
    ? SystemMouseCursors.click
    : SystemMouseCursors.grabbing;

const TextStyle _kTagChipTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTagChipText,
  fontSize: 12,
  fontWeight: FontWeight.w600,
  height: 1,
);

/// DESIGN's Data role: table cell values at 13.5px, tabular so numbers and
/// serials never jitter.
const TextStyle _kDataCellTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTableText,
  fontSize: 13.5,
  fontWeight: FontWeight.w400,
  fontFeatures: [FontFeature.tabularFigures()],
);

/// DESIGN's Code role: serials sit one step under Data, in Body, with the
/// code role's open tracking.
const TextStyle _kCodeTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.textMuted,
  fontSize: 13,
  fontWeight: FontWeight.w500,
  letterSpacing: 0.045,
  height: 1.3,
  fontFeatures: [FontFeature.tabularFigures()],
);

/// The ID column is tertiary metadata: Body Faint, never full ink.
const TextStyle _kIdCellTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.textFaint,
  fontSize: 13.5,
  fontWeight: FontWeight.w400,
  fontFeatures: [FontFeature.tabularFigures()],
);

/// Empty values share one muted dash, so absence reads the same in every cell.
/// The role matches the ID column's tertiary ink.
const TextStyle _kDashTextStyle = _kIdCellTextStyle;

const Text _kDashText = Text('-', style: _kDashTextStyle);

/// Titles and detail lines shared by the empty, loading, and error states.
const TextStyle _kStateTitleTextStyle = TextStyle(
  fontFamily: 'Inter',
  fontWeight: FontWeight.w700,
  fontSize: 15,
  color: ViewerPalette.text,
);

const TextStyle _kStateDetailTextStyle = TextStyle(
  fontFamily: 'Inter',
  fontSize: 13,
  color: ViewerPalette.textMuted,
);

/// The unified filter bar's text: the hint and the typed query share the scope
/// label's 13px voice so the whole bar sits on one line.
const TextStyle _kFilterInputTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.text,
  fontSize: 13,
);

const TextStyle _kFilterHintTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.textMuted,
  fontSize: 13,
);

const TextStyle _kCollectionTitleTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTableText,
  fontWeight: FontWeight.w800,
  fontSize: 20,
  letterSpacing: -0.3,
  height: 1.1,
);

const TextStyle _kHeaderLabelTextStyle = TextStyle(
  fontFamily: 'Inter',
  fontWeight: FontWeight.w700,
  fontSize: 11,
  letterSpacing: 0.9,
  height: 1,
);

// ---------------------------------------------------------------------------
// Scoped search matching (scope comes from the filter-bar select, the value
// from the text input; `field: value` inline syntax was removed)
// ---------------------------------------------------------------------------

class _FilterToken {
  const _FilterToken({required this.negated, required this.value});

  final bool negated;
  final String value;
}

List<String> _splitSearchTerms(String rawValue) {
  return RegExp(r'\d(?:[\d,. ]*\d)?|[^\s]+')
      .allMatches(rawValue.trim().toLowerCase())
      .map((match) => match.group(0) ?? '')
      .where((value) => value.isNotEmpty)
      .toList(growable: false);
}

String? _normalizedDenominationAmount(String value) {
  if (!RegExp(r'\d').hasMatch(value)) {
    return null;
  }

  final normalized = value.replaceAll(RegExp(r'[^\d]'), '');
  return normalized.isEmpty ? null : normalized;
}

Iterable<String> _denominationAmounts(String value) sync* {
  final matches = RegExp(r'\d(?:[\d,. ]*\d)?').allMatches(value);
  for (final match in matches) {
    final amount = _normalizedDenominationAmount(match.group(0) ?? '');
    if (amount != null) {
      yield amount;
    }
  }
}

bool _matchesDenominationTerm(String noteValue, String term) {
  if (noteValue.contains(term)) {
    return true;
  }

  final normalizedAmount = _normalizedDenominationAmount(term);
  if (normalizedAmount == null) {
    return false;
  }

  return _denominationAmounts(noteValue).contains(normalizedAmount);
}

bool _matchesDenominationFilterValue(String noteValue, String filterValue) {
  final normalizedAmount = _normalizedDenominationAmount(filterValue);
  if (normalizedAmount != null &&
      !_denominationAmounts(noteValue).contains(normalizedAmount)) {
    return false;
  }

  final textOnlyFilter = filterValue.replaceAll(
    RegExp(r'\d(?:[\d,. ]*\d)?'),
    ' ',
  );
  final textTerms = _splitSearchTerms(textOnlyFilter);
  return textTerms.every((term) => noteValue.contains(term));
}

bool _matchesAllFieldsSearch(NoteRecord note, String allFields) {
  final searchTerms = _splitSearchTerms(allFields);
  if (searchTerms.isEmpty) {
    return true;
  }

  final haystack = [
    note.displayOrder.toString(),
    note.denomination,
    note.issueDate,
    note.catalogNumber,
    note.gradingCompany,
    note.grade,
    note.serial,
    note.tagsLabel,
    note.notes,
  ].join(' ').toLowerCase();
  final denomination = note.denomination.toLowerCase();

  return searchTerms.every(
    (term) =>
        haystack.contains(term) || _matchesDenominationTerm(denomination, term),
  );
}

_FilterToken? _parseFilterToken(
  String rawValue, {
  String Function(String value)? normalizeValue,
}) {
  final normalized = rawValue.trim().toLowerCase();
  if (normalized.isEmpty) {
    return null;
  }

  final negated = normalized.startsWith('!');
  final parsedValue = negated ? normalized.substring(1).trim() : normalized;
  final value = normalizeValue != null
      ? normalizeValue(parsedValue)
      : parsedValue;
  if (value.isEmpty) {
    return null;
  }

  return _FilterToken(negated: negated, value: value);
}

List<_FilterToken> _parseMultiValueFilter(
  String rawValue, {
  String Function(String value)? normalizeValue,
}) {
  return _splitFilterValues(rawValue)
      .map((value) => _parseFilterToken(value, normalizeValue: normalizeValue))
      .whereType<_FilterToken>()
      .toList(growable: false);
}

List<String> _splitFilterValues(String rawValue) {
  final values = <String>[];
  final buffer = StringBuffer();

  for (var index = 0; index < rawValue.length; index++) {
    final character = rawValue[index];
    if (character == ',' && _isMultiValueSeparator(rawValue, index)) {
      values.add(buffer.toString());
      buffer.clear();
      continue;
    }

    buffer.write(character);
  }

  values.add(buffer.toString());
  return values;
}

bool _isMultiValueSeparator(String rawValue, int commaIndex) {
  return !_isThousandsSeparator(rawValue, commaIndex) &&
      !_isMonthDayYearDateComma(rawValue, commaIndex);
}

bool _isThousandsSeparator(String rawValue, int commaIndex) {
  if (commaIndex <= 0 || commaIndex + 1 >= rawValue.length) {
    return false;
  }

  if (!_isAsciiDigit(rawValue[commaIndex - 1])) {
    return false;
  }

  if (_isWhitespace(rawValue[commaIndex + 1])) {
    return false;
  }

  var nextIndex = commaIndex + 1;
  var digitCount = 0;
  while (nextIndex < rawValue.length && _isAsciiDigit(rawValue[nextIndex])) {
    digitCount++;
    nextIndex++;
  }

  return digitCount == 3;
}

bool _isMonthDayYearDateComma(String rawValue, int commaIndex) {
  if (commaIndex <= 0 || commaIndex + 1 >= rawValue.length) {
    return false;
  }

  var previousEnd = commaIndex;
  while (previousEnd > 0 && _isWhitespace(rawValue[previousEnd - 1])) {
    previousEnd--;
  }

  var previousStart = previousEnd;
  while (previousStart > 0 && !_isWhitespace(rawValue[previousStart - 1])) {
    previousStart--;
  }

  final previousToken = rawValue.substring(previousStart, previousEnd);
  if (!RegExp(r'^\d{1,2}$').hasMatch(previousToken)) {
    return false;
  }

  var nextStart = commaIndex + 1;
  while (nextStart < rawValue.length && _isWhitespace(rawValue[nextStart])) {
    nextStart++;
  }

  var nextEnd = nextStart;
  while (nextEnd < rawValue.length && _isAsciiDigit(rawValue[nextEnd])) {
    nextEnd++;
  }

  final nextToken = rawValue.substring(nextStart, nextEnd);
  return RegExp(r'^\d{4}$').hasMatch(nextToken);
}

bool _isAsciiDigit(String character) {
  final codeUnit = character.codeUnitAt(0);
  return codeUnit >= 48 && codeUnit <= 57;
}

bool _isWhitespace(String character) {
  return RegExp(r'\s').hasMatch(character);
}

bool _matchesCatalogFilterValue(String noteValue, String filterValue) {
  if (!noteValue.startsWith(filterValue)) {
    return false;
  }

  if (noteValue.length == filterValue.length) {
    return true;
  }

  final nextCharacter = noteValue.substring(
    filterValue.length,
    filterValue.length + 1,
  );
  return int.tryParse(nextCharacter) == null;
}

bool _matchesScalarFilter(
  String noteValue,
  String rawFilterValue, {
  required bool multiple,
  required bool Function(String noteValue, String filterValue) matcher,
  String Function(String value)? normalizeValue,
}) {
  final filters = multiple
      ? _parseMultiValueFilter(rawFilterValue, normalizeValue: normalizeValue)
      : [_parseFilterToken(rawFilterValue, normalizeValue: normalizeValue)]
            .whereType<_FilterToken>()
            .toList(growable: false);

  if (filters.isEmpty) {
    return true;
  }

  final positiveFilters = filters.where((filter) => !filter.negated);
  final negativeFilters = filters.where((filter) => filter.negated);

  if (positiveFilters.isNotEmpty) {
    final hasPositiveMatch = positiveFilters.any(
      (filter) => matcher(noteValue, filter.value),
    );
    if (!hasPositiveMatch) {
      return false;
    }
  }

  return negativeFilters.every((filter) => !matcher(noteValue, filter.value));
}

bool _matchesTagFilter(NoteRecord note, String rawFilterValue) {
  final filters = _parseMultiValueFilter(rawFilterValue);
  if (filters.isEmpty) {
    return true;
  }

  final noteTags = note.tags
      .map((tag) => tag.name.trim().toLowerCase())
      .where((name) => name.isNotEmpty)
      .toSet();

  return filters.every((filter) {
    final hasTag = noteTags.contains(filter.value);
    return filter.negated ? !hasTag : hasTag;
  });
}

// ---------------------------------------------------------------------------

double _measureTextWidth(
  String text,
  TextStyle style, {
  TextScaler textScaler = TextScaler.noScaling,
}) {
  final painter = TextPainter(
    text: TextSpan(text: text, style: style),
    maxLines: 1,
    textDirection: TextDirection.ltr,
    textScaler: textScaler,
  )..layout();
  return painter.width;
}

double _tagChipWidth(
  String tagName, {
  TextScaler textScaler = TextScaler.noScaling,
}) {
  final chipWidth =
      _measureTextWidth(
        tagName,
        _kTagChipTextStyle,
        textScaler: textScaler,
      ) +
      (_kTagChipHorizontalPadding * 2) +
      2;
  // The hit target is at least 44 pt wide, so the column must reserve that.
  return math.max(chipWidth, _kTagChipMinTargetSize);
}

List<String> _tagNames(List<Tag> tags) {
  return tags
      .map((tag) => tag.name.trim())
      .where((name) => name.isNotEmpty)
      .toList(growable: false);
}

/// How many leading tags fit in [maxWidth] once the overflow chip's label is
/// measured with the same text scale the chips render at. One chip is dropped
/// in favour of `+N more` as soon as the full run no longer fits.
({int visible, int hidden}) _planTagRow(
  List<String> tagNames,
  double maxWidth,
  TextScaler textScaler,
) {
  double rowWidth(int visible) {
    var width = 0.0;
    for (var index = 0; index < visible; index++) {
      width += _tagChipWidth(tagNames[index], textScaler: textScaler);
      if (index > 0) {
        width += _kTagChipHorizontalGap;
      }
    }
    final hidden = tagNames.length - visible;
    if (hidden > 0) {
      if (visible > 0) {
        width += _kTagChipHorizontalGap;
      }
      width += _tagChipWidth('+$hidden more', textScaler: textScaler);
    }
    return width;
  }

  for (var visible = tagNames.length; visible >= 0; visible--) {
    // TextPainter and the mounted Text round glyph widths slightly
    // differently; a few pixels of slack keep a row that lands on the column
    // edge from tipping into a sub-pixel RenderFlex overflow.
    if (rowWidth(visible) <= maxWidth - 4) {
      return (visible: visible, hidden: tagNames.length - visible);
    }
  }
  return (visible: 0, hidden: tagNames.length);
}

/// The grid row's readable summary, in the order a collector scans a note:
/// denomination, date, catalog, company, grade, serial, then tags. Empty
/// columns are left out so a screen reader does not hear a run of dashes.
String _noteSummaryLabel(NoteRecord note) {
  final parts = <String>[
    if (note.denomination.trim().isNotEmpty) note.denomination.trim(),
    if (note.issueDate.trim().isNotEmpty) 'dated ${note.issueDate.trim()}',
    if (note.catalogNumber.trim().isNotEmpty)
      'catalog ${note.catalogNumber.trim()}',
    if (note.gradingCompany.trim().isNotEmpty) note.gradingCompany.trim(),
    if (note.grade.trim().isNotEmpty) 'grade ${note.grade.trim()}',
    if (note.serial.trim().isNotEmpty) 'serial ${note.serial.trim()}',
  ];
  final tagNames = _tagNames(note.tags);
  if (tagNames.isNotEmpty) {
    parts.add('tags ${tagNames.join(', ')}');
  }
  return parts.isEmpty ? 'Empty note' : parts.join(', ');
}

/// The copy targets a row offers: the identifiers a collector most often
/// needs elsewhere.
String? _copyableCatalog(NoteRecord note) =>
    note.catalogNumber.trim().isEmpty ? null : note.catalogNumber.trim();

String? _copyableSerial(NoteRecord note) =>
    note.serial.trim().isEmpty ? null : note.serial.trim();

double _calculateTagsColumnWidth(List<NoteRecord> notes) {
  final headerWidth =
      _measureTextWidth('Tags', const TextStyle(fontWeight: FontWeight.w800)) +
      52;
  final notesWidth = notes.fold<double>(0, (maxWidth, note) {
    final tagNames = _tagNames(note.tags);
    if (tagNames.isEmpty) {
      return math.max(maxWidth, _measureTextWidth('-', _kDashTextStyle));
    }

    final rowWidth = tagNames
        .map(_tagChipWidth)
        .fold<double>(0, (sum, width) => sum + width);
    final spacing = math.max(0, tagNames.length - 1) * _kTagChipHorizontalGap;
    return math.max(maxWidth, rowWidth + spacing + _kTagsColumnSafetyPadding);
  });

  // Tags never widen the grid past its cap: whatever does not fit falls back
  // to the cell's +N more chip, so one note with many tags cannot widen every
  // row or push the readable columns off screen.
  return math.min(
    _kMaxTagsColumnWidth,
    math.max(_kDefaultTagsColumnWidth, math.max(headerWidth, notesWidth)),
  );
}

/// The scrolling columns' widths for one layout pass.
class _TableColumnWidths {
  const _TableColumnWidths({
    required this.denomination,
    required this.issueDate,
    required this.catalogNumber,
    required this.gradingCompany,
    required this.grade,
    required this.serial,
    required this.tags,
  });

  final double denomination;
  final double issueDate;
  final double catalogNumber;
  final double gradingCompany;
  final double grade;
  final double serial;
  final double tags;
}

/// Distributes the scrolling pane's [tableWidth] across its columns. Tags
/// grows into spare width up to [_kMaxTagsColumnWidth]; whatever remains is
/// shared by the text columns, so the row content fills the card instead of
/// leaving a dead gutter on a wide window.
_TableColumnWidths _calculateColumnWidths({
  required double tagsMinWidth,
  required double tableWidth,
}) {
  final scrollingWidth =
      tableWidth - _kPinnedPaneWidth - _kTableHorizontalPadding;

  var spare = scrollingWidth - (_kTextColumnsMinWidth + tagsMinWidth);
  final tags =
      tagsMinWidth +
      math.max(0.0, math.min(spare, _kMaxTagsColumnWidth - tagsMinWidth));
  spare -= tags - tagsMinWidth;

  final weightTotal = _kColumnFlexWeights.values.fold<double>(
    0,
    (sum, weight) => sum + weight,
  );
  double share(String key) => spare * (_kColumnFlexWeights[key]! / weightTotal);

  return _TableColumnWidths(
    denomination: _kDenominationColumnWidth + share('denomination'),
    issueDate: _kDateColumnWidth + share('issueDate'),
    catalogNumber: _kCatalogColumnWidth + share('catalogNumber'),
    gradingCompany: _kCompanyColumnWidth + share('gradingCompany'),
    grade: _kGradeColumnWidth + share('grade'),
    serial: _kSerialColumnWidth + share('serial'),
    tags: tags,
  );
}

class NotesTableScreen extends StatefulWidget {
  const NotesTableScreen({required this.controller, super.key});

  final DatasetController controller;

  @override
  State<NotesTableScreen> createState() => _NotesTableScreenState();
}

class _NotesTableScreenState extends State<NotesTableScreen> {
  final TextEditingController _searchController = TextEditingController();
  final ScrollController _horizontalScrollController = ScrollController();
  final ScrollController _verticalScrollController = ScrollController();
  final ScrollController _pinnedVerticalScrollController = ScrollController();
  bool _syncingVerticalScroll = false;
  bool _pinnedColumnDragActive = false;
  final GlobalKey _filterBarKey = GlobalKey();
  String _query = '';
  String _filterScope = _kDefaultFilterScope;
  bool _scopeHovered = false;
  String _sortKey = 'displayOrder';
  bool _ascending = true;
  int? _lastActiveCollectionId;
  int? _selectedIndex;
  bool _columnsDragging = false;
  late final FocusNode _tableFocusNode = FocusNode(debugLabel: 'notesTable');
  late final FocusNode _searchFocusNode = FocusNode(
    debugLabel: 'notesSearch',
    onKeyEvent: (_, event) => _handleSearchKey(event),
  );
  late final FocusNode _scopeFocusNode = FocusNode(
    debugLabel: 'notesFilterScope',
    onKeyEvent: (_, event) => _handleScopeKey(event),
  );
  late final Map<String, FocusNode> _headerFocusNodes = {
    for (final key in _kSortableHeaderKeys)
      key: FocusNode(
        debugLabel: 'tableHeader-$key',
        onKeyEvent: (node, event) => _handleHeaderKey(event, key),
      ),
  };
  late final FocusNode _importButtonFocusNode = FocusNode(
    debugLabel: 'tableImport',
  );
  late final FocusNode _cardSortFocusNode = FocusNode(
    debugLabel: 'cardSort',
    onKeyEvent: (_, event) => _handleCardSortKey(event),
  );
  late final FocusNode _cardSortDirectionFocusNode = FocusNode(
    debugLabel: 'cardSortDirection',
    onKeyEvent: (_, event) => _handleCardSortDirectionKey(event),
  );

  /// Measures the area the table body occupies, so keyboard handlers can tell
  /// which layout is on screen without recording it during build.
  final GlobalKey _tableAreaKey = GlobalKey();
  final GlobalKey _columnsViewportKey = GlobalKey();
  final Map<int, GlobalKey> _cardKeys = <int, GlobalKey>{};

  /// One focus node per tag chip, keyed by note. The table owns the explicit
  /// Tab chain, so it has to be able to hand focus to a row's chips and back.
  final Map<int, List<FocusNode>> _tagFocusNodes = <int, List<FocusNode>>{};

  /// Nodes retired by a dataset reload. They are disposed after the rebuilding
  /// frame, when their Focus widgets have detached them.
  final List<FocusNode> _retiredTagFocusNodes = <FocusNode>[];
  bool _retireTagNodesScheduled = false;

  /// The dataset whose notes the tag focus nodes were built for. A reload can
  /// reuse note ids with different tag lists, so the cache cannot outlive it.
  Object? _lastDataset;

  GlobalKey _cardKeyFor(int noteId) => _cardKeys.putIfAbsent(
    noteId,
    () => GlobalKey(debugLabel: 'noteCard-$noteId'),
  );

  bool get _cardLayout {
    final box = _tableAreaKey.currentContext?.findRenderObject();
    return box is RenderBox &&
        box.hasSize &&
        box.size.width < _kCardLayoutBreakpoint;
  }

  // Keyboard selection is a desktop affordance (Windows/macOS/Linux/Web).
  // It stays inert on touch-first platforms so tap behavior is unchanged.
  bool get _keyboardNavEnabled {
    if (kIsWeb) {
      return true;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.iOS:
      case TargetPlatform.android:
      case TargetPlatform.fuchsia:
        return false;
      case TargetPlatform.windows:
      case TargetPlatform.macOS:
      case TargetPlatform.linux:
        return true;
    }
  }

  List<NoteRecord> _currentVisibleNotes() =>
      _sortedNotes(widget.controller.activeCollectionNotes);

  double get _rowExtent => _kTableRowHeight + _kTableRowSeparatorHeight;

  void _scrollToOffset(double rawOffset) {
    if (!_verticalScrollController.hasClients) {
      return;
    }
    final position = _verticalScrollController.position;
    _verticalScrollController.animateTo(
      rawOffset.clamp(0.0, position.maxScrollExtent).toDouble(),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  bool get _columnsOverflow =>
      _horizontalScrollController.hasClients &&
      _horizontalScrollController.position.maxScrollExtent > 0;

  /// Animates the columns to [target] (clamped to the scrollable range).
  void _animateColumnsTo(double target) {
    if (!_columnsOverflow) {
      return;
    }
    final position = _horizontalScrollController.position;
    _horizontalScrollController.animateTo(
      target.clamp(0.0, position.maxScrollExtent).toDouble(),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  /// Pans the columns by [delta] logical pixels so the arrows can reveal
  /// columns that sit off-screen on a narrow window. Returns whether there was
  /// anything to scroll.
  bool _scrollColumnsBy(double delta) {
    if (!_columnsOverflow) {
      return false;
    }
    _animateColumnsTo(_horizontalScrollController.position.pixels + delta);
    return true;
  }

  /// Jumps to the first ([forward] false) or last ([forward] true) column.
  /// Returns whether there was anything to scroll.
  bool _scrollColumnsToEdge({required bool forward}) {
    if (!_columnsOverflow) {
      return false;
    }
    _animateColumnsTo(
      forward ? _horizontalScrollController.position.maxScrollExtent : 0,
    );
    return true;
  }

  /// Keeps the pinned ID/Front pane on the same row as the scrolling columns.
  /// Only the scrolling pane owns the vertical scrollbar and keyboard
  /// calculations; the pinned pane mirrors it, and a drag that starts on the
  /// pinned pane mirrors back.
  void _syncVerticalScroll(ScrollController source, ScrollController target) {
    if (_syncingVerticalScroll ||
        !source.hasClients ||
        !target.hasClients ||
        !source.position.hasContentDimensions ||
        !target.position.hasContentDimensions) {
      return;
    }
    final targetOffset = source.offset.clamp(
      target.position.minScrollExtent,
      target.position.maxScrollExtent,
    );
    if ((target.offset - targetOffset).abs() < 0.5) {
      return;
    }
    _syncingVerticalScroll = true;
    try {
      target.jumpTo(targetOffset.toDouble());
    } finally {
      _syncingVerticalScroll = false;
    }
  }

  void _syncMainToPinned() {
    _syncVerticalScroll(
      _verticalScrollController,
      _pinnedVerticalScrollController,
    );
  }

  void _syncPinnedToMain() {
    _syncVerticalScroll(
      _pinnedVerticalScrollController,
      _verticalScrollController,
    );
  }

  void _setColumnsDragging(bool dragging) {
    if (_columnsDragging == dragging) {
      return;
    }
    setState(() => _columnsDragging = dragging);
  }

  void _startPinnedColumnDrag(DragStartDetails _) {
    if (!_columnsOverflow) {
      return;
    }
    _collapseFilterSelection();
    _pinnedColumnDragActive = true;
    _setColumnsDragging(true);
  }

  void _endPinnedColumnDrag() {
    _pinnedColumnDragActive = false;
    _setColumnsDragging(false);
  }

  /// Pans the columns from a horizontal drag that started on the pinned pane,
  /// which sits outside the horizontal scroller and so cannot scroll it
  /// natively.
  void _panColumnsFromPinnedDrag(DragUpdateDetails details) {
    if (!_columnsOverflow) {
      return;
    }
    final position = _horizontalScrollController.position;
    _horizontalScrollController.jumpTo(
      (position.pixels - details.delta.dx)
          .clamp(position.minScrollExtent, position.maxScrollExtent)
          .toDouble(),
    );
  }

  /// Tracks whether the user is actively dragging the columns, so rows can
  /// show a closed-hand cursor. Vertical notifications are ignored.
  ///
  /// A user-driven scroll (wheel, drag) collapses a lingering select-all in
  /// the filter so the highlight does not sit stale behind the scrolled
  /// table; the row cursor itself survives, matching the Editor.
  /// Programmatic scrolls (keyboard navigation, reveal-after-close) never
  /// trigger this.
  /// Collapses a select-all left in the filter so its highlight does not sit
  /// stale behind a table pan. Shared by native scrolling and the pinned-pane
  /// drag, which pan without emitting a user scroll notification.
  void _collapseFilterSelection() {
    if (_searchFocusNode.hasFocus && !_searchController.selection.isCollapsed) {
      _searchController.selection = TextSelection.collapsed(
        offset: _searchController.text.length,
      );
    }
  }

  bool _handleTableScrollNotification(ScrollNotification notification) {
    // A wheel tick dispatches forward/reverse followed by idle; only the
    // user-driven directions collapse the filter highlight (idle also fires
    // when a programmatic jump settles back through goIdle).
    if (notification is UserScrollNotification &&
        notification.direction != ScrollDirection.idle) {
      _collapseFilterSelection();
    }
    if (notification.metrics.axis != Axis.horizontal) {
      return false;
    }
    if (notification is ScrollStartNotification &&
        notification.dragDetails != null) {
      _setColumnsDragging(true);
    } else if (notification is ScrollEndNotification &&
        _columnsDragging &&
        !_pinnedColumnDragActive) {
      _setColumnsDragging(false);
    }
    return false;
  }

  void _focusSelection(int index) {
    setState(() => _selectedIndex = index);
    _tableFocusNode.requestFocus();
  }

  /// Moves real keyboard focus to the [sortKey] header button and scrolls the
  /// columns the minimal amount to show it, but only when it is not already
  /// fully visible. The direction of travel doesn't decide this: where the
  /// header sits relative to the viewport does (a reverse step can still need
  /// to scroll right, e.g. Row 1 parked at the left edge stepping out to the
  /// far-right Tags header).
  void _focusHeader(String sortKey) {
    final node = _headerFocusNodes[sortKey];
    if (node == null) {
      return;
    }
    // Leaving a row for a header drops the ring so it doesn't linger behind
    // the header focus.
    if (_selectedIndex != null) {
      setState(() => _selectedIndex = null);
    }
    node.requestFocus();
    _revealHeaderIfNeeded(node);
  }

  /// Brings the header behind [node] into view with the smallest possible
  /// scroll, and does nothing when it is already fully visible. This mirrors
  /// the framework's own focus traversal ([RevealedOffset.clampOffset] picks
  /// whichever edge needs revealing), instead of [Scrollable.ensureVisible]'s
  /// one-sided policies, which only ever scroll a single direction.
  void _revealHeaderIfNeeded(FocusNode node) {
    final box = node.context?.findRenderObject();
    if (box is RenderBox) {
      _revealBox(_horizontalScrollController, box);
    }
  }

  /// Tab-driven row selection always presents rows from the left: entering or
  /// stepping through rows via Tab/Shift+Tab resets the panned columns, so a
  /// row reached from the far-right headers doesn't sit showing Tags.
  /// Arrow-key selection leaves the columns alone.
  void _focusRowFromTab(int index) {
    _focusSelection(index);
    _ensureSelectedVisible();
    if (_horizontalScrollController.hasClients) {
      _horizontalScrollController.jumpTo(0);
    }
  }

  /// The chip focus nodes for [note], created once and reused across builds.
  /// The viewer's data is read-only between archive loads, so a note's tag
  /// list does not change under a node until [_retireTagFocusNodes] runs.
  List<FocusNode> _tagFocusNodesFor(NoteRecord note) {
    return _tagFocusNodes.putIfAbsent(note.id, () {
      return [
        for (final name in _tagNames(note.tags))
          FocusNode(debugLabel: 'tagFilter-${note.id}-$name'),
      ];
    });
  }

  /// Drops the chip nodes when the notes may have changed. The old nodes stay
  /// alive until the rebuilding frame has detached their Focus widgets.
  void _retireTagFocusNodes() {
    for (final nodes in _tagFocusNodes.values) {
      _retiredTagFocusNodes.addAll(nodes);
    }
    _tagFocusNodes.clear();
    if (_retireTagNodesScheduled) {
      return;
    }
    _retireTagNodesScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _retireTagNodesScheduled = false;
      for (final node in _retiredTagFocusNodes) {
        node.dispose();
      }
      _retiredTagFocusNodes.clear();
    });
  }

  /// Moves keyboard focus onto chip [chipIndex] of [note], keeping the row's
  /// selection ring lit so the chip reads as part of the row.
  void _focusTagChip(NoteRecord note, int chipIndex) {
    final nodes = _tagFocusNodesFor(note);
    if (chipIndex < 0 || chipIndex >= nodes.length) {
      return;
    }
    final node = nodes[chipIndex];
    // A tag hidden behind the overflow chip has no mounted Focus, so it
    // cannot take keyboard focus.
    if (node.context == null) {
      return;
    }
    final rowIndex = _currentVisibleNotes().indexWhere(
      (candidate) => candidate.id == note.id,
    );
    if (rowIndex >= 0) {
      _focusSelection(rowIndex);
      _ensureSelectedVisible();
    }
    node.requestFocus();
    // The Tags column can sit off the right edge on a narrow window; bring the
    // focused chip into view the same way headers are revealed.
    _revealChip(node);
  }

  /// Pans the columns the minimal amount that shows [node]'s chip. The chip
  /// sits inside the rows' vertical list, so the generic viewport walk would
  /// measure against the wrong scroller; the horizontal viewport's key gives
  /// the on-screen position directly.
  void _revealChip(FocusNode node) {
    if (!_columnsOverflow) {
      return;
    }
    final viewport =
        _columnsViewportKey.currentContext?.findRenderObject() as RenderBox?;
    final box = node.context?.findRenderObject();
    if (viewport == null || box is! RenderBox) {
      return;
    }
    final left = box.localToGlobal(Offset.zero, ancestor: viewport).dx;
    final right = left + box.size.width;
    final position = _horizontalScrollController.position;
    if (left < 0) {
      _animateColumnsTo(position.pixels + left);
    } else if (right > viewport.size.width) {
      _animateColumnsTo(position.pixels + right - viewport.size.width);
    }
  }

  /// Tab from the selected row enters its first visible tag chip. Rows
  /// without tags, or whose tags all sit behind the overflow chip, keep
  /// walking straight to the next row.
  bool _focusTagsOfSelectedRow() {
    final index = _selectedIndex;
    final notes = _currentVisibleNotes();
    if (index == null || index < 0 || index >= notes.length) {
      return false;
    }
    final note = notes[index];
    final nodes = _tagFocusNodesFor(note);
    for (var chipIndex = 0; chipIndex < nodes.length; chipIndex++) {
      if (nodes[chipIndex].context != null) {
        _focusTagChip(note, chipIndex);
        return true;
      }
    }
    return false;
  }

  /// Tab from a chip: the next visible chip in the same row, or the next row.
  void _focusAfterTag(NoteRecord note, int chipIndex, {required bool forward}) {
    final nodes = _tagFocusNodesFor(note);
    final step = forward ? 1 : -1;
    for (var index = chipIndex + step; index >= 0 && index < nodes.length; index += step) {
      if (nodes[index].context != null) {
        _focusTagChip(note, index);
        return;
      }
    }

    final notes = _currentVisibleNotes();
    final rowIndex = notes.indexWhere((candidate) => candidate.id == note.id);
    if (rowIndex < 0) {
      _tableFocusNode.requestFocus();
      return;
    }
    if (forward) {
      if (rowIndex + 1 < notes.length) {
        _focusRowFromTab(rowIndex + 1);
      }
      return;
    }

    // Reverse out of the first chip returns to its row, ring still lit.
    _focusSelection(rowIndex);
  }

  /// Shift+Tab from a row steps into the previous row's last visible chip,
  /// matching the forward chain row -> chips -> next row.
  bool _focusTrailingTagOfPreviousRow() {
    final index = _selectedIndex;
    final notes = _currentVisibleNotes();
    if (index == null || index <= 0 || index >= notes.length) {
      return false;
    }
    final previous = notes[index - 1];
    final nodes = _tagFocusNodesFor(previous);
    for (var chipIndex = nodes.length - 1; chipIndex >= 0; chipIndex--) {
      if (nodes[chipIndex].context != null) {
        _focusTagChip(previous, chipIndex);
        return true;
      }
    }
    return false;
  }

  /// Explicit Tab order within a focused header button. The table-level
  /// handler owns row Tab; this owns header-to-header (and header-to-edge)
  /// moves so propagation stops here once handled.
  KeyEventResult _handleHeaderKey(KeyEvent event, String sortKey) {
    if (!_isPlainTab(event)) {
      return KeyEventResult.ignored;
    }
    final index = _kSortableHeaderKeys.indexOf(sortKey);
    if (index < 0) {
      return KeyEventResult.ignored;
    }
    if (HardwareKeyboard.instance.isShiftPressed) {
      if (index == 0) {
        _focusSearchField();
      } else {
        _focusHeader(_kSortableHeaderKeys[index - 1]);
      }
      return KeyEventResult.handled;
    }
    if (index == _kSortableHeaderKeys.length - 1) {
      // Last header behaves like ArrowDown: land on the first row, or stop
      // when there is no row to land on.
      if (_currentVisibleNotes().isEmpty) {
        return KeyEventResult.handled;
      }
      _focusRowFromTab(0);
      return KeyEventResult.handled;
    }
    _focusHeader(_kSortableHeaderKeys[index + 1]);
    return KeyEventResult.handled;
  }

  /// Whether [event] is a plain Tab press: the keyboard-navigation gate, the
  /// event-kind and key checks, and the modifier screen every Tab chain shares.
  bool _isPlainTab(KeyEvent event) {
    if (!_keyboardNavEnabled) {
      return false;
    }
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return false;
    }
    if (event.logicalKey != LogicalKeyboardKey.tab) {
      return false;
    }
    return !HardwareKeyboard.instance.isControlPressed &&
        !HardwareKeyboard.instance.isMetaPressed &&
        !HardwareKeyboard.instance.isAltPressed;
  }

  /// Tab order after the filter: the first sortable header in grid mode, the
  /// sort menu in card mode.
  void _focusFirstControlAfterFilter() {
    _dropRowSelection();
    if (_cardLayout) {
      _cardSortFocusNode.requestFocus();
      return;
    }
    _focusHeader(_kSortableHeaderKeys.first);
  }

  /// Tab order before the rows, in reverse: the last sortable header in grid
  /// mode, the sort direction button in card mode.
  void _focusLastControlBeforeRows() {
    _dropRowSelection();
    if (_cardLayout) {
      _cardSortDirectionFocusNode.requestFocus();
      return;
    }
    _focusHeader(_kSortableHeaderKeys.last);
  }

  void _dropRowSelection() {
    if (_selectedIndex != null) {
      setState(() => _selectedIndex = null);
    }
  }

  /// Tab order within card mode's sort controls: field -> direction -> rows,
  /// mirroring the header chain the grid presents at the same point.
  KeyEventResult _handleCardSortKey(KeyEvent event) {
    if (!_isPlainTab(event)) {
      return KeyEventResult.ignored;
    }
    if (HardwareKeyboard.instance.isShiftPressed) {
      _focusSearchField();
      return KeyEventResult.handled;
    }
    _cardSortDirectionFocusNode.requestFocus();
    return KeyEventResult.handled;
  }

  KeyEventResult _handleCardSortDirectionKey(KeyEvent event) {
    if (!_isPlainTab(event)) {
      return KeyEventResult.ignored;
    }
    if (HardwareKeyboard.instance.isShiftPressed) {
      _cardSortFocusNode.requestFocus();
      return KeyEventResult.handled;
    }
    if (_currentVisibleNotes().isNotEmpty) {
      _focusRowFromTab(0);
    }
    return KeyEventResult.handled;
  }

  @override
  void initState() {
    super.initState();
    _lastActiveCollectionId = widget.controller.activeCollectionId;
    _lastDataset = widget.controller.dataset;
    widget.controller.addListener(_handleControllerChange);
    _searchFocusNode.addListener(_handleFilterFocusChange);
    _scopeFocusNode.addListener(_handleFilterFocusChange);
    _verticalScrollController.addListener(_syncMainToPinned);
    _pinnedVerticalScrollController.addListener(_syncPinnedToMain);
    FocusManager.instance.addListener(_handleFocusDrain);
  }

  @override
  void didUpdateWidget(covariant NotesTableScreen oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (oldWidget.controller == widget.controller) {
      return;
    }

    oldWidget.controller.removeListener(_handleControllerChange);
    _lastActiveCollectionId = widget.controller.activeCollectionId;
    _lastDataset = widget.controller.dataset;
    _retireTagFocusNodes();
    _cardKeys.clear();
    widget.controller.addListener(_handleControllerChange);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_handleFocusDrain);
    widget.controller.removeListener(_handleControllerChange);
    _searchFocusNode.removeListener(_handleFilterFocusChange);
    _scopeFocusNode.removeListener(_handleFilterFocusChange);
    _searchController.dispose();
    _horizontalScrollController.dispose();
    _verticalScrollController.dispose();
    _pinnedVerticalScrollController.dispose();
    _tableFocusNode.dispose();
    _searchFocusNode.dispose();
    _scopeFocusNode.dispose();
    _importButtonFocusNode.dispose();
    _cardSortFocusNode.dispose();
    _cardSortDirectionFocusNode.dispose();
    for (final node in _headerFocusNodes.values) {
      node.dispose();
    }
    for (final nodes in _tagFocusNodes.values) {
      for (final node in nodes) {
        node.dispose();
      }
    }
    _tagFocusNodes.clear();
    for (final node in _retiredTagFocusNodes) {
      node.dispose();
    }
    _retiredTagFocusNodes.clear();
    super.dispose();
  }

  /// Re-claims keyboard control when focus drains to nothing while this
  /// screen owns the route. This happens on startup: the home crossfade
  /// mounts the table while the exiting import screen still holds focus,
  /// and the focus is lost when that screen unmounts — leaving arrow keys
  /// to wander through focus traversal (import button, filter) instead of
  /// reaching the rows. Pushed routes (slideshow, dialogs) make this route
  /// non-current, so they are never disturbed.
  void _handleFocusDrain() {
    if (!mounted || !_keyboardNavEnabled) {
      return;
    }
    if (ModalRoute.of(context)?.isCurrent != true) {
      return;
    }
    // A scope as primary focus means no interactive leaf holds focus: the
    // route scope itself reports hasFocus, so check the type instead.
    final primary = FocusManager.instance.primaryFocus;
    if (primary != null && primary is! FocusScopeNode) {
      return;
    }
    _tableFocusNode.requestFocus();
  }

  /// Switching from the title menu hands keyboard control back to the table,
  /// so arrows browse the new collection immediately instead of staying on the
  /// heading.
  void _selectCollectionFromTitle(int collectionId) {
    unawaited(widget.controller.selectCollection(collectionId));
    _tableFocusNode.requestFocus();
  }

  void _handleControllerChange() {
    final dataset = widget.controller.dataset;
    if (!identical(dataset, _lastDataset)) {
      _lastDataset = dataset;
      _retireTagFocusNodes();
      _cardKeys.clear();
    }

    final currentCollectionId = widget.controller.activeCollectionId;
    if (_lastActiveCollectionId == currentCollectionId) {
      return;
    }

    _lastActiveCollectionId = currentCollectionId;

    if (!mounted) {
      return;
    }

    setState(() {
      _query = '';
      _filterScope = _kDefaultFilterScope;
      _searchController.clear();
      _selectedIndex = null;
    });
    _cardKeys.clear();

    if (_horizontalScrollController.hasClients) {
      _horizontalScrollController.jumpTo(0);
    }

    _resetVerticalScroll();
  }

  List<NoteRecord> _sortedNotes(List<NoteRecord> notes) {
    final trimmedQuery = _query.trim();
    final filtered = notes
        .where((note) {
          if (trimmedQuery.isEmpty) return true;

          if (_filterScope == _kAllFieldsScope) {
            return _matchesAllFieldsSearch(note, trimmedQuery);
          }

          if (_filterScope == 'tags') {
            return _matchesTagFilter(note, trimmedQuery);
          }

          final fieldValue = note.valueForColumn(_filterScope).toLowerCase();
          final supportsMultipleValues =
              _filterScope == 'catalogNumber' ||
              _filterScope == 'grade' ||
              _filterScope == 'issueDate' ||
              _filterScope == 'denomination';
          return _matchesScalarFilter(
            fieldValue,
            trimmedQuery,
            multiple: supportsMultipleValues,
            matcher: switch (_filterScope) {
              'catalogNumber' => _matchesCatalogFilterValue,
              'denomination' => _matchesDenominationFilterValue,
              _ => (noteValue, filterValue) => noteValue.contains(filterValue),
            },
          );
        })
        .toList(growable: false);

    return sortNotes(filtered, column: _sortKey, ascending: _ascending);
  }

  /// A sort, filter, or scope change rebuilds the list from a different first
  /// row. The old vertical offset would then open the result set partway down
  /// (or at its tail when the new set is shorter), so both panes return to the
  /// top whenever the visible rows change.
  void _resetVerticalScroll() {
    if (_verticalScrollController.hasClients) {
      _verticalScrollController.jumpTo(0);
    }
    if (_pinnedVerticalScrollController.hasClients) {
      _pinnedVerticalScrollController.jumpTo(0);
    }
  }

  void _toggleSort(String key) {
    setState(() {
      if (_sortKey == key) {
        _ascending = !_ascending;
      } else {
        _sortKey = key;
        _ascending = true;
      }
      _selectedIndex = null;
    });
    _resetVerticalScroll();
  }

  /// Card mode's sort menu names the field in one control and leaves the
  /// direction to the arrow button beside it.
  void _setSortKey(String key) {
    if (key != _sortKey) {
      _toggleSort(key);
    }
  }

  void _toggleSortDirection() {
    _toggleSort(_sortKey);
  }

  void _applyTagFilter(String tagName) {
    _searchController.text = tagName;
    setState(() {
      _query = tagName;
      _filterScope = 'tags';
      _selectedIndex = null;
    });
    if (_horizontalScrollController.hasClients) {
      _horizontalScrollController.jumpTo(0);
    }
    _resetVerticalScroll();
  }

  void _clearFilter() {
    _searchController.clear();
    setState(() {
      _query = '';
      _selectedIndex = null;
    });
    _resetVerticalScroll();
  }

  /// Tells a screen reader about an action it could not see, since the table
  /// has no toast of its own.
  void _announce(String message) {
    SemanticsService.sendAnnouncement(
      View.of(context),
      message,
      Directionality.of(context),
    );
  }

  /// Copies [value] and says what was copied.
  Future<void> _copyValue(String value, String what) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) {
      return;
    }
    _announce('Copied $what $value');
  }

  /// The row's copy action, available by right click and long press. Text
  /// selection would fight the drag-to-pan table, so the identifiers are
  /// copied from a small menu instead.
  Future<void> _showNoteMenu(NoteRecord note, Offset globalPosition) async {
    final catalog = _copyableCatalog(note);
    final serial = _copyableSerial(note);
    final targets = <({String label, String value})>[
      if (catalog != null) (label: 'catalog number', value: catalog),
      if (serial != null) (label: 'serial', value: serial),
    ];
    if (targets.isEmpty) {
      return;
    }

    final overlay = Overlay.of(context).context.findRenderObject();
    if (overlay is! RenderBox) {
      return;
    }

    final choice = await showMenu<({String label, String value})>(
      context: context,
      position: RelativeRect.fromRect(
        Rect.fromPoints(globalPosition, globalPosition),
        Offset.zero & overlay.size,
      ),
      items: [
        for (final target in targets)
          PopupMenuItem(
            value: target,
            child: Text('Copy ${target.label}'),
          ),
      ],
    );
    if (!mounted || choice == null) {
      return;
    }
    await _copyValue(choice.value, choice.label);
  }

  /// Ctrl/Cmd+C copies the selected row's serial (or its catalog number when
  /// it has no serial), the identifiers a collector most often needs. Returns
  /// whether a row was selected to copy from.
  bool _copySelectedRow() {
    final notes = _currentVisibleNotes();
    final index = _selectedIndex;
    if (index == null || index < 0 || index >= notes.length) {
      return false;
    }
    final note = notes[index];
    final serial = _copyableSerial(note);
    if (serial != null) {
      unawaited(_copyValue(serial, 'serial'));
      return true;
    }
    final catalog = _copyableCatalog(note);
    if (catalog != null) {
      unawaited(_copyValue(catalog, 'catalog number'));
      return true;
    }
    _announce('This note has no serial or catalog number to copy');
    return true;
  }

  Widget? _clearFilterButton() {
    if (_query.isEmpty) {
      return null;
    }
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: IconButton(
        tooltip: 'Clear filter',
        onPressed: _clearFilter,
        iconSize: 18,
        padding: const EdgeInsets.all(7),
        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
        style: IconButton.styleFrom(
          foregroundColor: ViewerPalette.textMuted,
          hoverColor: ViewerPalette.accentSoft,
          focusColor: ViewerPalette.accentSoft,
          highlightColor: ViewerPalette.accentSoft,
        ),
        icon: const Icon(Icons.close_rounded),
      ),
    );
  }

  Future<void> _openNoteAtIndex(List<NoteRecord> notes, int index) async {
    // Opening a note dismisses the row cursor; closing the slideshow paints
    // it back on the returned row (see _revealNoteById), matching the Editor.
    if (_selectedIndex != null) {
      setState(() => _selectedIndex = null);
    }
    final result = await Navigator.of(context).push<NoteSlideshowResult>(
      MaterialPageRoute<NoteSlideshowResult>(
        builder: (context) =>
            NoteSlideshowScreen(notes: notes, initialIndex: index),
      ),
    );
    if (!mounted) {
      return;
    }
    if (_horizontalScrollController.hasClients) {
      _horizontalScrollController.jumpTo(0);
    }
    if (result?.tagName != null) {
      _searchController.text = result!.tagName!;
      setState(() {
        _query = result.tagName!;
        _filterScope = 'tags';
        _selectedIndex = null;
      });
      _resetVerticalScroll();
    }
    if (result != null) {
      _revealNoteById(result.noteId);
    }
  }

  void _openSelected() {
    final notes = _currentVisibleNotes();
    final index = _selectedIndex;
    if (index == null || index < 0 || index >= notes.length) {
      return;
    }
    _openNoteAtIndex(notes, index);
  }

  void _moveSelection(int offset) {
    final notes = _currentVisibleNotes();
    if (notes.isEmpty) {
      return;
    }
    final current = _selectedIndex;
    // With nothing selected both directions enter the table at the first row,
    // matching the Editor. Up from the first row then hands off to the filter
    // (see _handleTableKey) rather than wrapping to the last row.
    final next = current == null
        ? 0
        : (current + offset).clamp(0, notes.length - 1);
    _focusSelection(next);
    _ensureSelectedVisible();
  }

  void _selectBoundary(bool first) {
    final notes = _currentVisibleNotes();
    if (notes.isEmpty) {
      return;
    }
    _focusSelection(first ? 0 : notes.length - 1);
    _ensureSelectedVisible();
  }

  void _pageSelection(int direction) {
    final notes = _currentVisibleNotes();
    if (notes.isEmpty) {
      return;
    }
    var pageSize = 10;
    var firstVisibleIndex = 0;
    final rowExtent = _cardLayout ? _kCardEstimatedExtent : _rowExtent;
    if (_verticalScrollController.hasClients) {
      final position = _verticalScrollController.position;
      pageSize = math.max(1, (position.viewportDimension / rowExtent).floor());
      firstVisibleIndex = (position.pixels / rowExtent).floor().clamp(
        0,
        notes.length - 1,
      );
    }
    final base = _selectedIndex ?? firstVisibleIndex;
    final target = (base + direction * pageSize).clamp(0, notes.length - 1);
    _focusSelection(target);
    _ensureIndexVisible(target);
  }

  /// Scrolls [index] to the top of the current layout. The grid has a fixed
  /// row pitch; cards are measured after they are built.
  void _ensureIndexVisible(int index) {
    if (_cardLayout) {
      unawaited(_ensureCardVisible(index));
      return;
    }
    _scrollToOffset(index * _rowExtent);
  }

  void _ensureSelectedVisible() {
    final index = _selectedIndex;
    if (index == null) {
      return;
    }
    if (_cardLayout) {
      unawaited(_ensureCardVisible(index));
      return;
    }
    if (!_verticalScrollController.hasClients) {
      return;
    }
    final position = _verticalScrollController.position;
    final targetTop = index * _rowExtent;
    final targetBottom = targetTop + _kTableRowHeight;
    final scrollOffset = position.pixels;
    final viewportBottom = scrollOffset + position.viewportDimension;
    double? target;
    if (targetTop < scrollOffset) {
      target = targetTop;
    } else if (targetBottom > viewportBottom) {
      target = targetBottom - position.viewportDimension;
    }
    if (target == null) {
      return;
    }
    _scrollToOffset(target);
  }

  /// Brings the card at [index] fully into view with the smallest scroll.
  /// Cards vary in height (tags wrap, text scales), so the target is measured
  /// from the built widget instead of assumed from a fixed pitch. A card the
  /// lazy list has not built yet is reached by jumping to an estimated share
  /// of the scrollable range first, then aligning it once it exists.
  Future<void> _ensureCardVisible(int index) async {
    final notes = _currentVisibleNotes();
    if (index < 0 || index >= notes.length || !_cardLayout) {
      return;
    }
    final key = _cardKeyFor(notes[index].id);
    if (key.currentContext != null) {
      _alignCardInViewport(key);
      return;
    }
    if (!_verticalScrollController.hasClients) {
      return;
    }
    final position = _verticalScrollController.position;
    final fraction = notes.length <= 1 ? 0.0 : index / (notes.length - 1);
    final target = (fraction * position.maxScrollExtent)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    // Jump rather than animate: an animated target settles after the frame in
    // which the card would have been built and measured.
    position.jumpTo(target);
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted || !_cardLayout) {
      return;
    }
    _alignCardInViewport(key);
  }

  void _alignCardInViewport(GlobalKey key) {
    final box = key.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.attached) {
      return;
    }
    _revealBox(_verticalScrollController, box);
  }

  /// Scrolls [box] into view with the smallest move on [scroller], on either
  /// axis. Does nothing when the box is already fully visible.
  void _revealBox(ScrollController scroller, RenderBox box) {
    if (!scroller.hasClients) {
      return;
    }
    final viewport = RenderAbstractViewport.maybeOf(box);
    if (viewport == null) {
      return;
    }
    final position = scroller.position;
    final target = RevealedOffset.clampOffset(
      leadingEdgeOffset: viewport.getOffsetToReveal(box, 0.0),
      trailingEdgeOffset: viewport.getOffsetToReveal(box, 1.0),
      currentOffset: position.pixels,
    );
    if (target == null) {
      return;
    }
    scroller.animateTo(
      target.offset
          .clamp(position.minScrollExtent, position.maxScrollExtent)
          .toDouble(),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  KeyEventResult _handleTableKey(KeyEvent event) {
    if (!_keyboardNavEnabled) {
      return KeyEventResult.ignored;
    }
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    // Alt is never one of the interchangeable modifiers: Alt+arrow stays
    // inert everywhere, so it must be screened out before the jump branch.
    if (HardwareKeyboard.instance.isAltPressed) {
      return KeyEventResult.ignored;
    }
    final bool shiftPressed = HardwareKeyboard.instance.isShiftPressed;
    // Jump-to-edge accepts Shift or the platform's primary modifier: Cmd on
    // macOS, Ctrl elsewhere.
    final bool primaryModifierPressed =
        defaultTargetPlatform == TargetPlatform.macOS
        ? HardwareKeyboard.instance.isMetaPressed
        : HardwareKeyboard.instance.isControlPressed;
    final bool jumpColumns = primaryModifierPressed || shiftPressed;
    final bool leftKey =
        key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.keyH;
    final bool rightKey =
        key == LogicalKeyboardKey.arrowRight || key == LogicalKeyboardKey.keyL;
    if (jumpColumns && (leftKey || rightKey)) {
      return _scrollColumnsToEdge(forward: rightKey)
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    // Copy the selected row's identifier. It comes before the modifier screen
    // below, which hands every other Ctrl/Cmd chord back to the platform. Only
    // the first press copies: a held chord must not re-copy on every repeat.
    if (event is KeyDownEvent &&
        primaryModifierPressed &&
        key == LogicalKeyboardKey.keyC) {
      if (_copySelectedRow()) {
        return KeyEventResult.handled;
      }
    }
    if (HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isMetaPressed) {
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.tab) {
      // Explicit Tab order for the table stop: headers are handled by their
      // own focus nodes, this covers the table/row stop. Forward Tab walks
      // rows like ArrowDown; reverse Shift+Tab walks back up, stepping out to
      // the last header from the first row. Both ends stop in place.
      final notes = _currentVisibleNotes();
      if (HardwareKeyboard.instance.isShiftPressed) {
        final current = _selectedIndex;
        if (current == null) {
          _focusSearchField();
          return KeyEventResult.handled;
        }
        if (current <= 0) {
          _focusLastControlBeforeRows();
          return KeyEventResult.handled;
        }
        if (_focusTrailingTagOfPreviousRow()) {
          return KeyEventResult.handled;
        }
        _focusRowFromTab(current - 1);
        return KeyEventResult.handled;
      }
      final current = _selectedIndex;
      if (current == null) {
        _focusFirstControlAfterFilter();
        return KeyEventResult.handled;
      }
      if (_focusTagsOfSelectedRow()) {
        return KeyEventResult.handled;
      }
      if (current >= notes.length - 1) {
        return KeyEventResult.handled;
      }
      _focusRowFromTab(current + 1);
      return KeyEventResult.handled;
    }
    // Row focus moves only for the plain keys: Shift+Up/Down and Shift+j/k
    // are inert so resting a finger on Shift does not move the selection.
    if (!shiftPressed &&
        (key == LogicalKeyboardKey.arrowDown ||
            key == LogicalKeyboardKey.keyJ)) {
      _moveSelection(1);
      return KeyEventResult.handled;
    }
    if (!shiftPressed &&
        (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK)) {
      // Up from the first row steps out of the table and into the filter.
      // Home keeps its own meaning below: it always lands on the first row.
      if (_selectedIndex == 0) {
        _focusSearchField();
        return KeyEventResult.handled;
      }
      _moveSelection(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.home) {
      _selectBoundary(true);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.end) {
      _selectBoundary(false);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.pageUp) {
      _pageSelection(-1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.pageDown) {
      _pageSelection(1);
      return KeyEventResult.handled;
    }
    if (leftKey) {
      return _scrollColumnsBy(-_kColumnScrollStep)
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    if (rightKey) {
      return _scrollColumnsBy(_kColumnScrollStep)
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter ||
        key == LogicalKeyboardKey.space) {
      // Let focused controls (sort headers, row links) activate themselves.
      if (FocusManager.instance.primaryFocus != _tableFocusNode) {
        return KeyEventResult.ignored;
      }
      _openSelected();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.slash &&
        !HardwareKeyboard.instance.isShiftPressed) {
      _focusSearchField();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape) {
      if (_selectedIndex != null) {
        setState(() => _selectedIndex = null);
      } else if (_query.isNotEmpty) {
        // Deselected table: one more Escape clears the filters (mirrors the
        // editor's filters -> first row -> deselect -> clear cascade).
        _searchController.clear();
        setState(() {
          _query = '';
          _selectedIndex = null;
        });
        _resetVerticalScroll();
      }
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _focusSearchField() {
    // Entering the filter drops the row selection; typing narrows the list
    // from scratch and Esc back to the table starts unselected.
    setState(() => _selectedIndex = null);
    _searchFocusNode.requestFocus();
    final text = _searchController.text;
    if (text.isNotEmpty) {
      _searchController.selection = TextSelection(
        baseOffset: 0,
        extentOffset: text.length,
      );
    }
  }

  void _handleFilterFocusChange() {
    // Focusing the filter by any means (click, tap, slash, Tab) drops the row
    // selection so the selection ring doesn't linger behind the controls.
    // Rebuilds on every focus change so the unified bar can highlight while
    // either the scope select or the text field holds focus.
    if (mounted) {
      setState(() {
        if ((_searchFocusNode.hasFocus || _scopeFocusNode.hasFocus) &&
            _selectedIndex != null) {
          _selectedIndex = null;
        }
      });
    }
  }

  /// Called for each pointer-down outside the filter text field. On desktop,
  /// Flutter's default would unfocus the field to the enclosing route scope;
  /// because a drag never fires an `onTap`, that leaves the table without
  /// primary focus and its shortcuts (/, arrows) dead. Return keyboard
  /// control to the table instead. Pointer-downs on the scope select belong
  /// to the same unified bar and are ignored so the menu can open.
  void _handleFilterTapOutside(PointerDownEvent event) {
    final barBox =
        _filterBarKey.currentContext?.findRenderObject() as RenderBox?;
    if (barBox != null &&
        barBox.paintBounds
            .shift(barBox.localToGlobal(Offset.zero))
            .contains(event.position)) {
      return;
    }
    if (!_keyboardNavEnabled) {
      // Touch platforms keep the default: dismiss the on-screen keyboard.
      _searchFocusNode.unfocus();
      return;
    }
    if (_selectedIndex != null) {
      setState(() => _selectedIndex = null);
    }
    _tableFocusNode.requestFocus();
  }

  KeyEventResult _handleSearchKey(KeyEvent event) {
    if (!_keyboardNavEnabled) {
      return KeyEventResult.ignored;
    }
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.tab) {
      // Explicit Tab order from the filter field: forward enters the headers
      // at ID, reverse steps back to the scope select. Collapse a lingering
      // select-all so the highlight does not sit stale behind the next focus.
      if (HardwareKeyboard.instance.isControlPressed ||
          HardwareKeyboard.instance.isMetaPressed ||
          HardwareKeyboard.instance.isAltPressed) {
        return KeyEventResult.ignored;
      }
      if (!_searchController.selection.isCollapsed) {
        _searchController.selection = TextSelection.collapsed(
          offset: _searchController.text.length,
        );
      }
      if (HardwareKeyboard.instance.isShiftPressed) {
        _scopeFocusNode.requestFocus();
        return KeyEventResult.handled;
      }
      _focusFirstControlAfterFilter();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape) {
      // Escape behaves like ArrowDown here: leave the filter and land on the
      // first row. With no rows to land on, focus the table unselected so a
      // further Escape can still clear the filters.
      if (_currentVisibleNotes().isEmpty) {
        setState(() => _selectedIndex = null);
        _tableFocusNode.requestFocus();
        return KeyEventResult.handled;
      }
      setState(() => _selectedIndex = 0);
      _tableFocusNode.requestFocus();
      _ensureSelectedVisible();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowDown &&
        HardwareKeyboard.instance.isShiftPressed) {
      // Shift+Down must not pull focus out of the filter: it is left for the
      // text field's own selection handling. This has to come before the
      // transfer branch below, whose Ctrl/Cmd/Alt guard does not screen Shift.
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.arrowDown ||
        key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      if (HardwareKeyboard.instance.isControlPressed ||
          HardwareKeyboard.instance.isMetaPressed ||
          HardwareKeyboard.instance.isAltPressed) {
        return KeyEventResult.ignored;
      }
      if (_currentVisibleNotes().isEmpty) {
        _tableFocusNode.requestFocus();
        return KeyEventResult.handled;
      }
      setState(() => _selectedIndex ??= 0);
      _tableFocusNode.requestFocus();
      _ensureSelectedVisible();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  KeyEventResult _handleScopeKey(KeyEvent event) {
    if (!_isPlainTab(event)) {
      return KeyEventResult.ignored;
    }
    // Tab order: import button -> scope select -> filter field -> headers.
    if (HardwareKeyboard.instance.isShiftPressed) {
      if (widget.controller.canManageImportedDatasets) {
        _importButtonFocusNode.requestFocus();
      }
      return KeyEventResult.handled;
    }
    _focusSearchField();
    return KeyEventResult.handled;
  }

  void _setFilterScope(String? scope) {
    if (scope == null || scope == _filterScope) {
      return;
    }
    setState(() {
      _filterScope = scope;
      _selectedIndex = null;
    });
    _resetVerticalScroll();
    // The menu closes on selection; hand typing straight to the filter
    // field, however the option was picked (mouse, touch, or keyboard).
    _focusSearchField();
  }

  String get _filterHint {
    for (final scope in _kFilterScopes) {
      if (scope.value == _filterScope) {
        return scope.hint;
      }
    }
    return 'Filter…';
  }

  Future<void> _openImportScreen() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) =>
            ImportDatasetScreen(controller: widget.controller),
      ),
    );
  }

  void _revealNoteById(int noteId) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_verticalScrollController.hasClients) {
        return;
      }

      final dataset = widget.controller.dataset;
      if (dataset == null) {
        return;
      }

      final visibleNotes = _sortedNotes(
        widget.controller.activeCollectionNotes,
      );
      final noteIndex = visibleNotes.indexWhere((note) => note.id == noteId);
      if (noteIndex < 0) {
        return;
      }

      // The closed slideshow always restores the row cursor on the
      // returned row, however the slideshow was opened, matching the Editor.
      if (_keyboardNavEnabled) {
        _focusSelection(noteIndex);
      }

      _ensureIndexVisible(noteIndex);
    });
  }

  /// The nine-column desktop grid, kept at its full minimum width and panned
  /// horizontally whenever the window is narrower than it. ID and Front are
  /// pinned outside the horizontal scroller so the note identity survives a
  /// pan; when a column still sits past the right edge, a slim footer states
  /// the result count, the sort, and how to pan: the scrollbar stays hidden,
  /// but the cut can never read as empty data.
  Widget _buildGrid(
    List<NoteRecord> notes,
    double availableWidth, {
    required int totalCount,
  }) {
    final tagsMinWidth = _calculateTagsColumnWidth(notes);
    final tableWidth = math.max(
      _kPinnedPaneWidth +
          _kTextColumnsMinWidth +
          tagsMinWidth +
          _kTableHorizontalPadding,
      availableWidth,
    );
    final columnWidths = _calculateColumnWidths(
      tagsMinWidth: tagsMinWidth,
      tableWidth: tableWidth,
    );
    final pinnedPaneWidth = math.min(_kPinnedPaneWidth, availableWidth);
    final rightContentWidth = math.max(0.0, tableWidth - pinnedPaneWidth);
    final columnsNeedPan =
        tableWidth - _kTableHorizontalPadding > availableWidth + 0.5;

    Widget buildRow(int index, {required bool pinned}) {
      final note = notes[index];
      final selected = _keyboardNavEnabled && _selectedIndex == index;
      final Widget row = pinned
          ? _PinnedTableRow(
              note: note,
              draggingColumns: _columnsDragging,
              selected: selected,
              onTap: () => _openNoteAtIndex(notes, index),
              onMenu: (position) => _showNoteMenu(note, position),
              onCopy: _copyValue,
            )
          : _TableRow(
              note: note,
              columnWidths: columnWidths,
              draggingColumns: _columnsDragging,
              selected: selected,
              onTagTap: _applyTagFilter,
              onTap: () => _openNoteAtIndex(notes, index),
              onMenu: (position) => _showNoteMenu(note, position),
              onCopy: _copyValue,
              tagFocusNodes: _tagFocusNodesFor(note),
              onTagTab: (chipIndex, {required forward}) =>
                  _focusAfterTag(note, chipIndex, forward: forward),
            );
      if (index.isOdd) {
        return ColoredBox(color: _kZebraTint, child: row);
      }
      return row;
    }

    return Column(
      children: [
        Expanded(
          child: NotificationListener<ScrollNotification>(
            onNotification: _handleTableScrollNotification,
            child: Scrollbar(
              key: const ValueKey('tableVerticalScrollbar'),
              controller: _verticalScrollController,
              thumbVisibility: true,
              notificationPredicate: (notification) =>
                  notification.metrics.axis == Axis.vertical,
              child: Row(
                children: [
                  SizedBox(
                    key: const ValueKey('tablePinnedColumns'),
                    width: pinnedPaneWidth,
                    child: MouseRegion(
                      cursor: _columnsDragging
                          ? _draggingCursor
                          : MouseCursor.defer,
                      child: GestureDetector(
                        behavior: HitTestBehavior.translucent,
                        onHorizontalDragStart: _startPinnedColumnDrag,
                        onHorizontalDragUpdate: _panColumnsFromPinnedDrag,
                        onHorizontalDragEnd: (_) => _endPinnedColumnDrag(),
                        onHorizontalDragCancel: _endPinnedColumnDrag,
                        child: Column(
                          children: [
                            SizedBox(
                              height: _kTableHeaderHeight,
                              child: _PinnedTableHeader(
                                sortKey: _sortKey,
                                ascending: _ascending,
                                onSort: _toggleSort,
                                headerFocusNodes: _headerFocusNodes,
                              ),
                            ),
                            const Divider(
                              height: 1,
                              thickness: 1,
                              color: _kTableHeaderDivider,
                            ),
                            Expanded(
                              child: ScrollConfiguration(
                                behavior: const _NoInnerScrollbarBehavior(),
                                child: ListView.separated(
                                  controller: _pinnedVerticalScrollController,
                                  itemCount: notes.length,
                                  separatorBuilder: (context, index) =>
                                      const Divider(
                                        height: 1,
                                        color: _kTableDivider,
                                      ),
                                  itemBuilder: (context, index) =>
                                      buildRow(index, pinned: true),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: ScrollConfiguration(
                            behavior: const MouseDragScrollBehavior(),
                            child: SingleChildScrollView(
                              key: _columnsViewportKey,
                              controller: _horizontalScrollController,
                              scrollDirection: Axis.horizontal,
                              child: SizedBox(
                                width: rightContentWidth,
                                child: Column(
                                  children: [
                                    SizedBox(
                                      height: _kTableHeaderHeight,
                                      child: _TableHeader(
                                        sortKey: _sortKey,
                                        ascending: _ascending,
                                        onSort: _toggleSort,
                                        columnWidths: columnWidths,
                                        draggingColumns: _columnsDragging,
                                        headerFocusNodes: _headerFocusNodes,
                                      ),
                                    ),
                                    const Divider(
                                      height: 1,
                                      thickness: 1,
                                      color: _kTableHeaderDivider,
                                    ),
                                    Expanded(
                                      child: ScrollConfiguration(
                                        behavior:
                                            const _NoInnerScrollbarBehavior(),
                                        child: ListView.separated(
                                          controller: _verticalScrollController,
                                          itemCount: notes.length,
                                          separatorBuilder: (context, index) =>
                                              const Divider(
                                                height: 1,
                                                color: _kTableDivider,
                                              ),
                                          itemBuilder: (context, index) =>
                                              buildRow(index, pinned: false),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          top: _kTableHeaderHeight + 1,
                          right: 0,
                          bottom: 0,
                          width: 44,
                          child: _ColumnsEdgeFade(
                            controller: _horizontalScrollController,
                            overflow: columnsNeedPan,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        _TableFooter(
          visibleCount: notes.length,
          totalCount: totalCount,
          sortKey: _sortKey,
          ascending: _ascending,
          showPanHint: columnsNeedPan,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () {
          if (!_searchFocusNode.hasFocus && _keyboardNavEnabled) {
            _tableFocusNode.requestFocus();
          } else {
            FocusScope.of(context).unfocus();
          }
        },
        child: ColoredBox(
          color: ViewerPalette.pageBackground,
          child: SafeArea(
            bottom: false,
            child: AnimatedBuilder(
              animation: widget.controller,
              builder: (context, _) {
                final canImport = widget.controller.canManageImportedDatasets;
                if (widget.controller.isLoading &&
                    widget.controller.dataset == null) {
                  return const _TableStateCard(
                    key: ValueKey('tableLoadingCard'),
                    icon: Icons.hourglass_empty_rounded,
                    title: 'Loading notes…',
                    detail: 'Reading the collection from the archive.',
                    liveRegion: true,
                  );
                }

                if (widget.controller.loadError != null &&
                    widget.controller.dataset == null) {
                  return _TableStateCard(
                    key: const ValueKey('tableErrorCard'),
                    liveRegion: true,
                    icon: Icons.error_outline_rounded,
                    title: 'Couldn’t load notes',
                    detail:
                        'The dataset could not be read. Nothing was changed.',
                    reassurance:
                        'Check that the archive is available, then try again.',
                    action: Wrap(
                      alignment: WrapAlignment.center,
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        FilledButton(
                          onPressed: () => unawaited(widget.controller.load()),
                          child: const Text('Try again'),
                        ),
                        if (canImport)
                          TextButton(
                            onPressed: _openImportScreen,
                            child: const Text('Import another archive'),
                          ),
                      ],
                    ),
                  );
                }

                final dataset = widget.controller.dataset;
                if (dataset == null) {
                  return _TableStateCard(
                    key: const ValueKey('tableNoDatasetCard'),
                    icon: Icons.collections_bookmark_outlined,
                    title: 'No notes loaded',
                    detail: 'Import an archive to start a collection.',
                    action: canImport
                        ? FilledButton.icon(
                            onPressed: _openImportScreen,
                            icon: const Icon(
                              Icons.file_upload_outlined,
                              size: 16,
                            ),
                            label: const Text('Import notes'),
                          )
                        : null,
                  );
                }

                final scopedNotes = widget.controller.activeCollectionNotes;
                final notes = _sortedNotes(scopedNotes);
                final rawCollectionName =
                    widget.controller.activeCollection?.name ?? '';
                final collectionName = rawCollectionName.trim().isEmpty
                    ? 'Collection'
                    : rawCollectionName.trim();

                // The Viewer keeps a 12px inset rather than the Editor's 24px
                // horizontal step: the card already owns 14px cell gutters, and
                // the tighter page keeps the filter and grid roomy at 400px.
                return Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _Header(
                        collectionName: collectionName,
                        collections: dataset.collections,
                        activeCollectionId:
                            widget.controller.activeCollection?.id,
                        onSelectCollection: _selectCollectionFromTitle,
                        totalCount: scopedNotes.length,
                        visibleCount: notes.length,
                        onOpenImports: canImport ? _openImportScreen : null,
                        importButtonFocusNode: _importButtonFocusNode,
                      ),
                      const SizedBox(height: 20),
                      // The bar is capped on wide windows and left-aligned in
                      // the stretched column, so it never out-shouts the table.
                      Align(
                        alignment: Alignment.centerLeft,
                        child: ConstrainedBox(
                          key: const ValueKey('filterBar'),
                          constraints: const BoxConstraints(
                            maxWidth: _kFilterBarMaxWidth,
                          ),
                          child: LayoutBuilder(
                            builder: (context, barConstraints) {
                              // The scope select keeps 180–200px: enough for
                              // "Denomination" at 400px, capped so the text
                              // input keeps the rest of the bar.
                              final scopeWidth =
                                  (barConstraints.maxWidth * 0.34)
                                      .clamp(180.0, 200.0)
                                      .toDouble();
                              final filterFocused =
                                  _searchFocusNode.hasFocus ||
                                  _scopeFocusNode.hasFocus;
                              final filterBorderWidth = filterFocused
                                  ? 1.5
                                  : 1.0;
                              return Material(
                                key: _filterBarKey,
                                color: ViewerPalette.surface,
                                clipBehavior: Clip.antiAlias,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(
                                    ViewerPalette.radiusControl,
                                  ),
                                  side: BorderSide(
                                    color: filterFocused
                                        ? ViewerPalette.accent
                                        : ViewerPalette.borderControl,
                                    width: filterBorderWidth,
                                  ),
                                ),
                                child: SizedBox(
                                  height: _kFilterBarHeight,
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.center,
                                    children: [
                                      SizedBox(
                                        width: scopeWidth,
                                        height: _kFilterBarHeight,
                                        // The select highlights as one unit
                                        // (label and arrow together) on hover
                                        // and on keyboard focus; square ink,
                                        // the bar owns the rounded corners.
                                        child: MouseRegion(
                                          onEnter: (_) => setState(
                                            () => _scopeHovered = true,
                                          ),
                                          onExit: (_) => setState(
                                            () => _scopeHovered = false,
                                          ),
                                          child: AnimatedContainer(
                                            duration: const Duration(
                                              milliseconds: 150,
                                            ),
                                            curve: Curves.easeOut,
                                            width: double.infinity,
                                            color:
                                                _scopeHovered ||
                                                    _scopeFocusNode.hasFocus
                                                ? ViewerPalette.accentSoft
                                                : Colors.transparent,
                                            child: Theme(
                                              data: Theme.of(context).copyWith(
                                                hoverColor: Colors.transparent,
                                                highlightColor:
                                                    Colors.transparent,
                                                splashColor: Colors.transparent,
                                                focusColor: Colors.transparent,
                                              ),
                                              child: DropdownButtonHideUnderline(
                                                child: Tooltip(
                                                  message: 'Filter by',
                                                  child: DropdownButton<String>(
                                                    key: const ValueKey(
                                                      'filterScope',
                                                    ),
                                                    value: _filterScope,
                                                    focusNode: _scopeFocusNode,
                                                    isDense: true,
                                                    isExpanded: true,
                                                    focusColor:
                                                        Colors.transparent,
                                                    borderRadius:
                                                        BorderRadius.zero,
                                                    padding:
                                                        const EdgeInsets.symmetric(
                                                          horizontal: 12,
                                                        ),
                                                    style: const TextStyle(
                                                      fontFamily: 'Inter',
                                                      color: ViewerPalette.text,
                                                      fontSize: 13,
                                                      fontWeight:
                                                          FontWeight.w700,
                                                    ),
                                                    // The button shows plain
                                                    // labels; the hover wash
                                                    // lives on the option rows
                                                    // and on this wrapper, so
                                                    // label and arrow read as
                                                    // one.
                                                    selectedItemBuilder:
                                                        (context) => [
                                                          for (final scope
                                                              in _kFilterScopes)
                                                            Text(
                                                              scope.label,
                                                              maxLines: 1,
                                                              overflow:
                                                                  TextOverflow
                                                                      .ellipsis,
                                                            ),
                                                        ],
                                                    items: [
                                                      for (final scope
                                                          in _kFilterScopes)
                                                        DropdownMenuItem<
                                                          String
                                                        >(
                                                          value: scope.value,
                                                          child:
                                                              _FilterScopeOption(
                                                                label:
                                                                    scope.label,
                                                              ),
                                                        ),
                                                    ],
                                                    onChanged: _setFilterScope,
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                      Container(
                                        width: 1,
                                        // Full interior height: the divider
                                        // touches the bar's top and bottom
                                        // borders without painting over them.
                                        height:
                                            _kFilterBarHeight -
                                            filterBorderWidth * 2,
                                        color: _kTableBorder,
                                      ),
                                      Expanded(
                                        child: TextField(
                                          controller: _searchController,
                                          focusNode: _searchFocusNode,
                                          textAlignVertical:
                                              TextAlignVertical.center,
                                          // The typed query wears the same
                                          // 13px voice as the scope label and
                                          // hint; the default 16px body style
                                          // also lands its baseline below the
                                          // hint's, so the text reads low.
                                          style: _kFilterInputTextStyle,
                                          // Flutter's default tap-outside behavior
                                          // drops primary focus to the enclosing
                                          // route scope. On a drag that never
                                          // re-fires the table's onTap, so `/` and
                                          // the arrow keys stop working. Hand
                                          // keyboard control back to the table
                                          // instead (taps on the scope select are
                                          // part of the same bar and ignored).
                                          onTapOutside: _handleFilterTapOutside,
                                          decoration: InputDecoration(
                                            hintText: _filterHint,
                                            hintStyle: _kFilterHintTextStyle,
                                            // Unfilled: the bar behind owns the
                                            // background, so hovering the input
                                            // cannot wash it with a hover layer.
                                            filled: false,
                                            // Dense keeps the decorator's 48px
                                            // minimum from clamping against the
                                            // 40px bar, which would push the
                                            // text below the field's center.
                                            isDense: true,
                                            suffixIcon: _clearFilterButton(),
                                            contentPadding:
                                                const EdgeInsets.symmetric(
                                                  horizontal: 16,
                                                  vertical: 10,
                                                ),
                                            border: InputBorder.none,
                                            enabledBorder: InputBorder.none,
                                            focusedBorder: InputBorder.none,
                                          ),
                                          onChanged: (value) {
                                            setState(() {
                                              _query = value;
                                              _selectedIndex = null;
                                            });
                                            _resetVerticalScroll();
                                          },
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Expanded(
                        child: LayoutBuilder(
                          key: _tableAreaKey,
                          builder: (context, constraints) {
                            final Widget body;
                            if (notes.isEmpty) {
                              final collectionIsEmpty = scopedNotes.isEmpty;
                              body = Column(
                                children: [
                                  Expanded(
                                    child: _TableEmptyState(
                                      filtered: !collectionIsEmpty,
                                      collectionName: collectionName,
                                      onClearFilter: _clearFilter,
                                      onImport: canImport
                                          ? _openImportScreen
                                          : null,
                                    ),
                                  ),
                                  _TableFooter(
                                    visibleCount: 0,
                                    totalCount: scopedNotes.length,
                                    sortKey: _sortKey,
                                    ascending: _ascending,
                                    showPanHint: false,
                                  ),
                                ],
                              );
                            } else if (constraints.maxWidth <
                                _kCardLayoutBreakpoint) {
                              body = ClipRRect(
                                borderRadius: BorderRadius.circular(
                                  _kCardRadius,
                                ),
                                child: _NoteCardList(
                                  notes: notes,
                                  selectedIndex: _selectedIndex,
                                  keyboardNavEnabled: _keyboardNavEnabled,
                                  sortKey: _sortKey,
                                  ascending: _ascending,
                                  onSortKey: _setSortKey,
                                  onToggleSortDirection: _toggleSortDirection,
                                  onTagTap: _applyTagFilter,
                                  onOpenNote: (index) =>
                                      _openNoteAtIndex(notes, index),
                                  onMenu: (index, position) =>
                                      _showNoteMenu(notes[index], position),
                                  onCopy: _copyValue,
                                  cardKeyFor: _cardKeyFor,
                                  tagFocusNodesFor: _tagFocusNodesFor,
                                  onTagTab: (note, chipIndex, {required forward}) =>
                                      _focusAfterTag(
                                        note,
                                        chipIndex,
                                        forward: forward,
                                      ),
                                  scrollController: _verticalScrollController,
                                  sortFocusNode: _cardSortFocusNode,
                                  directionFocusNode:
                                      _cardSortDirectionFocusNode,
                                  onScrollNotification:
                                      _handleTableScrollNotification,
                                ),
                              );
                            } else {
                              body = ClipRRect(
                                borderRadius: BorderRadius.circular(
                                  _kCardRadius,
                                ),
                                child: _buildGrid(
                                  notes,
                                  constraints.maxWidth,
                                  totalCount: scopedNotes.length,
                                ),
                              );
                            }

                            return Focus(
                              focusNode: _tableFocusNode,
                              autofocus: _keyboardNavEnabled,
                              onKeyEvent: (node, event) =>
                                  _handleTableKey(event),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  color: _kTableSurface,
                                  borderRadius: BorderRadius.circular(
                                    _kCardRadius,
                                  ),
                                  // The 1px frame is painted by the foreground
                                  // layer below so content cannot cover it; a
                                  // background border would double its alpha.
                                  boxShadow: ViewerPalette.shadowMid,
                                ),
                                child: DecoratedBox(
                                  position: DecorationPosition.foreground,
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(
                                      _kCardRadius,
                                    ),
                                    border: Border.all(
                                      color: _kTableCardBorder,
                                      width: 1,
                                    ),
                                  ),
                                  child: body,
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/// One row of the open filter-scope menu. The label fills the item width and
/// lifts to a red wash on mouse hover and on keyboard focus, so the
/// arrow-keyed option reads exactly like a hovered one; the text style is
/// inherited from the scope select.
class _FilterScopeOption extends StatefulWidget {
  const _FilterScopeOption({required this.label});

  final String label;

  @override
  State<_FilterScopeOption> createState() => _FilterScopeOptionState();
}

class _FilterScopeOptionState extends State<_FilterScopeOption> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    // The menu item's own InkWell owns the focus node, so mirror it without
    // adding another one that would disturb arrow-key traversal.
    final focused = Focus.maybeOf(context)?.hasFocus ?? false;
    return MouseRegion(
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: _hovered || focused
              ? ViewerPalette.accentSoft
              : Colors.transparent,
          borderRadius: BorderRadius.circular(ViewerPalette.radiusSm),
        ),
        child: Text(widget.label, overflow: TextOverflow.ellipsis),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.collectionName,
    required this.collections,
    required this.activeCollectionId,
    required this.onSelectCollection,
    required this.totalCount,
    required this.visibleCount,
    required this.onOpenImports,
    required this.importButtonFocusNode,
  });

  final String collectionName;
  final List<ViewerCollection> collections;
  final int? activeCollectionId;
  final ValueChanged<int> onSelectCollection;
  final int totalCount;
  final int visibleCount;
  final VoidCallback? onOpenImports;
  final FocusNode importButtonFocusNode;

  @override
  Widget build(BuildContext context) {
    final title = collectionName.trim().isEmpty ? 'Collection' : collectionName;

    // The identity block (mark + collection title) and the trailing controls
    // always share one line. The title is the only flexible part, so it
    // ellipsizes instead of pushing the counter and import action onto a new
    // row.
    Widget identity() {
      return Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
            child: Image.asset(
              'web/icons/Icon-192.png',
              width: 34,
              height: 34,
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'NOTE HARBOR',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.9,
                    height: 1,
                    color: ViewerPalette.textMuted,
                  ),
                ),
                const SizedBox(height: 3),
                _CollectionTitle(
                  activeCollectionId: activeCollectionId,
                  collections: collections,
                  onSelected: onSelectCollection,
                  title: title,
                ),
              ],
            ),
          ),
        ],
      );
    }

    final importButton = onOpenImports == null
        ? null
        : _ImportButton(
            onPressed: onOpenImports!,
            focusNode: importButtonFocusNode,
          );

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < _kCardLayoutBreakpoint;
        // The counter shrinks within this share of the header when a narrow
        // window and a large text scale would otherwise push the import action
        // onto a second row. The title keeps the rest and ellipsizes.
        final statMaxWidth = compact
            ? constraints.maxWidth * _kCompactStatShare
            : null;
        final trailing = Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StatPill(
              value: _notesCountLabel(visibleCount, totalCount),
              semanticsLabel:
                  '$visibleCount of $totalCount '
                  '${totalCount == 1 ? 'note' : 'notes'}',
              maxWidth: statMaxWidth,
            ),
            if (importButton != null) ...[
              SizedBox(width: compact ? 8 : 12),
              importButton,
            ],
          ],
        );

        return Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(child: identity()),
            SizedBox(width: compact ? 12 : 16),
            trailing,
          ],
        );
      },
    );
  }
}

/// The collection name, doubling as a collection switcher.
///
/// It stays a heading at rest: no field, border, or pill. A small chevron sits
/// beside the name so the switcher is visible without hovering, the pointer
/// becomes a hand, and the tooltip names the action. Long names ellipsize. A
/// library with a single collection keeps the plain title — there is nothing
/// to switch to, so no affordance is shown.
class _CollectionTitle extends StatefulWidget {
  const _CollectionTitle({
    required this.title,
    required this.collections,
    required this.activeCollectionId,
    required this.onSelected,
  });

  final String title;
  final List<ViewerCollection> collections;
  final int? activeCollectionId;
  final ValueChanged<int> onSelected;

  @override
  State<_CollectionTitle> createState() => _CollectionTitleState();
}

class _CollectionTitleState extends State<_CollectionTitle> {
  final LayerLink _link = LayerLink();
  final OverlayPortalController _overlay = OverlayPortalController();
  final FocusNode _triggerFocus = FocusNode(debugLabel: 'collectionTitle');
  final Object _tapGroup = Object();

  bool _open = false;

  bool get _hasChoices => widget.collections.length > 1;

  @override
  void initState() {
    super.initState();
    _triggerFocus.addListener(_handleFocusChange);
  }

  @override
  void dispose() {
    _triggerFocus.removeListener(_handleFocusChange);
    _triggerFocus.dispose();
    super.dispose();
  }

  void _handleFocusChange() {
    if (mounted) {
      setState(() {});
    }
  }

  void _openMenu() {
    if (_open || !_hasChoices) {
      return;
    }

    setState(() => _open = true);
    _overlay.show();
  }

  void _closeMenu({bool returnFocus = true}) {
    if (!_open) {
      return;
    }

    _overlay.hide();
    setState(() => _open = false);

    if (returnFocus && mounted) {
      _triggerFocus.requestFocus();
    }
  }

  KeyEventResult _handleTriggerKey(KeyEvent event) {
    if (event is! KeyDownEvent) {
      return KeyEventResult.ignored;
    }

    final key = event.logicalKey;

    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter ||
        key == LogicalKeyboardKey.space ||
        key == LogicalKeyboardKey.arrowDown ||
        key == LogicalKeyboardKey.arrowUp) {
      _openMenu();
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.escape && _open) {
      _closeMenu();
      return KeyEventResult.handled;
    }

    return KeyEventResult.ignored;
  }

  void _handleSelected(int collectionId) {
    _closeMenu();
    widget.onSelected(collectionId);
  }

  /// Opens the switcher, or closes it when it is already open. Both the
  /// gesture and the semantics activate action share this so they cannot
  /// drift apart.
  void _activate() {
    if (_open) {
      _closeMenu();
      return;
    }

    _triggerFocus.requestFocus();
    _openMenu();
  }

  @override
  Widget build(BuildContext context) {
    final title = Text(
      widget.title.toUpperCase(),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: _kCollectionTitleTextStyle,
    );

    if (!_hasChoices) {
      return title;
    }

    return Align(
      alignment: Alignment.centerLeft,
      child: CompositedTransformTarget(
        link: _link,
        child: TapRegion(
          groupId: _tapGroup,
          child: OverlayPortal(
            controller: _overlay,
            overlayChildBuilder: (context) => CompositedTransformFollower(
              link: _link,
              showWhenUnlinked: false,
              targetAnchor: Alignment.bottomLeft,
              followerAnchor: Alignment.topLeft,
              offset: const Offset(0, 6),
              child: Align(
                alignment: Alignment.topLeft,
                child: TapRegion(
                  groupId: _tapGroup,
                  onTapOutside: (_) => _closeMenu(returnFocus: false),
                  child: _CollectionMenu(
                    activeCollectionId: widget.activeCollectionId,
                    collections: widget.collections,
                    onClose: _closeMenu,
                    onSelected: _handleSelected,
                  ),
                ),
              ),
            ),
            child: Focus(
              focusNode: _triggerFocus,
              onKeyEvent: (_, event) => _handleTriggerKey(event),
              child: MouseRegion(
                cursor: SystemMouseCursors.click,
                child: Tooltip(
                  message: 'Switch collection: ${widget.title}',
                  waitDuration: const Duration(milliseconds: 500),
                  child: GestureDetector(
                    key: const ValueKey('collectionTitle'),
                    behavior: HitTestBehavior.opaque,
                    onTap: _activate,
                    child: Semantics(
                      button: true,
                      excludeSemantics: true,
                      label:
                          'Collection: ${widget.title}. Activate to switch collection.',
                      onTap: _activate,
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Flexible(child: title),
                              Padding(
                                padding: const EdgeInsets.only(left: 5),
                                child: AnimatedRotation(
                                  duration: const Duration(milliseconds: 150),
                                  turns: _open ? 0.5 : 0,
                                  child: Icon(
                                    Icons.expand_more,
                                    size: 16,
                                    color: _triggerFocus.hasFocus
                                        ? ViewerPalette.accent
                                        : ViewerPalette.textFaint,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          // The 2 px ring the other keyboard stops wear. It is
                          // paint only, so focus never reflows the heading.
                          if (_triggerFocus.hasFocus)
                            Positioned.fill(
                              left: -4,
                              top: -4,
                              right: -4,
                              bottom: -4,
                              child: IgnorePointer(
                                child: DecoratedBox(
                                  key: const ValueKey(
                                    'collectionTitleFocusRing',
                                  ),
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(
                                      ViewerPalette.radiusChip + 4,
                                    ),
                                    border: Border.all(
                                      color: ViewerPalette.accent,
                                      width: 2,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CollectionMenu extends StatefulWidget {
  const _CollectionMenu({
    required this.collections,
    required this.activeCollectionId,
    required this.onSelected,
    required this.onClose,
  });

  final List<ViewerCollection> collections;
  final int? activeCollectionId;
  final ValueChanged<int> onSelected;
  final VoidCallback onClose;

  @override
  State<_CollectionMenu> createState() => _CollectionMenuState();
}

class _CollectionMenuState extends State<_CollectionMenu> {
  final TextEditingController _filter = TextEditingController();
  late final FocusNode _filterFocus = FocusNode(
    debugLabel: 'collectionMenuFilter',
    onKeyEvent: (_, event) => _handleFilterKey(event),
  );

  int _highlighted = 0;

  @override
  void initState() {
    super.initState();
    _highlighted = _activeRowIndex();
    // The overlay child is not attached during initState; focus it once the
    // first frame has laid it out so typing always lands in the filter.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _filterFocus.requestFocus();
      }
    });
  }

  @override
  void dispose() {
    _filter.dispose();
    _filterFocus.dispose();
    super.dispose();
  }

  List<ViewerCollection> get _filtered {
    final query = _filter.text.trim().toLowerCase();

    if (query.isEmpty) {
      return widget.collections;
    }

    return widget.collections
        .where((collection) => collection.name.toLowerCase().contains(query))
        .toList(growable: false);
  }

  int _activeRowIndex() {
    final index = widget.collections.indexWhere(
      (collection) => collection.id == widget.activeCollectionId,
    );
    return index < 0 ? 0 : index;
  }

  void _handleQueryChanged(String _) {
    setState(() {
      _highlighted = _filtered.isEmpty ? -1 : 0;
    });
  }

  void _moveHighlight(int delta) {
    final count = _filtered.length;

    if (count == 0) {
      return;
    }

    setState(() {
      _highlighted = (_highlighted + delta) % count;
      if (_highlighted < 0) {
        _highlighted += count;
      }
    });
  }

  void _activateHighlighted() {
    final rows = _filtered;

    if (rows.isEmpty) {
      return;
    }

    final index = _highlighted.clamp(0, rows.length - 1);
    widget.onSelected(rows[index].id);
  }

  KeyEventResult _handleFilterKey(KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }

    final key = event.logicalKey;

    if (key == LogicalKeyboardKey.arrowDown) {
      _moveHighlight(1);
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.arrowUp) {
      _moveHighlight(-1);
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      _activateHighlighted();
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.escape) {
      widget.onClose();
      return KeyEventResult.handled;
    }

    if (key == LogicalKeyboardKey.tab) {
      // The filter is the menu's only control. Leaving it closes the menu and
      // hands focus back to the title, so Tab never strands an open popover.
      widget.onClose();
      return KeyEventResult.handled;
    }

    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    final highlighted = rows.isEmpty
        ? -1
        : _highlighted.clamp(0, rows.length - 1);

    return Container(
      key: const ValueKey('collectionMenu'),
      width: 300,
      constraints: const BoxConstraints(maxHeight: 380),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: ViewerPalette.surface,
        borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
        border: Border.all(color: ViewerPalette.border),
        boxShadow: ViewerPalette.shadowHigh,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(10, 2, 10, 2),
            decoration: const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: ViewerPalette.borderSoft),
              ),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.search,
                  size: 14,
                  color: ViewerPalette.textFaint,
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: TextField(
                    key: const ValueKey('collectionMenuFilter'),
                    controller: _filter,
                    cursorColor: ViewerPalette.accent,
                    focusNode: _filterFocus,
                    onChanged: _handleQueryChanged,
                    onSubmitted: (_) => _activateHighlighted(),
                    style: const TextStyle(
                      fontFamily: 'Inter',
                      fontSize: 12,
                      color: ViewerPalette.text,
                    ),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.symmetric(vertical: 9),
                      hintStyle: TextStyle(
                        fontFamily: 'Inter',
                        fontSize: 12,
                        color: ViewerPalette.textFaint,
                      ),
                      hintText: 'Jump to collection…',
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(14, 8, 14, 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'COLLECTIONS',
                style: TextStyle(
                  color: ViewerPalette.textMuted,
                  fontFamily: 'Inter',
                  fontSize: 9.5,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.2,
                ),
              ),
            ),
          ),
          Flexible(
            child: rows.isEmpty
                ? const Padding(
                    padding: EdgeInsets.fromLTRB(14, 8, 14, 14),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'No collections match.',
                        style: TextStyle(
                          color: ViewerPalette.textMuted,
                          fontFamily: 'Inter',
                          fontSize: 12,
                        ),
                      ),
                    ),
                  )
                : ListView.builder(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(4, 0, 4, 4),
                    itemCount: rows.length,
                    itemBuilder: (context, index) {
                      final collection = rows[index];

                      return _CollectionMenuRow(
                        active: collection.id == widget.activeCollectionId,
                        highlighted: index == highlighted,
                        name: collection.name,
                        noteCount: collection.noteCount,
                        onHover: () {
                          if (_highlighted != index) {
                            setState(() => _highlighted = index);
                          }
                        },
                        onTap: () => widget.onSelected(collection.id),
                      );
                    },
                  ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(14, 6, 14, 8),
            decoration: const BoxDecoration(
              border: Border(top: BorderSide(color: ViewerPalette.borderSoft)),
            ),
            child: const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '↑ ↓ move · Enter switch · Esc close',
                style: TextStyle(
                  color: ViewerPalette.textFaint,
                  fontFamily: 'Inter',
                  fontSize: 10.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CollectionMenuRow extends StatelessWidget {
  const _CollectionMenuRow({
    required this.active,
    required this.highlighted,
    required this.name,
    required this.noteCount,
    required this.onHover,
    required this.onTap,
  });

  final bool active;
  final bool highlighted;
  final String name;
  final int noteCount;
  final VoidCallback onHover;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: active,
      child: MouseRegion(
        onEnter: (_) => onHover(),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 100),
            curve: Curves.easeOut,
            margin: const EdgeInsets.symmetric(vertical: 1),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: highlighted
                  ? ViewerPalette.accentSoft
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(5),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: ViewerPalette.text,
                      fontFamily: 'Inter',
                      fontSize: 13,
                      fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '$noteCount',
                  style: const TextStyle(
                    color: ViewerPalette.textFaint,
                    fontFamily: 'Inter',
                    fontSize: 11,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  width: 14,
                  child: active
                      ? const Icon(
                          Icons.check,
                          color: ViewerPalette.accent,
                          size: 14,
                        )
                      : null,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ImportButton extends StatefulWidget {
  const _ImportButton({required this.onPressed, required this.focusNode});

  final VoidCallback onPressed;
  final FocusNode focusNode;

  @override
  State<_ImportButton> createState() => _ImportButtonState();
}

class _ImportButtonState extends State<_ImportButton> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
        decoration: BoxDecoration(
          color: _hovered ? ViewerPalette.accentSoft : _kTableSurface,
          borderRadius: BorderRadius.circular(ViewerPalette.radiusPill),
          border: Border.all(
            color: _hovered ? ViewerPalette.accent : _kTableBorder,
          ),
        ),
        child: SizedBox(
          height: _kHeaderControlHeight,
          width: _kHeaderControlHeight,
          child: IconButton(
            focusNode: widget.focusNode,
            tooltip: 'Manage imported archives',
            onPressed: widget.onPressed,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints.tightFor(
              width: _kHeaderControlHeight,
              height: _kHeaderControlHeight,
            ),
            icon: const Icon(
              Icons.file_upload_outlined,
              size: 20,
              color: ViewerPalette.accent,
            ),
          ),
        ),
      ),
    );
  }
}

class _StatPill extends StatelessWidget {
  const _StatPill({
    required this.value,
    required this.semanticsLabel,
    this.maxWidth,
  });

  final String value;

  /// The spoken form of the counter, e.g. "12 of 169 notes". The pill is a
  /// live region, so a filter change is announced without moving focus.
  final String semanticsLabel;

  /// Card-width headers cap the pill to a share of the header and shrink its
  /// contents when a large text scale would otherwise crowd out the title and
  /// the import action. Wide headers leave it unbounded.
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    final valueText = Text(
      value,
      style: const TextStyle(
        fontFamily: 'Inter',
        fontSize: 14,
        fontWeight: FontWeight.w700,
        color: _kTableText,
        fontFeatures: [FontFeature.tabularFigures()],
      ),
    );

    return Semantics(
      container: true,
      liveRegion: true,
      label: semanticsLabel,
      excludeSemantics: true,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth ?? double.infinity),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: _kTableSurface,
            borderRadius: BorderRadius.circular(ViewerPalette.radiusPill),
            border: Border.all(color: _kTableBorder),
          ),
          child: SizedBox(
            height: _kHeaderControlHeight,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: valueText,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PinnedTableHeader extends StatelessWidget {
  const _PinnedTableHeader({
    required this.sortKey,
    required this.ascending,
    required this.onSort,
    required this.headerFocusNodes,
  });

  final String sortKey;
  final bool ascending;
  final ValueChanged<String> onSort;
  final Map<String, FocusNode> headerFocusNodes;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      key: const ValueKey('pinnedTableHeader'),
      color: _kTableHeaderBg,
      child: Padding(
        padding: const EdgeInsets.only(left: _kTableHorizontalPadding),
        child: Row(
          children: [
            _HeaderCell(
              width: _kOrderColumnWidth,
              label: '#',
              alignment: Alignment.centerRight,
              sortKey: 'displayOrder',
              activeSortKey: sortKey,
              ascending: ascending,
              onSort: onSort,
              semanticLabel: 'ID (display order)',
              tooltip: 'ID (display order)',
              focusNode: headerFocusNodes['displayOrder'],
            ),
            _HeaderCell(
              width: _kFrontColumnWidth,
              label: 'Front',
              alignment: Alignment.center,
              isSortable: false,
              sortKey: '',
              activeSortKey: sortKey,
              ascending: ascending,
              onSort: onSort,
            ),
          ],
        ),
      ),
    );
  }
}

class _TableHeader extends StatelessWidget {
  const _TableHeader({
    required this.sortKey,
    required this.ascending,
    required this.onSort,
    required this.columnWidths,
    required this.draggingColumns,
    required this.headerFocusNodes,
  });

  final String sortKey;
  final bool ascending;
  final ValueChanged<String> onSort;
  final _TableColumnWidths columnWidths;
  final bool draggingColumns;
  final Map<String, FocusNode> headerFocusNodes;

  @override
  Widget build(BuildContext context) {
    // The header doubles as a handle for panning the columns: it keeps the
    // normal cursor on hover and only shows the drag hand while panning. Sort
    // buttons sit deeper and keep their own click cursor.
    return MouseRegion(
      key: const ValueKey('tableHeader'),
      cursor: draggingColumns ? _draggingCursor : MouseCursor.defer,
      child: ColoredBox(
        color: _kTableHeaderBg,
        child: Padding(
          padding: const EdgeInsets.only(right: _kTableHorizontalPadding),
          child: Row(
            children: [
              _HeaderCell(
                width: columnWidths.denomination,
                label: 'Denomination',
                alignment: Alignment.centerLeft,
                sortKey: 'denomination',
                activeSortKey: sortKey,
                ascending: ascending,
                onSort: onSort,
                focusNode: headerFocusNodes['denomination'],
              ),
              _HeaderCell(
                width: columnWidths.issueDate,
                label: 'Date',
                alignment: Alignment.centerLeft,
                sortKey: 'issueDate',
                activeSortKey: sortKey,
                ascending: ascending,
                onSort: onSort,
                focusNode: headerFocusNodes['issueDate'],
              ),
              _HeaderCell(
                width: columnWidths.catalogNumber,
                label: 'Catalog #',
                alignment: Alignment.centerLeft,
                sortKey: 'catalogNumber',
                activeSortKey: sortKey,
                ascending: ascending,
                onSort: onSort,
                focusNode: headerFocusNodes['catalogNumber'],
              ),
              _HeaderCell(
                width: columnWidths.gradingCompany,
                label: 'Company',
                alignment: Alignment.centerLeft,
                sortKey: 'gradingCompany',
                activeSortKey: sortKey,
                ascending: ascending,
                onSort: onSort,
                focusNode: headerFocusNodes['gradingCompany'],
              ),
              _HeaderCell(
                width: columnWidths.grade,
                label: 'Grade',
                alignment: Alignment.centerLeft,
                sortKey: 'grade',
                activeSortKey: sortKey,
                ascending: ascending,
                onSort: onSort,
                focusNode: headerFocusNodes['grade'],
              ),
              _HeaderCell(
                width: columnWidths.serial,
                label: 'Serial',
                alignment: Alignment.centerLeft,
                sortKey: 'serial',
                activeSortKey: sortKey,
                ascending: ascending,
                onSort: onSort,
                focusNode: headerFocusNodes['serial'],
              ),
              _HeaderCell(
                width: columnWidths.tags,
                label: 'Tags',
                alignment: Alignment.centerLeft,
                sortKey: 'tags',
                activeSortKey: sortKey,
                ascending: ascending,
                onSort: onSort,
                focusNode: headerFocusNodes['tags'],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeaderCell extends StatelessWidget {
  const _HeaderCell({
    required this.width,
    required this.label,
    required this.alignment,
    required this.sortKey,
    required this.activeSortKey,
    required this.ascending,
    required this.onSort,
    this.isSortable = true,
    this.semanticLabel,
    this.tooltip,
    this.focusNode,
  });

  final double width;
  final String label;
  final AlignmentGeometry alignment;
  final String sortKey;
  final String activeSortKey;
  final bool ascending;
  final ValueChanged<String> onSort;
  final bool isSortable;
  final String? semanticLabel;
  final String? tooltip;
  final FocusNode? focusNode;

  static const double _kIndicatorSize = 14;
  static const double _kIndicatorGap = 4;
  static const EdgeInsets _kCellPadding = EdgeInsets.symmetric(horizontal: 12);

  // The sort button carries 6px of its own padding for the hover wash, so the
  // cell gives back 6px; the label then lands on the same 12px line as the
  // data cells instead of floating 6px inside them.
  static const EdgeInsets _kSortableCellPadding = EdgeInsets.symmetric(
    horizontal: 6,
  );

  @override
  Widget build(BuildContext context) {
    final cellKey = ValueKey(
      'tableHeaderCell-${sortKey.isEmpty ? label.toLowerCase() : sortKey}',
    );

    if (!isSortable) {
      return SizedBox(
        key: cellKey,
        width: width,
        child: Padding(
          padding: _kCellPadding,
          child: Align(
            alignment: alignment,
            child: Text(
              label.toUpperCase(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: _kHeaderLabelTextStyle.copyWith(
                color: ViewerPalette.textMuted,
              ),
            ),
          ),
        ),
      );
    }

    final node = focusNode!;
    final accessibleName = semanticLabel ?? label;
    final active = sortKey == activeSortKey;

    return SizedBox(
      key: cellKey,
      width: width,
      child: Padding(
        padding: _kSortableCellPadding,
        child: Align(
          alignment: alignment,
          child: AnimatedBuilder(
            animation: node,
            builder: (context, _) {
              final focused = node.hasFocus;
              final labelColor = active || focused
                  ? _kTableSortableHeaderText
                  : ViewerPalette.textMuted;
              final indicator = Icon(
                active
                    ? (ascending
                          ? Icons.arrow_upward_rounded
                          : Icons.arrow_downward_rounded)
                    : Icons.unfold_more_rounded,
                size: _kIndicatorSize,
                color: active
                    ? _kTableSortableHeaderText
                    : focused
                    ? ViewerPalette.accent
                    : ViewerPalette.textFaint.withValues(alpha: 0.5),
              );

              // The indicator always occupies its slot, so the label never
              // shifts when the sort flips. Right-aligned columns put it on
              // the leading side so the label stays flush with the data.
              final leadingIndicator = alignment == Alignment.centerRight;
              final headerLabel = Text(
                label.toUpperCase(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _kHeaderLabelTextStyle.copyWith(color: labelColor),
              );
              final labelText = Flexible(
                child: tooltip == null
                    ? headerLabel
                    : Tooltip(message: tooltip!, child: headerLabel),
              );

              return Semantics(
                container: true,
                button: true,
                excludeSemantics: true,
                label: active
                    ? '$accessibleName, sorted '
                          '${ascending ? 'ascending' : 'descending'}'
                    : '$accessibleName, not sorted',
                onTap: () => onSort(sortKey),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    TextButton(
                      focusNode: node,
                      onPressed: () => onSort(sortKey),
                      style:
                          TextButton.styleFrom(
                            foregroundColor: labelColor,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 4,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(
                                ViewerPalette.radiusChip,
                              ),
                            ),
                          ).copyWith(
                            overlayColor: WidgetStateProperty.resolveWith((
                              states,
                            ) {
                              if (states.contains(WidgetState.focused)) {
                                return Colors.transparent;
                              }
                              if (states.contains(WidgetState.hovered) ||
                                  states.contains(WidgetState.pressed)) {
                                return ViewerPalette.accentSoft;
                              }
                              return null;
                            }),
                          ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (leadingIndicator) ...[
                            indicator,
                            const SizedBox(width: _kIndicatorGap),
                          ],
                          labelText,
                          if (!leadingIndicator) ...[
                            const SizedBox(width: _kIndicatorGap),
                            indicator,
                          ],
                        ],
                      ),
                    ),
                    if (focused)
                      Positioned(
                        left: -4,
                        right: -4,
                        top: -4,
                        bottom: -4,
                        child: IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(
                                ViewerPalette.radiusChip + 4,
                              ),
                              border: Border.all(
                                color: ViewerPalette.accent,
                                width: 2,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Paint-only selection ring shared by grid rows and cards. It is a
/// [Positioned], so painting it never participates in layout: moving the
/// keyboard cursor cannot shift content.
class _SelectionRing extends StatelessWidget {
  const _SelectionRing();

  @override
  Widget build(BuildContext context) {
    return const Positioned.fill(
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.all(
              Radius.circular(ViewerPalette.radiusMd),
            ),
            border: Border.fromBorderSide(
              BorderSide(color: ViewerPalette.accent, width: 1.5),
            ),
          ),
        ),
      ),
    );
  }
}

class _PinnedTableRow extends StatelessWidget {
  const _PinnedTableRow({
    required this.note,
    required this.draggingColumns,
    required this.selected,
    required this.onTap,
    required this.onMenu,
    required this.onCopy,
  });

  final NoteRecord note;
  final bool draggingColumns;
  final bool selected;
  final VoidCallback onTap;

  /// Opens the row's copy menu at [position] on right click or long press.
  final ValueChanged<Offset> onMenu;

  /// Copies [value] and announces it; exposed to assistive tech as a custom
  /// action on the pinned half's semantics node too.
  final void Function(String value, String what) onCopy;

  @override
  Widget build(BuildContext context) {
    final serial = _copyableSerial(note);
    final catalog = _copyableCatalog(note);
    // The pinned half carries the note's identity and its front image; the
    // scrolling half carries the column values. Both halves answer the same
    // tap, so each is announced as a button that opens the note.
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onLongPressStart: (details) => onMenu(details.globalPosition),
      onSecondaryTapDown: (details) => onMenu(details.globalPosition),
      child: Semantics(
        container: true,
        button: true,
        selected: selected,
        label: 'Note ${note.displayOrder}',
        hint: 'Opens this note',
        onTap: onTap,
        customSemanticsActions: {
          if (serial != null)
            const CustomSemanticsAction(label: 'Copy serial'): () =>
                onCopy(serial, 'serial'),
          if (catalog != null)
            const CustomSemanticsAction(label: 'Copy catalog number'): () =>
                onCopy(catalog, 'catalog number'),
        },
        child: InkWell(
          onTap: onTap,
          excludeFromSemantics: true,
          // Rows read as links: a pointing hand at rest, the drag hand only
          // while the table is being panned.
          mouseCursor: draggingColumns
              ? _draggingCursor
              : SystemMouseCursors.click,
          hoverColor: ViewerPalette.accentSoft,
          highlightColor: ViewerPalette.accentSoft,
          // The selection ring is a paint-only overlay: it never participates in
          // layout, so moving keyboard selection cannot shift rows (same idea as
          // the editor's box-shadow focus ring). The pinned pane owns the ring's
          // left half; the scrolling pane draws the rest so the two panes read as
          // one continuous row.
          child: SizedBox(
            height: _kTableRowHeight,
            child: Stack(
              key: ValueKey('pinnedTableRow-${note.id}'),
              children: [
                if (selected)
                  const Positioned.fill(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: ViewerPalette.rowSelected,
                        borderRadius: BorderRadius.horizontal(
                          left: Radius.circular(ViewerPalette.radiusMd),
                        ),
                      ),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.only(
                    left: _kTableHorizontalPadding,
                  ),
                  child: Row(
                    children: [
                      _DataCell(
                        width: _kOrderColumnWidth,
                        alignment: Alignment.centerRight,
                        style: _kIdCellTextStyle,
                        child: ExcludeSemantics(
                          child: Text('${note.displayOrder}'),
                        ),
                      ),
                      _DataCell(
                        width: _kFrontColumnWidth,
                        alignment: Alignment.center,
                        child: _NoteThumbnail(
                          image: note.previewFor('front'),
                          semanticLabel: 'Front image',
                        ),
                      ),
                    ],
                  ),
                ),
                // A quiet chevron keeps the row's "opens" cue visible on touch
                // screens, where a hand cursor cannot appear. It is paint only,
                // so it never takes the row's drag gesture.
                Positioned(
                  top: 0,
                  right: 4,
                  bottom: 0,
                  child: IgnorePointer(
                    child: Center(
                      child: Icon(
                        Icons.chevron_right_rounded,
                        size: 14,
                        color: selected
                            ? ViewerPalette.accent
                            : ViewerPalette.textFaint.withValues(alpha: 0.6),
                      ),
                    ),
                  ),
                ),
                if (selected)
                  const Positioned.fill(
                    child: IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.horizontal(
                            left: Radius.circular(ViewerPalette.radiusMd),
                          ),
                          border: Border(
                            top: BorderSide(
                              color: ViewerPalette.accent,
                              width: 1.5,
                            ),
                            bottom: BorderSide(
                              color: ViewerPalette.accent,
                              width: 1.5,
                            ),
                            left: BorderSide(
                              color: ViewerPalette.accent,
                              width: 1.5,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
class _TableRow extends StatelessWidget {
  const _TableRow({
    required this.note,
    required this.columnWidths,
    required this.draggingColumns,
    required this.onTagTap,
    required this.onTap,
    required this.onMenu,
    required this.onCopy,
    required this.tagFocusNodes,
    required this.onTagTab,
    required this.selected,
  });

  final NoteRecord note;
  final _TableColumnWidths columnWidths;
  final bool draggingColumns;
  final ValueChanged<String> onTagTap;
  final VoidCallback onTap;

  /// Opens the row's copy menu at [position] on right click or long press.
  final ValueChanged<Offset> onMenu;

  /// Copies [value] and announces it; exposed to assistive tech as a custom
  /// action on the row's semantics node.
  final void Function(String value, String what) onCopy;

  /// The row's chip focus stops, in tag order, and the Tab handler that walks
  /// them and leaves the row.
  final List<FocusNode> tagFocusNodes;
  final void Function(int chipIndex, {required bool forward}) onTagTab;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final serial = _copyableSerial(note);
    final catalog = _copyableCatalog(note);
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onLongPressStart: (details) => onMenu(details.globalPosition),
      onSecondaryTapDown: (details) => onMenu(details.globalPosition),
      child: InkWell(
        onTap: onTap,
        excludeFromSemantics: true,
        // Rows read as links: a pointing hand at rest, the drag hand only
        // while the table is being panned.
        mouseCursor: draggingColumns
            ? _draggingCursor
            : SystemMouseCursors.click,
        hoverColor: ViewerPalette.accentSoft,
        highlightColor: ViewerPalette.accentSoft,
        // The selection ring is a paint-only overlay: it never participates in
        // layout, so moving keyboard selection cannot shift rows (same idea as
        // the editor's box-shadow focus ring). The scrolling pane draws the
        // ring's right half; the pinned pane owns the rest.
        child: SizedBox(
          height: _kTableRowHeight,
          child: Stack(
            key: ValueKey('tableRow-${note.id}'),
            children: [
              if (selected)
                const Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: ViewerPalette.rowSelected,
                      borderRadius: BorderRadius.horizontal(
                        right: Radius.circular(ViewerPalette.radiusMd),
                      ),
                    ),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.only(right: _kTableHorizontalPadding),
                child: Row(
                  children: [
                    // One semantics node covers the value columns, so a screen
                    // reader hears the row as a single button instead of one
                    // node per cell. Tag chips stay outside it: each chip is
                    // its own filter button.
                    Semantics(
                      container: true,
                      button: true,
                      selected: selected,
                      label: _noteSummaryLabel(note),
                      hint: 'Opens this note',
                      onTap: onTap,
                      excludeSemantics: true,
                      customSemanticsActions: {
                        if (serial != null)
                          const CustomSemanticsAction(label: 'Copy serial'):
                              () => onCopy(serial, 'serial'),
                        if (catalog != null)
                          const CustomSemanticsAction(
                            label: 'Copy catalog number',
                          ): () => onCopy(catalog, 'catalog number'),
                      },
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _DataCell(
                            width: columnWidths.denomination,
                            emphasized: true,
                            child: _CellValue(note.denomination),
                          ),
                          _DataCell(
                            width: columnWidths.issueDate,
                            child: _CellValue(note.issueDate),
                          ),
                          _DataCell(
                            width: columnWidths.catalogNumber,
                            emphasized: true,
                            child: _CellValue(note.catalogNumber),
                          ),
                          _DataCell(
                            width: columnWidths.gradingCompany,
                            child: _CellValue(note.gradingCompany),
                          ),
                          _DataCell(
                            width: columnWidths.grade,
                            child: _GradePill(grade: note.grade),
                          ),
                          _DataCell(
                            width: columnWidths.serial,
                            style: _kCodeTextStyle,
                            child: _CellValue(note.serial),
                          ),
                        ],
                      ),
                    ),
                    _DataCell(
                      width: columnWidths.tags,
                      child: _NoteTagsCell(
                        tags: note.tags,
                        onTagTap: onTagTap,
                        focusNodes: tagFocusNodes,
                        onTagTab: onTagTab,
                      ),
                    ),
                  ],
                ),
              ),
              if (selected)
                const Positioned.fill(
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.horizontal(
                          right: Radius.circular(ViewerPalette.radiusMd),
                        ),
                        border: Border(
                          top: BorderSide(
                            color: ViewerPalette.accent,
                            width: 1.5,
                          ),
                          bottom: BorderSide(
                            color: ViewerPalette.accent,
                            width: 1.5,
                          ),
                          right: BorderSide(
                            color: ViewerPalette.accent,
                            width: 1.5,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
/// Below the grid breakpoint the notes become a vertical card list: a fixed
/// thumbnail on the left, denomination as the primary line, the remaining
/// columns as labelled metadata, and tags in the card footer. Sorting moves
/// from the column headers into a compact bar; tapping a card opens the same
/// slideshow the rows do.
class _NoteCardList extends StatelessWidget {
  const _NoteCardList({
    required this.notes,
    required this.selectedIndex,
    required this.keyboardNavEnabled,
    required this.sortKey,
    required this.ascending,
    required this.onSortKey,
    required this.onToggleSortDirection,
    required this.onTagTap,
    required this.onOpenNote,
    required this.onMenu,
    required this.onCopy,
    required this.cardKeyFor,
    required this.tagFocusNodesFor,
    required this.onTagTab,
    required this.scrollController,
    required this.sortFocusNode,
    required this.directionFocusNode,
    required this.onScrollNotification,
  });

  final List<NoteRecord> notes;
  final int? selectedIndex;
  final bool keyboardNavEnabled;
  final String sortKey;
  final bool ascending;
  final ValueChanged<String> onSortKey;
  final VoidCallback onToggleSortDirection;
  final ValueChanged<String> onTagTap;
  final ValueChanged<int> onOpenNote;

  /// Opens a card's copy menu at [position] on right click or long press.
  final void Function(int index, Offset position) onMenu;
  final void Function(String value, String what) onCopy;
  final GlobalKey Function(int noteId) cardKeyFor;
  final List<FocusNode> Function(NoteRecord note) tagFocusNodesFor;
  final void Function(NoteRecord note, int chipIndex, {required bool forward})
  onTagTab;
  final ScrollController scrollController;
  final FocusNode sortFocusNode;
  final FocusNode directionFocusNode;
  final NotificationListenerCallback<ScrollNotification> onScrollNotification;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: _kCardTray,
      child: Column(
        children: [
          _CardSortBar(
            sortKey: sortKey,
            ascending: ascending,
            onSortKey: onSortKey,
            onToggleSortDirection: onToggleSortDirection,
            sortFocusNode: sortFocusNode,
            directionFocusNode: directionFocusNode,
          ),
          Expanded(
            child: NotificationListener<ScrollNotification>(
              onNotification: onScrollNotification,
              child: ScrollConfiguration(
                behavior: const _NoInnerScrollbarBehavior(),
                child: Scrollbar(
                  controller: scrollController,
                  thumbVisibility: true,
                  child: ListView.builder(
                    key: const ValueKey('noteCardList'),
                    controller: scrollController,
                    padding: const EdgeInsets.fromLTRB(10, 10, 10, 6),
                    itemCount: notes.length,
                    itemBuilder: (context, index) {
                      final note = notes[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _NoteCard(
                          key: cardKeyFor(note.id),
                          note: note,
                          selected:
                              keyboardNavEnabled && selectedIndex == index,
                          onTagTap: onTagTap,
                          onTap: () => onOpenNote(index),
                          onMenu: (position) => onMenu(index, position),
                          onCopy: onCopy,
                          tagFocusNodes: tagFocusNodesFor(note),
                          onTagTab: (chipIndex, {required forward}) =>
                              onTagTab(note, chipIndex, forward: forward),
                        ),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Card mode's sorting affordance: the field in a select, the direction in
/// the arrow button beside it. It takes the place of the grid's header row.
class _CardSortBar extends StatelessWidget {
  const _CardSortBar({
    required this.sortKey,
    required this.ascending,
    required this.onSortKey,
    required this.onToggleSortDirection,
    required this.sortFocusNode,
    required this.directionFocusNode,
  });

  static const List<({String value, String label})> _sortOptions =
      _kSortableColumns;

  final String sortKey;
  final bool ascending;
  final ValueChanged<String> onSortKey;
  final VoidCallback onToggleSortDirection;
  final FocusNode sortFocusNode;
  final FocusNode directionFocusNode;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: _kTableHeaderBg,
        border: Border(bottom: BorderSide(color: _kTableDivider)),
      ),
      padding: const EdgeInsets.fromLTRB(12, 2, 8, 2),
      child: Row(
        children: [
          const Text(
            'SORT',
            style: TextStyle(
              fontFamily: 'Inter',
              fontWeight: FontWeight.w700,
              fontSize: 11,
              letterSpacing: 0.9,
              height: 1,
              color: ViewerPalette.textMuted,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                key: const ValueKey('cardSortKey'),
                value: sortKey,
                focusNode: sortFocusNode,
                isExpanded: true,
                isDense: true,
                focusColor: ViewerPalette.accentSoft,
                borderRadius: BorderRadius.zero,
                padding: EdgeInsets.zero,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  color: _kTableText,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
                selectedItemBuilder: (context) => [
                  for (final option in _sortOptions)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        option.label,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                items: [
                  for (final option in _sortOptions)
                    DropdownMenuItem<String>(
                      value: option.value,
                      child: Text(option.label),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) {
                    onSortKey(value);
                  }
                },
              ),
            ),
          ),
          const SizedBox(width: 4),
          IconButton(
            key: const ValueKey('cardSortDirection'),
            focusNode: directionFocusNode,
            tooltip: ascending ? 'Sort descending' : 'Sort ascending',
            onPressed: onToggleSortDirection,
            iconSize: 18,
            padding: const EdgeInsets.all(7),
            constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
            style: IconButton.styleFrom(
              foregroundColor: ViewerPalette.accent,
              hoverColor: ViewerPalette.accentSoft,
              focusColor: ViewerPalette.accentSoft,
              highlightColor: ViewerPalette.accentSoft,
            ),
            icon: Icon(
              ascending
                  ? Icons.arrow_upward_rounded
                  : Icons.arrow_downward_rounded,
            ),
          ),
        ],
      ),
    );
  }
}

/// One note as a catalogue plate. The image is mounted on a quiet mat, the
/// denomination is the plate's title, and the catalogue number, date, company,
/// grade, and serial read as a single spec line. Tags keep their filter action
/// on a footer behind a hairline. Tapping the plate opens the slideshow.
class _NoteCard extends StatelessWidget {
  const _NoteCard({
    required this.note,
    required this.selected,
    required this.onTagTap,
    required this.onTap,
    required this.onMenu,
    required this.onCopy,
    required this.tagFocusNodes,
    required this.onTagTab,
    super.key,
  });

  final NoteRecord note;
  final bool selected;
  final ValueChanged<String> onTagTap;
  final VoidCallback onTap;
  final ValueChanged<Offset> onMenu;
  final void Function(String value, String what) onCopy;
  final List<FocusNode> tagFocusNodes;
  final void Function(int chipIndex, {required bool forward}) onTagTab;

  @override
  Widget build(BuildContext context) {
    final front = note.previewFor('front');
    final back = note.previewFor('back');
    final tagNames = _tagNames(note.tags);
    final title = note.denomination.trim().isEmpty
        ? 'Untitled note'
        : note.denomination;
    final textScale = MediaQuery.textScalerOf(context).scale(16) / 16;
    final serial = _copyableSerial(note);
    final catalog = _copyableCatalog(note);

    return Semantics(
      button: true,
      selected: selected,
      label: _noteSummaryLabel(note),
      hint: 'Opens this note',
      onTap: onTap,
      customSemanticsActions: {
        if (serial != null)
          const CustomSemanticsAction(label: 'Copy serial'): () =>
              onCopy(serial, 'serial'),
        if (catalog != null)
          const CustomSemanticsAction(label: 'Copy catalog number'): () =>
              onCopy(catalog, 'catalog number'),
      },
      child: InkWell(
        onTap: onTap,
        excludeFromSemantics: true,
        onSecondaryTapDown: (details) => onMenu(details.globalPosition),
        onLongPress: () {
          final box = context.findRenderObject() as RenderBox?;
          if (box == null) {
            return;
          }
          onMenu(box.localToGlobal(box.size.center(Offset.zero)));
        },
        hoverColor: ViewerPalette.accentSoft,
        highlightColor: ViewerPalette.accentSoft,
        child: Stack(
          key: ValueKey('noteCard-${note.id}'),
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: selected ? ViewerPalette.rowSelected : _kTableSurface,
                borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
                border: Border.all(color: ViewerPalette.border),
              ),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final compact =
                      constraints.maxWidth < _kCardCompactBreakpoint ||
                      textScale > 1.3;
                  final imageWidth = compact
                      ? _kCardCompactImageWidth
                      : _kCardImageWidth;
                  final imageHeight = compact
                      ? _kCardCompactImageHeight
                      : _kCardImageHeight;

                  return Padding(
                    padding: EdgeInsets.fromLTRB(
                      compact ? 10 : 12,
                      compact ? 10 : 12,
                      8,
                      compact ? 10 : 12,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _NotePlate(
                              front: front,
                              back: back,
                              width: imageWidth,
                              height: imageHeight,
                              selected: selected,
                            ),
                            SizedBox(width: compact ? 10 : 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  _CardTopLine(note: note, compact: compact),
                                  SizedBox(height: compact ? 3 : 4),
                                  Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.baseline,
                                    textBaseline: TextBaseline.alphabetic,
                                    children: [
                                      Expanded(
                                        flex: 3,
                                        child: Text(
                                          title,
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            fontFamily: 'Inter',
                                            color: _kTableText,
                                            fontSize: compact ? 18 : 20,
                                            fontWeight: FontWeight.w800,
                                            height: 1.12,
                                            letterSpacing: -0.3,
                                          ),
                                        ),
                                      ),
                                      if (compact) ...[
                                        const SizedBox(width: 8),
                                        Flexible(
                                          child: Text(
                                            _valueOrDash(note.issueDate),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            textAlign: TextAlign.right,
                                            style: _kCardMetaTextStyle.copyWith(
                                              fontSize: 11,
                                              fontFeatures: const [
                                                FontFeature.tabularFigures(),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  SizedBox(height: compact ? 5 : 6),
                                  _CardSpecLine(note: note),
                                ],
                              ),
                            ),
                            const SizedBox(width: 4),
                            Padding(
                              padding: EdgeInsets.only(top: compact ? 2 : 4),
                              child: Icon(
                                Icons.chevron_right_rounded,
                                size: compact ? 16 : 18,
                                color: selected
                                    ? ViewerPalette.accent
                                    : ViewerPalette.textFaint,
                              ),
                            ),
                          ],
                        ),
                        // The footer runs the card's full width, so its rule and
                        // its chips start under the plate instead of waiting
                        // for the text column. A full-width run packs the tags
                        // into fewer rows on a phone.
                        if (tagNames.isNotEmpty) ...[
                          SizedBox(height: compact ? 6 : 8),
                          Container(height: 1, color: _kTableDivider),
                          SizedBox(height: compact ? 6 : 8),
                          Wrap(
                            spacing: _kTagChipHorizontalGap,
                            runSpacing: _kCardTagRunSpacing,
                            children: [
                              for (final (index, tagName)
                                  in tagNames.indexed)
                                _TagChip(
                                  label: tagName,
                                  multiline: true,
                                  minTargetHeight: _kCardTagChipMinHeight,
                                  focusNode: tagFocusNodes[index],
                                  onTap: () => onTagTap(tagName),
                                  onTab: ({required bool forward}) =>
                                      onTagTab(index, forward: forward),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
            // Paint-only selection ring, so selecting a card cannot shift it
            // (same idea as the grid rows and the Editor's focus ring).
            if (selected) const _SelectionRing(),
          ],
        ),
      ),
    );
  }
}

/// The card's top line: the collection position, the catalogue number, and the
/// issue date. `No.` is quiet; the catalogue number keeps the ink because it is
/// the identifier a collector scans first.
class _CardTopLine extends StatelessWidget {
  const _CardTopLine({required this.note, required this.compact});

  final NoteRecord note;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          'No. ${note.displayOrder}',
          style: TextStyle(
            fontFamily: 'Inter',
            color: ViewerPalette.textFaint,
            fontSize: compact ? 9.5 : 10.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.04,
            height: 1,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _LabeledValue(
            label: 'CAT',
            value: _valueOrDash(note.catalogNumber),
          ),
        ),
        if (!compact) ...[
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              _valueOrDash(note.issueDate),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.right,
              style: _kCardMetaTextStyle.copyWith(
                fontSize: 12,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

/// The card's spec line: company, the banded grade pill, and the serial in the
/// code role. It wraps on narrow cards and at large text scales.
class _CardSpecLine extends StatelessWidget {
  const _CardSpecLine({required this.note});

  final NoteRecord note;

  @override
  Widget build(BuildContext context) {
    final company = note.gradingCompany.trim();

    return LayoutBuilder(
      builder: (context, constraints) {
        return Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (company.isNotEmpty) Text(company, style: _kCardMetaTextStyle),
            _GradePill(grade: note.grade),
            ConstrainedBox(
              constraints: BoxConstraints(maxWidth: constraints.maxWidth),
              child: Text(
                'S/N ${_valueOrDash(note.serial)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: _kCodeTextStyle,
              ),
            ),
          ],
        );
      },
    );
  }
}

/// A small label and value on one line, used for `CAT` and the collection
/// position. The label stays quiet; the value carries the ink.
class _LabeledValue extends StatelessWidget {
  const _LabeledValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: '$label ', style: _kCardLabelTextStyle),
          TextSpan(
            text: value,
            style: const TextStyle(
              fontFamily: 'Inter',
              color: _kTableText,
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              height: 1.2,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// The catalogue grade bands used by the Editor table: uncirculated (65+),
/// choice (50-64), and circulated below that. An unreadable grade reads as a
/// neutral pill, not as a second accent.
enum _GradeTier { uncirculated, choice, circulated, none }

_GradeTier _gradeTier(String value) {
  final match = RegExp(r'\d+(?:\.\d+)?').firstMatch(value);
  final numeric = match == null ? null : double.tryParse(match.group(0)!);
  if (numeric == null) {
    return _GradeTier.none;
  }
  if (numeric >= 65) {
    return _GradeTier.uncirculated;
  }
  return numeric >= 50 ? _GradeTier.choice : _GradeTier.circulated;
}

class _GradePill extends StatelessWidget {
  const _GradePill({required this.grade});

  final String grade;

  @override
  Widget build(BuildContext context) {
    final text = grade.trim();
    if (text.isEmpty) {
      return _kDashText;
    }

    final (background, foreground, border) = switch (_gradeTier(text)) {
      _GradeTier.uncirculated => (
        ViewerPalette.successSoft,
        ViewerPalette.success,
        const Color(0x3D31A24C),
      ),
      _GradeTier.choice => (
        ViewerPalette.warningSoft,
        ViewerPalette.warning,
        const Color(0x4DF7B928),
      ),
      _GradeTier.circulated || _GradeTier.none => (
        ViewerPalette.surfaceMist,
        ViewerPalette.textMuted,
        ViewerPalette.borderSoft,
      ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(ViewerPalette.radiusPill),
        border: Border.all(color: border),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontFamily: 'Inter',
          color: foreground,
          fontSize: 13,
          fontWeight: FontWeight.w600,
          height: 1.2,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

/// The note image mounted on its mat. The front is shown whole with
/// `BoxFit.contain`, and the reverse peeks out from the corner when the archive
/// has one, so the plate reads as a note with two sides rather than a photo
/// crop.
class _NotePlate extends StatelessWidget {
  const _NotePlate({
    required this.front,
    required this.back,
    required this.width,
    required this.height,
    required this.selected,
  });

  final NoteImage? front;
  final NoteImage? back;
  final double width;
  final double height;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final frontImage = front;
    final backImage = back;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          width: width,
          height: height,
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: _kTableThumbnailPlaceholderBg,
            borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
            border: Border.all(
              color: selected ? ViewerPalette.accent : ViewerPalette.borderSoft,
            ),
          ),
          child: frontImage == null
              ? const Center(
                  child: Icon(
                    Icons.image_outlined,
                    size: 20,
                    color: _kTableThumbnailPlaceholderIcon,
                  ),
                )
              : ClipRRect(
                  borderRadius: BorderRadius.circular(2),
                  child: Image(
                    image: createNoteImageProvider(frontImage),
                    width: width,
                    height: height,
                    fit: BoxFit.contain,
                    semanticLabel: 'Front image',
                    frameBuilder:
                        (context, child, frame, wasSynchronouslyLoaded) {
                          if (wasSynchronouslyLoaded || frame != null) {
                            return child;
                          }
                          return const Center(
                            child: Icon(
                              Icons.image_outlined,
                              size: 20,
                              color: _kTableThumbnailPlaceholderIcon,
                            ),
                          );
                        },
                    errorBuilder: (context, error, stackTrace) => const Center(
                      child: Icon(
                        Icons.image_outlined,
                        size: 20,
                        color: _kTableThumbnailPlaceholderIcon,
                      ),
                    ),
                  ),
                ),
        ),
        if (backImage != null)
          Positioned(
            right: -3,
            bottom: -3,
            child: Container(
              width: (width * 0.3).clamp(20.0, 38.0),
              height: (height * 0.3).clamp(12.0, 22.0),
              padding: const EdgeInsets.all(1),
              decoration: BoxDecoration(
                color: ViewerPalette.surface,
                borderRadius: BorderRadius.circular(3),
                border: Border.all(color: ViewerPalette.border),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: Image(
                  image: createNoteImageProvider(backImage),
                  fit: BoxFit.cover,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

String _valueOrDash(String value) => value.trim().isEmpty ? '-' : value;

/// The header and footer share one count phrase: the plain total when nothing
/// is filtered, and `visible of total` while a filter is narrowing the set.
String _notesCountLabel(int visibleCount, int totalCount) {
  if (visibleCount == totalCount) {
    return totalCount == 1 ? '1 note' : '$totalCount notes';
  }
  return '$visibleCount of $totalCount';
}

class _NoteThumbnail extends StatelessWidget {
  const _NoteThumbnail({required this.image, required this.semanticLabel});

  final NoteImage? image;

  /// What a screen reader says for the frame. The row still owns the button
  /// label; this only names the picture inside it.
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    final image = this.image;
    if (image == null) {
      return Semantics(
        image: true,
        label: semanticLabel,
        child: const _TableThumbnailPlaceholder(),
      );
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(ViewerPalette.radiusXs),
        border: Border.all(color: ViewerPalette.borderControl),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(ViewerPalette.radiusXs),
        child: Image(
          image: createNoteImageProvider(image),
          width: _kTableThumbnailWidth,
          height: _kTableThumbnailHeight,
          fit: BoxFit.cover,
          semanticLabel: semanticLabel,
          frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
            if (wasSynchronouslyLoaded || frame != null) {
              return child;
            }
            return const _TableThumbnailPlaceholder();
          },
          errorBuilder: (context, error, stackTrace) =>
              const _TableThumbnailPlaceholder(),
        ),
      ),
    );
  }
}

class _TableThumbnailPlaceholder extends StatelessWidget {
  const _TableThumbnailPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: _kTableThumbnailWidth,
      height: _kTableThumbnailHeight,
      decoration: BoxDecoration(
        color: _kTableThumbnailPlaceholderBg,
        borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
        border: Border.all(color: _kTableThumbnailPlaceholderBorder),
      ),
      child: const Center(
        child: Icon(
          Icons.image_outlined,
          size: 14,
          color: _kTableThumbnailPlaceholderIcon,
        ),
      ),
    );
  }
}

class _NoteTagsCell extends StatelessWidget {
  const _NoteTagsCell({
    required this.tags,
    required this.onTagTap,
    required this.focusNodes,
    required this.onTagTab,
  });

  final List<Tag> tags;
  final ValueChanged<String> onTagTap;
  final List<FocusNode> focusNodes;
  final void Function(int chipIndex, {required bool forward}) onTagTab;

  @override
  Widget build(BuildContext context) {
    final tagNames = _tagNames(tags);

    if (tagNames.isEmpty) {
      return _kDashText;
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final plan = _planTagRow(
          tagNames,
          constraints.maxWidth,
          MediaQuery.textScalerOf(context),
        );

        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var index = 0; index < plan.visible; index++) ...[
              if (index > 0) const SizedBox(width: _kTagChipHorizontalGap),
              _TagChip(
                label: tagNames[index],
                focusNode: focusNodes[index],
                onTap: () => onTagTap(tagNames[index]),
                onTab: ({required bool forward}) =>
                    onTagTab(index, forward: forward),
              ),
            ],
            if (plan.hidden > 0) ...[
              if (plan.visible > 0)
                const SizedBox(width: _kTagChipHorizontalGap),
              _TagOverflowChip(
                hiddenTags: tagNames.sublist(plan.visible),
                onTagTap: onTagTap,
              ),
            ],
          ],
        );
      },
    );
  }
}
/// The dashed Ochre ghost that closes a tag run too long for the column. It is
/// an affordance, not a tag: opening it lists the tags that did not fit, and
/// picking one applies the same filter a chip tap does.
class _TagOverflowChip extends StatelessWidget {
  const _TagOverflowChip({required this.hiddenTags, required this.onTagTap});

  final List<String> hiddenTags;
  final ValueChanged<String> onTagTap;

  @override
  Widget build(BuildContext context) {
    final label = '+${hiddenTags.length} more';

    return PopupMenuButton<String>(
      tooltip: '${hiddenTags.length} more tags',
      position: PopupMenuPosition.under,
      onSelected: onTagTap,
      itemBuilder: (context) => [
        for (final tag in hiddenTags)
          PopupMenuItem<String>(
            value: tag,
            height: 36,
            child: Text(tag, style: _kTagChipTextStyle),
          ),
      ],
      child: CustomPaint(
        key: const ValueKey('tagOverflowChip'),
        painter: const _DashedChipBorderPainter(
          color: ViewerPalette.tagTextMuted,
          radius: ViewerPalette.radiusChip,
        ),
        child: Padding(
          padding: _kTagChipPadding,
          child: Text(
            label,
            maxLines: 1,
            style: _kTagChipTextStyle.copyWith(
              color: ViewerPalette.tagTextMuted,
            ),
          ),
        ),
      ),
    );
  }
}

class _DashedChipBorderPainter extends CustomPainter {
  const _DashedChipBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(radius),
    );
    const dashWidth = 5.0;
    const dashGap = 3.0;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    final path = Path()..addRRect(rrect);
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        final end = (distance + dashWidth).clamp(0.0, metric.length);
        canvas.drawPath(metric.extractPath(distance, end), paint);
        distance += dashWidth + dashGap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedChipBorderPainter oldDelegate) {
    return oldDelegate.color != color || oldDelegate.radius != radius;
  }
}

class _TagChip extends StatefulWidget {
  const _TagChip({
    required this.label,
    required this.onTap,
    required this.focusNode,
    required this.onTab,
    this.multiline = false,
    this.minTargetHeight = _kTagChipMinTargetSize,
  });

  final String label;
  final VoidCallback onTap;

  /// Owned by the table so its explicit Tab chain can enter the row's chips
  /// and leave them again.
  final FocusNode focusNode;

  /// Called for Tab (forward) and Shift+Tab (backward), so the chip takes part
  /// in the table's filter -> headers -> rows -> chips order.
  final void Function({required bool forward}) onTab;

  /// Card mode lets a long tag wrap inside the chip instead of running past
  /// the card edge. Grid chips are measured to fit their column.
  final bool multiline;

  /// Vertical tap and focus target. Card footers pass a shorter one to keep
  /// their runs close together; grid cells keep the 44 pt default.
  final double minTargetHeight;

  @override
  State<_TagChip> createState() => _TagChipState();
}

class _TagChipState extends State<_TagChip> {
  bool _hovered = false;

  /// Enter and Space filter by the tag, matching a real button. The table's
  /// row shortcuts only fire when the table itself holds focus, so a focused
  /// chip keeps these keys.
  KeyEventResult _handleKey(KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    // A held Enter or Space must not re-apply the filter on every repeat.
    if (event is KeyDownEvent &&
        (key == LogicalKeyboardKey.enter ||
            key == LogicalKeyboardKey.numpadEnter ||
            key == LogicalKeyboardKey.space)) {
      widget.onTap();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.tab &&
        !HardwareKeyboard.instance.isControlPressed &&
        !HardwareKeyboard.instance.isMetaPressed &&
        !HardwareKeyboard.instance.isAltPressed) {
      widget.onTab(forward: !HardwareKeyboard.instance.isShiftPressed);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _activate() {
    widget.focusNode.requestFocus();
    widget.onTap();
  }

  @override
  Widget build(BuildContext context) {
    final focused = widget.focusNode.hasFocus;

    return Semantics(
      container: true,
      button: true,
      label: 'Filter by tag ${widget.label}',
      onTap: widget.onTap,
      excludeSemantics: true,
      child: Focus(
        focusNode: widget.focusNode,
        onFocusChange: (_) {
          if (mounted) {
            setState(() {});
          }
        },
        onKeyEvent: (_, event) => _handleKey(event),
        child: MouseRegion(
          cursor: SystemMouseCursors.click,
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() => _hovered = false),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _activate,
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minWidth: _kTagChipMinTargetSize,
                minHeight: widget.minTargetHeight,
              ),
              // `widthFactor` keeps the chip as wide as its pill: a bare
              // `Center` fills the whole run width inside a `Wrap`, which
              // gave every tag a row of its own in card mode. Left-aligning
              // the pill keeps a run's first chip flush with the run start,
              // even when its 44 pt target is wider than the label.
              child: Align(
                alignment: Alignment.centerLeft,
                widthFactor: 1,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      curve: Curves.easeOut,
                      decoration: BoxDecoration(
                        color: _hovered
                            ? ViewerPalette.tagBackgroundHover
                            : _kTagChipBg,
                        borderRadius: BorderRadius.circular(
                          ViewerPalette.radiusChip,
                        ),
                        border: Border.all(
                          color: _hovered
                              ? ViewerPalette.tagBorderHover
                              : _kTagChipBorder,
                        ),
                      ),
                      padding: _kTagChipPadding,
                      child: Text(
                        widget.label,
                        maxLines: widget.multiline ? null : 1,
                        overflow: widget.multiline
                            ? TextOverflow.clip
                            : TextOverflow.visible,
                        softWrap: widget.multiline,
                        style: _kTagChipTextStyle,
                      ),
                    ),
                    // The 2 px ring sits outside the pill on the same pattern
                    // as the headers and the collection title. It is paint
                    // only, so focusing cannot change the chip's size.
                    if (focused)
                      Positioned.fill(
                        left: -4,
                        top: -4,
                        right: -4,
                        bottom: -4,
                        child: IgnorePointer(
                          child: DecoratedBox(
                            key: const ValueKey('tagChipFocusRing'),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(
                                ViewerPalette.radiusChip + 4,
                              ),
                              border: Border.all(
                                color: ViewerPalette.accent,
                                width: 2,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
class _DataCell extends StatelessWidget {
  const _DataCell({
    required this.width,
    required this.child,
    this.alignment = Alignment.centerLeft,
    this.emphasized = false,
    this.style,
  });

  final double width;
  final Widget child;
  final AlignmentGeometry alignment;
  final bool emphasized;

  /// Optional role override: ID is Body Faint, Serial is Code. Null keeps the
  /// default Data role.
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final baseStyle = style ?? _kDataCellTextStyle;

    return SizedBox(
      width: width,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Align(
          alignment: alignment,
          child: DefaultTextStyle.merge(
            style: emphasized
                ? baseStyle.copyWith(fontWeight: FontWeight.w600)
                : baseStyle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            child: child,
          ),
        ),
      ),
    );
  }
}

/// A text cell that renders the shared muted dash when the value is empty.
class _CellValue extends StatelessWidget {
  const _CellValue(this.value);

  final String value;

  @override
  Widget build(BuildContext context) {
    return value.trim().isEmpty ? _kDashText : Text(value);
  }
}

/// A quiet fade at the right edge of the scrolling pane while columns remain
/// beyond it. It sits outside the horizontal scroller so it stays at the card
/// edge however far the columns have panned.
class _ColumnsEdgeFade extends StatelessWidget {
  const _ColumnsEdgeFade({required this.controller, required this.overflow});

  final ScrollController controller;
  final bool overflow;

  @override
  Widget build(BuildContext context) {
    if (!overflow) {
      return const SizedBox.shrink();
    }
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final position = controller.hasClients ? controller.position : null;
        final atEnd =
            position != null &&
            position.hasContentDimensions &&
            position.pixels >= position.maxScrollExtent - 0.5;
        if (atEnd) {
          return const SizedBox.shrink();
        }
        return IgnorePointer(
          child: DecoratedBox(
            key: const ValueKey('tableColumnsFade'),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
                colors: [_kTableSurface.withValues(alpha: 0), _kTableSurface],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The table's meta line: how many notes the current filter leaves, which
/// column sorts them, and the pan pair when the columns overflow. The
/// horizontal scrollbar stays hidden; this line is the pan affordance.
class _TableFooter extends StatelessWidget {
  const _TableFooter({
    required this.visibleCount,
    required this.totalCount,
    required this.sortKey,
    required this.ascending,
    required this.showPanHint,
  });

  final int visibleCount;
  final int totalCount;
  final String sortKey;
  final bool ascending;
  final bool showPanHint;

  @override
  Widget build(BuildContext context) {
    const metaStyle = TextStyle(
      fontFamily: 'Inter',
      fontSize: 12,
      color: ViewerPalette.textFaint,
      fontFeatures: [FontFeature.tabularFigures()],
    );
    final countLabel = _notesCountLabel(visibleCount, totalCount);
    final sortLabel = _kColumnLabels[sortKey] ?? sortKey;

    return Container(
      key: const ValueKey('tableFooter'),
      height: _kTableFooterHeight,
      padding: const EdgeInsets.symmetric(horizontal: _kTableHorizontalPadding),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: _kTableDivider)),
      ),
      child: Row(
        children: [
          Flexible(
            child: Text(
              '$countLabel · Sorted by $sortLabel ${ascending ? '↑' : '↓'}',
              key: const ValueKey('tableResultSummary'),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: metaStyle,
            ),
          ),
          if (showPanHint) ...[
            const SizedBox(width: 12),
            const Text(
              '← → pan',
              key: ValueKey('tablePanHint'),
              style: metaStyle,
            ),
          ],
        ],
      ),
    );
  }
}

class _TableEmptyState extends StatelessWidget {
  const _TableEmptyState({
    required this.filtered,
    required this.collectionName,
    required this.onClearFilter,
    required this.onImport,
  });

  /// True when the collection has notes but the active filter hides them all;
  /// false when the collection itself has nothing to show yet.
  final bool filtered;
  final String collectionName;
  final VoidCallback onClearFilter;
  final VoidCallback? onImport;

  @override
  Widget build(BuildContext context) {
    final title = filtered
        ? 'No notes match this filter'
        : 'This collection is empty';
    final detail = filtered
        ? 'Try a different search, or clear the filter to see everything.'
        : 'Notes in "$collectionName" will appear here once they are imported.';

    return _StateCopy(
      key: const ValueKey('tableEmptyState'),
      icon: filtered
          ? Icons.search_off_rounded
          : Icons.collections_bookmark_outlined,
      title: title,
      detail: detail,
      action: filtered
          ? OutlinedButton.icon(
              key: const ValueKey('emptyStateClearFilter'),
              onPressed: onClearFilter,
              icon: const Icon(Icons.close_rounded, size: 16),
              label: const Text('Clear filter'),
            )
          : onImport == null
          ? null
          : FilledButton.icon(
              key: const ValueKey('emptyStateImport'),
              onPressed: onImport,
              icon: const Icon(Icons.file_upload_outlined, size: 16),
              label: const Text('Import notes'),
            ),
    );
  }
}

/// The shared state body: icon plate, named title, detail and reassurance
/// lines, and one action. It centres when it fits and scrolls at large text
/// scales or short windows, so the copy is never clipped.
class _StateCopy extends StatelessWidget {
  const _StateCopy({
    required this.icon,
    required this.title,
    required this.detail,
    this.reassurance,
    this.action,
    this.liveRegion = false,
    super.key,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String? reassurance;
  final Widget? action;
  final bool liveRegion;

  @override
  Widget build(BuildContext context) {
    final copy = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: ViewerPalette.surfaceContainer,
            borderRadius: BorderRadius.circular(ViewerPalette.radiusLg),
            border: Border.all(color: ViewerPalette.border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Icon(icon, size: 28, color: ViewerPalette.textMuted),
          ),
        ),
        const SizedBox(height: 16),
        Text(title, textAlign: TextAlign.center, style: _kStateTitleTextStyle),
        const SizedBox(height: 6),
        Text(
          detail,
          textAlign: TextAlign.center,
          style: _kStateDetailTextStyle,
        ),
        if (reassurance != null) ...[
          const SizedBox(height: 4),
          Text(
            reassurance!,
            textAlign: TextAlign.center,
            style: _kStateDetailTextStyle,
          ),
        ],
      ],
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    liveRegion
                        ? Semantics(
                            liveRegion: true,
                            container: true,
                            child: copy,
                          )
                        : copy,
                    if (action != null) ...[
                      const SizedBox(height: 16),
                      action!,
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// DESIGN's in-card loading, load-error, and no-dataset states. Each replaces
/// the table in the same white card shell: a quiet icon plate, a named title,
/// one detail line, and at most one primary recovery pill.
class _TableStateCard extends StatelessWidget {
  const _TableStateCard({
    required this.icon,
    required this.title,
    required this.detail,
    this.reassurance,
    this.action,
    this.liveRegion = false,
    super.key,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String? reassurance;
  final Widget? action;

  /// Only the copy block is a live region, so the action is not announced
  /// twice when the state changes.
  final bool liveRegion;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: _kTableSurface,
          borderRadius: BorderRadius.circular(_kCardRadius),
          border: Border.all(color: _kTableBorder),
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: _StateCopy(
              icon: icon,
              title: title,
              detail: detail,
              reassurance: reassurance,
              action: action,
              liveRegion: liveRegion,
            ),
          ),
        ),
      ),
    );
  }
}
