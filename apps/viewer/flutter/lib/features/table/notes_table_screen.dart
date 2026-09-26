import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import '../../app/viewer_palette.dart';
import '../../data/dataset_controller.dart';
import '../../models/note_record.dart';
import '../../models/tag.dart';
import '../../widgets/note_image_provider.dart';
import '../import/import_dataset_screen.dart';
import '../slideshow/note_slideshow_screen.dart';

const double _kOrderColumnWidth = 90;
const double _kFrontColumnWidth = 120;
const double _kDenominationColumnWidth = 190;
const double _kDateColumnWidth = 120;
const double _kCatalogColumnWidth = 130;
const double _kCompanyColumnWidth = 120;
const double _kGradeColumnWidth = 110;
const double _kSerialColumnWidth = 140;
const double _kDefaultTagsColumnWidth = 160;
const double _kFixedColumnsWidth = _kOrderColumnWidth +
    _kFrontColumnWidth +
    _kDenominationColumnWidth +
    _kDateColumnWidth +
    _kCatalogColumnWidth +
    _kCompanyColumnWidth +
    _kGradeColumnWidth +
    _kSerialColumnWidth;
const double _kTableHorizontalPadding = 14;
const Color _kTableSurface = ViewerPalette.surface;
const Color _kTableBorder = ViewerPalette.border;
const Color _kTableHeaderBg = ViewerPalette.tableHeaderBackground;
const Color _kTableHeaderDivider = ViewerPalette.borderControl;
const Color _kTableDivider = ViewerPalette.borderSoft;
const Color _kTableText = ViewerPalette.text;
const Color _kTableSortableHeaderText = ViewerPalette.accentStrong;
const Color _kTagChipBg = ViewerPalette.tagBackground;
const Color _kTagChipBorder = ViewerPalette.tagBorder;
const Color _kTagChipText = ViewerPalette.tagText;
const double _kHeaderBadgeHeight = 48;
const double _kTagChipHorizontalPadding = 10;
const double _kTagChipHorizontalGap = 6;
const double _kTagsColumnSafetyPadding = 24;
const double _kTableRowHeight = 80;
const double _kTableRowSeparatorHeight = 1;
const double _kTableThumbnailWidth = 96;
const double _kTableThumbnailHeight = 56;
const Color _kTableThumbnailPlaceholderBg = ViewerPalette.surfaceContainer;
const Color _kTableThumbnailPlaceholderBorder = ViewerPalette.border;
const Color _kTableThumbnailPlaceholderIcon = ViewerPalette.textMuted;
const double _kCardRadius = ViewerPalette.radiusXl;
const Color _kZebraTint = Color(0x0D96622F);

/// How far one Left/Right arrow press pans the table's hidden columns.
const double _kColumnScrollStep = 200;

/// Lets a plain mouse drag pan a horizontal scroller. Flutter excludes
/// [PointerDeviceKind.mouse] from drag gestures by default, which is why the
/// table could previously only be panned with a trackpad or Shift+wheel.
class _ColumnDragScrollBehavior extends MaterialScrollBehavior {
  const _ColumnDragScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {
        ...super.dragDevices,
        PointerDeviceKind.mouse,
      };
}

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

const TextStyle _kDataCellTextStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTableText,
  fontWeight: FontWeight.w600,
  fontFeatures: [FontFeature.tabularFigures()],
);

const TextStyle _kHeaderLabelTextStyle = TextStyle(
  fontFamily: 'Inter',
  fontWeight: FontWeight.w800,
  fontSize: 12,
  letterSpacing: 1.1,
  height: 1,
);

// ---------------------------------------------------------------------------
// Field-scoped search parsing
// ---------------------------------------------------------------------------

class _ParsedQuery {
  const _ParsedQuery({required this.allFields, required this.fields});

  final String allFields;
  final Map<String, String> fields; // canonical field name → raw field filter

  bool get isEmpty => allFields.isEmpty && fields.isEmpty;
}

class _FilterToken {
  const _FilterToken({required this.negated, required this.value});

  final bool negated;
  final String value;
}

// Matches "fieldkeyword:" (case-insensitive, requires word boundary before).
final _kFieldPattern = RegExp(
  r'\b(denomination|denom|date|catalog|cat|grading|company|grade|tag|tags):\s*',
  caseSensitive: false,
);

String _canonicalField(String keyword) => switch (keyword.toLowerCase()) {
      'denomination' || 'denom' => 'denomination',
      'date' => 'issueDate',
      'catalog' || 'cat' => 'catalogNumber',
      'company' || 'grading' => 'gradingCompany',
      'grade' => 'grade',
      'tag' || 'tags' => 'tags',
      _ => keyword,
    };

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

  final textOnlyFilter = filterValue.replaceAll(RegExp(r'\d(?:[\d,. ]*\d)?'), ' ');
  final textTerms = _splitSearchTerms(textOnlyFilter);
  return textTerms.every((term) => noteValue.contains(term));
}

bool _matchesAllFieldsSearch(
  NoteRecord note,
  String allFields,
) {
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
    (term) => haystack.contains(term) || _matchesDenominationTerm(denomination, term),
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
  final value =
      normalizeValue != null ? normalizeValue(parsedValue) : parsedValue;
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

  final nextCharacter =
      noteValue.substring(filterValue.length, filterValue.length + 1);
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
      : [
          _parseFilterToken(rawFilterValue, normalizeValue: normalizeValue),
        ].whereType<_FilterToken>().toList(growable: false);

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

_ParsedQuery _parseQuery(String raw) {
  final trimmed = raw.trim();
  if (trimmed.isEmpty) {
    return const _ParsedQuery(allFields: '', fields: {});
  }

  final matches = _kFieldPattern.allMatches(trimmed).toList();
  if (matches.isEmpty) {
    return _ParsedQuery(allFields: trimmed.toLowerCase(), fields: const {});
  }

  final fields = <String, String>{};
  for (var i = 0; i < matches.length; i++) {
    final match = matches[i];
    final canonicalField = _canonicalField(match.group(1)!);
    final valueStart = match.end;
    final valueEnd =
        i + 1 < matches.length ? matches[i + 1].start : trimmed.length;
    // Strip optional trailing comma (e.g. "catalog: 123, denom: 10")
    final segment = trimmed.substring(valueStart, valueEnd).trim();
    final value = segment.endsWith(',')
        ? segment.substring(0, segment.length - 1).trim()
        : segment;
    if (value.isNotEmpty) {
      fields[canonicalField] = value;
    }
  }

  final allFields =
      trimmed.substring(0, matches.first.start).trim().toLowerCase();
  return _ParsedQuery(allFields: allFields, fields: fields);
}

// ---------------------------------------------------------------------------

double _measureTextWidth(String text, TextStyle style) {
  final painter = TextPainter(
    text: TextSpan(text: text, style: style),
    maxLines: 1,
    textDirection: TextDirection.ltr,
  )..layout();
  return painter.width;
}

double _tagChipWidth(String tagName) {
  return _measureTextWidth(tagName, _kTagChipTextStyle) +
      (_kTagChipHorizontalPadding * 2) +
      2;
}

double _calculateTagsColumnWidth(List<NoteRecord> notes) {
  final headerWidth = _measureTextWidth(
        'Tags',
        const TextStyle(fontWeight: FontWeight.w800),
      ) +
      28;
  final notesWidth = notes.fold<double>(0, (maxWidth, note) {
    if (note.tags.isEmpty) {
      return math.max(maxWidth, _measureTextWidth('-', const TextStyle()));
    }

    final tagNames = note.tags
        .map((tag) => tag.name.trim())
        .where((name) => name.isNotEmpty)
        .toList(growable: false);
    final rowWidth = tagNames
        .map(_tagChipWidth)
        .fold<double>(0, (sum, width) => sum + width);
    final spacing = math.max(0, tagNames.length - 1) * _kTagChipHorizontalGap;
    return math.max(maxWidth, rowWidth + spacing + _kTagsColumnSafetyPadding);
  });

  return math.max(_kDefaultTagsColumnWidth, math.max(headerWidth, notesWidth));
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
  String _query = '';
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

  /// Tracks whether the user is actively dragging the columns, so rows can
  /// show a closed-hand cursor. Vertical notifications are ignored.
  ///
  /// Any user-driven scroll (wheel, drag) also hands control back to the
  /// pointer: the keyboard row selection is dropped, like on pointer-down,
  /// and a lingering select-all in the filter is collapsed so the highlight
  /// does not sit stale behind the scrolled table. Programmatic scrolls
  /// (keyboard navigation, reveal-after-close) never trigger this.
  bool _handleTableScrollNotification(ScrollNotification notification) {
    // A wheel tick dispatches forward/reverse followed by idle; only the
    // user-driven directions reset the selection (idle also fires when a
    // programmatic jump settles back through goIdle).
    if (notification is UserScrollNotification &&
        notification.direction != ScrollDirection.idle) {
      if (_selectedIndex != null && mounted) {
        setState(() => _selectedIndex = null);
      }
      if (_searchFocusNode.hasFocus && !_searchController.selection.isCollapsed) {
        _searchController.selection = TextSelection.collapsed(
          offset: _searchController.text.length,
        );
      }
    }
    if (notification.metrics.axis != Axis.horizontal) {
      return false;
    }
    if (notification is ScrollStartNotification &&
        notification.dragDetails != null) {
      if (!_columnsDragging) {
        setState(() => _columnsDragging = true);
      }
    } else if (notification is ScrollEndNotification && _columnsDragging) {
      setState(() => _columnsDragging = false);
    }
    return false;
  }

  void _focusSelection(int index) {
    setState(() => _selectedIndex = index);
    _tableFocusNode.requestFocus();
  }

  @override
  void initState() {
    super.initState();
    _lastActiveCollectionId = widget.controller.activeCollectionId;
    widget.controller.addListener(_handleControllerChange);
    _searchFocusNode.addListener(_handleSearchFocusChange);
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
    widget.controller.addListener(_handleControllerChange);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_handleFocusDrain);
    widget.controller.removeListener(_handleControllerChange);
    _searchFocusNode.removeListener(_handleSearchFocusChange);
    _searchController.dispose();
    _horizontalScrollController.dispose();
    _verticalScrollController.dispose();
    _tableFocusNode.dispose();
    _searchFocusNode.dispose();
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

  void _handleControllerChange() {
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
      _searchController.clear();
      _selectedIndex = null;
    });

    if (_horizontalScrollController.hasClients) {
      _horizontalScrollController.jumpTo(0);
    }

    if (_verticalScrollController.hasClients) {
      _verticalScrollController.jumpTo(0);
    }
  }

  List<NoteRecord> _sortedNotes(List<NoteRecord> notes) {
    final parsed = _parseQuery(_query);
    final filtered = notes.where((note) {
      if (parsed.isEmpty) return true;

      if (parsed.allFields.isNotEmpty) {
        if (!_matchesAllFieldsSearch(note, parsed.allFields)) return false;
      }

      for (final entry in parsed.fields.entries) {
        if (entry.key == 'tags') {
          if (!_matchesTagFilter(note, entry.value)) {
            return false;
          }
          continue;
        }

        final fieldValue = note.valueForColumn(entry.key).toLowerCase();
        final supportsMultipleValues = entry.key == 'catalogNumber' ||
            entry.key == 'grade' ||
            entry.key == 'issueDate' ||
            entry.key == 'denomination';
        final matches = _matchesScalarFilter(
          fieldValue,
          entry.value,
          multiple: supportsMultipleValues,
          matcher: switch (entry.key) {
            'catalogNumber' => _matchesCatalogFilterValue,
            'denomination' => _matchesDenominationFilterValue,
            _ => (noteValue, filterValue) => noteValue.contains(filterValue),
          },
        );
        if (!matches) return false;
      }

      return true;
    }).toList(growable: false);

    filtered.sort((left, right) {
      final leftValue = left.valueForColumn(_sortKey).toLowerCase();
      final rightValue = right.valueForColumn(_sortKey).toLowerCase();

      final result = switch (_sortKey) {
        'displayOrder' => left.displayOrder.compareTo(right.displayOrder),
        _ => leftValue.compareTo(rightValue),
      };

      return _ascending ? result : -result;
    });

    return filtered;
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
  }

  void _applyTagFilter(String tagName) {
    final filterValue = 'tags: $tagName';
    _searchController.text = filterValue;
    setState(() {
      _query = filterValue;
      _selectedIndex = null;
    });
    if (_horizontalScrollController.hasClients) {
      _horizontalScrollController.jumpTo(0);
    }
  }

  Widget? _clearFilterButton() {
    if (_query.isEmpty) {
      return null;
    }
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: IconButton(
        tooltip: 'Clear filter',
        onPressed: () {
          _searchController.clear();
          setState(() {
            _query = '';
            _selectedIndex = null;
          });
        },
        iconSize: 18,
        padding: const EdgeInsets.all(7),
        constraints: const BoxConstraints(
          minWidth: 32,
          minHeight: 32,
        ),
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

  Future<void> _openNoteAtIndex(
    List<NoteRecord> notes,
    int index, {
    required bool viaKeyboard,
  }) async {
    // A mouse click dismisses the keyboard selection: the ring is a keyboard
    // affordance and should not appear for pointer users.
    if (!viaKeyboard && _selectedIndex != null) {
      setState(() => _selectedIndex = null);
    }
    final result = await Navigator.of(context).push<NoteSlideshowResult>(
      MaterialPageRoute<NoteSlideshowResult>(
        builder: (context) => NoteSlideshowScreen(
          notes: notes,
          initialIndex: index,
        ),
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
        _selectedIndex = null;
      });
    }
    if (result != null) {
      _revealNoteById(result.noteId, select: viaKeyboard);
    }
  }

  void _openSelected() {
    final notes = _currentVisibleNotes();
    final index = _selectedIndex;
    if (index == null || index < 0 || index >= notes.length) {
      return;
    }
    _openNoteAtIndex(notes, index, viaKeyboard: true);
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
    if (_verticalScrollController.hasClients) {
      final position = _verticalScrollController.position;
      pageSize = math.max(1, (position.viewportDimension / _rowExtent).floor());
      firstVisibleIndex =
          (position.pixels / _rowExtent).floor().clamp(0, notes.length - 1);
    }
    final base = _selectedIndex ?? firstVisibleIndex;
    final target = (base + direction * pageSize).clamp(0, notes.length - 1);
    _focusSelection(target);
    _scrollToOffset(target * _rowExtent);
  }

  void _ensureSelectedVisible() {
    final index = _selectedIndex;
    if (index == null || !_verticalScrollController.hasClients) {
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

  KeyEventResult _handleTableKey(KeyEvent event) {
    if (!_keyboardNavEnabled) {
      return KeyEventResult.ignored;
    }
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    final key = event.logicalKey;
    // Jump-to-edge uses the platform's primary modifier: Cmd on macOS, Ctrl
    // elsewhere.
    final bool jumpColumns = defaultTargetPlatform == TargetPlatform.macOS
        ? HardwareKeyboard.instance.isMetaPressed
        : HardwareKeyboard.instance.isControlPressed;
    if (jumpColumns &&
        (key == LogicalKeyboardKey.arrowLeft ||
            key == LogicalKeyboardKey.arrowRight)) {
      return _scrollColumnsToEdge(forward: key == LogicalKeyboardKey.arrowRight)
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    if (HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isMetaPressed ||
        HardwareKeyboard.instance.isAltPressed) {
      return KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.arrowDown ||
        key == LogicalKeyboardKey.keyJ) {
      _moveSelection(1);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.keyK) {
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
    if (key == LogicalKeyboardKey.arrowLeft) {
      return _scrollColumnsBy(-_kColumnScrollStep)
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    if (key == LogicalKeyboardKey.arrowRight) {
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
      _searchController.selection =
          TextSelection(baseOffset: 0, extentOffset: text.length);
    }
  }

  void _handleSearchFocusChange() {
    // Focusing the filter by any means (click, tap, slash, Tab) drops the row
    // selection so the selection ring doesn't linger behind the field.
    if (_searchFocusNode.hasFocus && _selectedIndex != null && mounted) {
      setState(() => _selectedIndex = null);
    }
  }

  /// A pointer interaction with the table is not a keyboard interaction: drop
  /// the selection ring. A grab or drag never fires the row's `onTap`, so this
  /// is the only place that can clear it for pointer users.
  void _handleTablePointerDown(PointerDownEvent event) {
    if (!_keyboardNavEnabled || _selectedIndex == null) {
      return;
    }
    setState(() => _selectedIndex = null);
  }

  /// Called for each pointer-down outside the filter. On desktop, Flutter's
  /// default would unfocus the field to the enclosing route scope; because a
  /// drag never fires an `onTap`, that leaves the table without primary focus
  /// and its shortcuts (/, arrows) dead. Return keyboard control to the table.
  void _handleFilterTapOutside(PointerDownEvent event) {
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

  Future<void> _openImportScreen() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) =>
            ImportDatasetScreen(controller: widget.controller),
      ),
    );
  }

  void _revealNoteById(int noteId, {required bool select}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_verticalScrollController.hasClients) {
        return;
      }

      final dataset = widget.controller.dataset;
      if (dataset == null) {
        return;
      }

      final visibleNotes =
          _sortedNotes(widget.controller.activeCollectionNotes);
      final noteIndex = visibleNotes.indexWhere((note) => note.id == noteId);
      if (noteIndex < 0) {
        return;
      }

      // Only a keyboard-opened note restores the selection ring on return.
      if (select && _keyboardNavEnabled) {
        _focusSelection(noteIndex);
      }

      _scrollToOffset(noteIndex * _rowExtent);
    });
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
        child: DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                ViewerPalette.pageBackgroundTop,
                ViewerPalette.pageBackground,
                ViewerPalette.pageBackgroundBottom,
              ],
              stops: [0.0, 0.55, 1.0],
            ),
          ),
          child: SafeArea(
            bottom: false,
            child: AnimatedBuilder(
              animation: widget.controller,
              builder: (context, _) {
                if (widget.controller.isLoading &&
                    widget.controller.dataset == null) {
                  return const _TableSkeleton();
                }

                if (widget.controller.error != null &&
                    widget.controller.dataset == null) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'Failed to load dataset: ${widget.controller.error}',
                      ),
                    ),
                  );
                }

                final dataset = widget.controller.dataset;
                if (dataset == null) {
                  return const Center(child: Text('No dataset available.'));
                }

                final scopedNotes = widget.controller.activeCollectionNotes;
                final notes = _sortedNotes(scopedNotes);

                final tagsColumnWidth = _calculateTagsColumnWidth(notes);
                final minTableWidth = _kFixedColumnsWidth +
                    tagsColumnWidth +
                    (_kTableHorizontalPadding * 2);

                return Padding(
                  padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _Header(
                        totalCount: scopedNotes.length,
                        visibleCount: notes.length,
                        onOpenImports:
                            widget.controller.canManageImportedDatasets
                                ? _openImportScreen
                                : null,
                      ),
                      const SizedBox(height: 20),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 420),
                        child: TextField(
                          controller: _searchController,
                          focusNode: _searchFocusNode,
                          // Flutter's default tap-outside behavior drops
                          // primary focus to the enclosing route scope. On a
                          // drag that never re-fires the table's onTap, so `/`
                          // and the arrow keys stop working. Hand keyboard
                          // control back to the table instead.
                          onTapOutside: _handleFilterTapOutside,
                          decoration: InputDecoration(
                            filled: true,
                            fillColor: ViewerPalette.surface,
                            hintText:
                                'Filter…  catalog:  denom:  date:  company:  grade:  tags:',
                            hintStyle: const TextStyle(
                              fontFamily: 'Inter',
                              color: ViewerPalette.textFaint,
                              fontSize: 13,
                            ),
                            prefixIcon: const Icon(
                              Icons.search_rounded,
                              size: 20,
                            ),
                            prefixIconColor: ViewerPalette.textMuted,
                            suffixIcon: _clearFilterButton(),
                            contentPadding: const EdgeInsets.symmetric(
                                horizontal: 16, vertical: 14),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(
                                  ViewerPalette.radiusLg),
                              borderSide:
                                  const BorderSide(color: _kTableBorder),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(
                                  ViewerPalette.radiusLg),
                              borderSide:
                                  const BorderSide(color: _kTableBorder),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(
                                  ViewerPalette.radiusLg),
                              borderSide: const BorderSide(
                                color: ViewerPalette.accent,
                                width: 1.5,
                              ),
                            ),
                          ),
                          onChanged: (value) => setState(() {
                            _query = value;
                            _selectedIndex = null;
                          }),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Expanded(
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            final tableWidth =
                                math.max(minTableWidth, constraints.maxWidth);

                            final Widget table = Focus(
                              focusNode: _tableFocusNode,
                              autofocus: _keyboardNavEnabled,
                              onKeyEvent: (node, event) =>
                                  _handleTableKey(event),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  color: _kTableSurface,
                                borderRadius: BorderRadius.circular(
                                          _kCardRadius),
                                border: Border.all(
                                    color: _kTableBorder, width: 1),
                                boxShadow: ViewerPalette.shadowMid,
                              ),
                              child: notes.isEmpty
                                  ? const _TableEmptyState()
                                  : ClipRRect(
                                      borderRadius: BorderRadius.circular(
                                          _kCardRadius),
                                      child: NotificationListener<
                                          ScrollNotification>(
                                        onNotification:
                                            _handleTableScrollNotification,
                                        child: ScrollConfiguration(
                                          behavior:
                                              const _ColumnDragScrollBehavior(),
                                          child: SingleChildScrollView(
                                            controller:
                                                _horizontalScrollController,
                                            scrollDirection: Axis.horizontal,
                                            child: SizedBox(
                                              width: tableWidth,
                                              child: Column(
                                                children: [
                                                  _TableHeader(
                                                    sortKey: _sortKey,
                                                    ascending: _ascending,
                                                    onSort: _toggleSort,
                                                    tagsColumnWidth:
                                                        tagsColumnWidth,
                                                    draggingColumns:
                                                        _columnsDragging,
                                                  ),
                                                  const Divider(
                                                    height: 2,
                                                    thickness: 2,
                                                    color: _kTableHeaderDivider,
                                                  ),
                                                  Expanded(
                                                    child: ScrollConfiguration(
                                                      behavior:
                                                          const MaterialScrollBehavior(),
                                                      child: Scrollbar(
                                                        controller:
                                                            _verticalScrollController,
                                                        thumbVisibility: true,
                                                        child:
                                                            ListView.separated(
                                                          controller:
                                                              _verticalScrollController,
                                                          itemCount:
                                                              notes.length,
                                                          separatorBuilder:
                                                              (context, index) =>
                                                                  const Divider(
                                                            height: 1,
                                                            color:
                                                                _kTableDivider,
                                                          ),
                                                          itemBuilder:
                                                              (context, index) {
                                                            final note =
                                                                notes[index];

                                                            final row = _TableRow(
                                                              note: note,
                                                              tagsColumnWidth:
                                                                  tagsColumnWidth,
                                                              draggingColumns:
                                                                  _columnsDragging,
                                                              selected: _keyboardNavEnabled &&
                                                                  _selectedIndex ==
                                                                      index,
                                                              onTagTap:
                                                                  _applyTagFilter,
                                                              onTap: () =>
                                                                  _openNoteAtIndex(
                                                                      notes,
                                                                      index,
                                                                      viaKeyboard:
                                                                          false),
                                                            );
                                                            if (index.isOdd) {
                                                              return ColoredBox(
                                                                color:
                                                                    _kZebraTint,
                                                                child: row,
                                                              );
                                                            }
                                                            return row;
                                                          },
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
                            );
                            // Pointer-down inside the table drops the keyboard
                            // selection ring (a grab/drag never fires onTap).
                            return Listener(
                              behavior: HitTestBehavior.translucent,
                              onPointerDown: _handleTablePointerDown,
                              child: table,
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

class _Header extends StatelessWidget {
  const _Header({
    required this.totalCount,
    required this.visibleCount,
    required this.onOpenImports,
  });

  final int totalCount;
  final int visibleCount;
  final VoidCallback? onOpenImports;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            color: _kTableSurface,
            borderRadius:
                BorderRadius.circular(ViewerPalette.radiusLg),
            border: Border.all(color: _kTableBorder),
            boxShadow: ViewerPalette.shadowLow,
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: _kHeaderBadgeHeight),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 6, 16, 6),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          ViewerPalette.accent,
                          ViewerPalette.accentStrong,
                        ],
                      ),
                      borderRadius: BorderRadius.circular(
                          ViewerPalette.radiusSm),
                      boxShadow: ViewerPalette.shadowLow,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(3),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(9),
                        child: Image.asset(
                          'web/icons/Icon-192.png',
                          width: 30,
                          height: 30,
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Note\nHarbor',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(
                              fontFamily: 'Inter',
                              fontWeight: FontWeight.w800,
                              color: _kTableText,
                              height: 0.95,
                              letterSpacing: -0.3,
                            ),
                      ),
                      const SizedBox(height: 3),
                      const Text(
                        'COLLECTION VIEWER',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.6,
                          color: ViewerPalette.textMuted,
                          height: 1,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        const Spacer(),
        _StatPill(label: 'Notes', value: '$visibleCount / $totalCount'),
        if (onOpenImports != null) ...[
          const SizedBox(width: 16),
          _ImportButton(onPressed: onOpenImports!),
        ],
      ],
    );
  }
}

class _ImportButton extends StatefulWidget {
  const _ImportButton({required this.onPressed});

  final VoidCallback onPressed;

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
          borderRadius:
              BorderRadius.circular(ViewerPalette.radiusLg),
          border: Border.all(
            color:
                _hovered ? ViewerPalette.accent : _kTableBorder,
          ),
          boxShadow: ViewerPalette.shadowLow,
        ),
        child: SizedBox(
          height: _kHeaderBadgeHeight,
          width: _kHeaderBadgeHeight,
          child: IconButton(
            tooltip: 'Manage imported archives',
            onPressed: widget.onPressed,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints.tightFor(
              width: _kHeaderBadgeHeight,
              height: _kHeaderBadgeHeight,
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
  const _StatPill({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: _kTableSurface,
        borderRadius:
            BorderRadius.circular(ViewerPalette.radiusLg),
        border: Border.all(color: _kTableBorder),
        boxShadow: ViewerPalette.shadowLow,
      ),
      child: SizedBox(
        height: _kHeaderBadgeHeight,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'NOTES',
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.2,
                  color: ViewerPalette.textMuted,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                value,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: _kTableText,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
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
    required this.tagsColumnWidth,
    required this.draggingColumns,
  });

  final String sortKey;
  final bool ascending;
  final ValueChanged<String> onSort;
  final double tagsColumnWidth;
  final bool draggingColumns;

  @override
  Widget build(BuildContext context) {
    // The header doubles as a handle for panning the columns: it keeps the
    // normal cursor on hover and only shows the drag hand while panning. Sort
    // buttons sit deeper and keep their own click cursor.
    return MouseRegion(
      key: const ValueKey('tableHeader'),
      cursor: draggingColumns ? _draggingCursor : MouseCursor.defer,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFFECE0C6),
              _kTableHeaderBg,
            ],
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: _kTableHorizontalPadding, vertical: 4),
          child: Row(
            children: [
              _HeaderCell(
                  width: _kOrderColumnWidth,
                  label: 'ID',
                  sortKey: 'displayOrder',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: _kFrontColumnWidth,
                  label: 'Front',
                  isSortable: false,
                  sortKey: '',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: _kDenominationColumnWidth,
                  label: 'Denomination',
                  sortKey: 'denomination',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: _kDateColumnWidth,
                  label: 'Date',
                  sortKey: 'issueDate',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: _kCatalogColumnWidth,
                  label: 'Catalog',
                  sortKey: 'catalogNumber',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: _kCompanyColumnWidth,
                  label: 'Company',
                  sortKey: 'gradingCompany',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: _kGradeColumnWidth,
                  label: 'Grade',
                  sortKey: 'grade',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: _kSerialColumnWidth,
                  label: 'Serial',
                  sortKey: 'serial',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
              _HeaderCell(
                  width: tagsColumnWidth,
                  label: 'Tags',
                  sortKey: 'tags',
                  activeSortKey: sortKey,
                  ascending: ascending,
                  onSort: onSort),
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
    required this.sortKey,
    required this.activeSortKey,
    required this.ascending,
    required this.onSort,
    this.isSortable = true,
  });

  final double width;
  final String label;
  final String sortKey;
  final String activeSortKey;
  final bool ascending;
  final ValueChanged<String> onSort;
  final bool isSortable;

  @override
  Widget build(BuildContext context) {
    final isActive = isSortable && sortKey == activeSortKey;

    return SizedBox(
      width: width,
      child: isSortable
          ? TextButton(
              onPressed: () => onSort(sortKey),
              style: TextButton.styleFrom(
                alignment: Alignment.center,
                foregroundColor: _kTableSortableHeaderText,
                overlayColor: ViewerPalette.accentSoft,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(
                      ViewerPalette.radiusSm),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                      child: Text(
                    label.toUpperCase(),
                    style: _kHeaderLabelTextStyle.copyWith(
                      color: isActive
                          ? _kTableSortableHeaderText
                          : ViewerPalette.textMuted,
                    ),
                  )),
                  AnimatedRotation(
                    turns: isActive && !ascending ? 0.5 : 0.0,
                    duration: const Duration(milliseconds: 180),
                    curve: Curves.easeOut,
                    child: AnimatedOpacity(
                      opacity: isActive ? 1.0 : 0.0,
                      duration: const Duration(milliseconds: 150),
                      child: const Padding(
                        padding: EdgeInsets.only(left: 5),
                        child: Text(
                          '▲',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: _kTableSortableHeaderText,
                            height: 1,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            )
          : Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Center(
                  child: Text(
                label.toUpperCase(),
                style: _kHeaderLabelTextStyle.copyWith(
                  color: ViewerPalette.textMuted,
                ),
              )),
            ),
    );
  }
}

class _TableRow extends StatelessWidget {
  const _TableRow({
    required this.note,
    required this.tagsColumnWidth,
    required this.draggingColumns,
    required this.onTagTap,
    required this.onTap,
    required this.selected,
  });

  final NoteRecord note;
  final double tagsColumnWidth;
  final bool draggingColumns;
  final ValueChanged<String> onTagTap;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final image = note.previewFor('front');

    return InkWell(
      onTap: onTap,
      // Rows keep the normal cursor on hover (no click hand) and only show the
      // drag hand while the table is being panned.
      mouseCursor: draggingColumns ? _draggingCursor : MouseCursor.defer,
      hoverColor: ViewerPalette.accentSoft,
      highlightColor: ViewerPalette.accentSoft,
      // The selection ring is a paint-only overlay: it never participates in
      // layout, so moving keyboard selection cannot shift rows (same idea as
      // the editor's box-shadow focus ring).
      child: Stack(
        key: ValueKey('tableRow-${note.id}'),
        children: [
          if (selected)
            const Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: ViewerPalette.accentSoft,
                  borderRadius:
                      BorderRadius.all(Radius.circular(12)),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: _kTableHorizontalPadding, vertical: 12),
            child: Row(
              children: [
            _DataCell(
                width: _kOrderColumnWidth, child: Text('${note.displayOrder}')),
            _DataCell(
              width: _kFrontColumnWidth,
              child: image == null
                  ? const _TableThumbnailPlaceholder()
                  : DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(
                            ViewerPalette.radiusSm),
                        border: Border.all(
                            color: ViewerPalette.borderControl),
                        boxShadow: ViewerPalette.shadowLow,
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(
                            ViewerPalette.radiusSm - 1),
                        child: Image(
                          image: createNoteImageProvider(image),
                          width: _kTableThumbnailWidth,
                          height: _kTableThumbnailHeight,
                          fit: BoxFit.cover,
                          frameBuilder:
                              (context, child, frame, wasSynchronouslyLoaded) {
                            if (wasSynchronouslyLoaded || frame != null) {
                              return child;
                            }
                            return const _TableThumbnailPlaceholder();
                          },
                          errorBuilder: (context, error, stackTrace) =>
                              const _TableThumbnailPlaceholder(),
                        ),
                      ),
                    ),
            ),
            _DataCell(
                width: _kDenominationColumnWidth,
                child: Text(note.denomination)),
            _DataCell(
                width: _kDateColumnWidth,
                child: Text(note.issueDate.isEmpty ? '-' : note.issueDate)),
            _DataCell(
                width: _kCatalogColumnWidth,
                child: Text(
                    note.catalogNumber.isEmpty ? '-' : note.catalogNumber)),
            _DataCell(
                width: _kCompanyColumnWidth,
                child: Text(
                    note.gradingCompany.isEmpty ? '-' : note.gradingCompany)),
            _DataCell(
                width: _kGradeColumnWidth,
                child: Text(note.grade.isEmpty ? '-' : note.grade)),
            _DataCell(
                width: _kSerialColumnWidth,
                child: Text(note.serial.isEmpty ? '-' : note.serial)),
            _DataCell(
                width: tagsColumnWidth,
                child: _NoteTagsCell(tags: note.tags, onTagTap: onTagTap)),
            ],
            ),
          ),
          if (selected)
            const Positioned.fill(
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius:
                        BorderRadius.all(Radius.circular(12)),
                    border: Border.fromBorderSide(
                      BorderSide(color: ViewerPalette.accent, width: 2),
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

class _TableThumbnailPlaceholder extends StatelessWidget {
  const _TableThumbnailPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: _kTableThumbnailWidth,
      height: _kTableThumbnailHeight,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFF4EBD8),
            _kTableThumbnailPlaceholderBg,
          ],
        ),
        borderRadius:
            BorderRadius.circular(ViewerPalette.radiusSm),
        border: Border.all(color: _kTableThumbnailPlaceholderBorder),
      ),
      child: const Center(
        child: Icon(
          Icons.image_outlined,
          size: 22,
          color: _kTableThumbnailPlaceholderIcon,
        ),
      ),
    );
  }
}

class _NoteTagsCell extends StatelessWidget {
  const _NoteTagsCell({required this.tags, required this.onTagTap});

  final List<Tag> tags;
  final ValueChanged<String> onTagTap;

  @override
  Widget build(BuildContext context) {
    final tagNames = tags
        .map((tag) => tag.name.toString().trim())
        .where((name) => name.isNotEmpty)
        .toList(growable: false);

    if (tagNames.isEmpty) {
      return const Text('-');
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < tagNames.length; i++) ...[
          if (i > 0) const SizedBox(width: _kTagChipHorizontalGap),
          _TagChip(
            label: tagNames[i],
            onTap: () => onTagTap(tagNames[i]),
          ),
        ],
      ],
    );
  }
}

class _TagChip extends StatefulWidget {
  const _TagChip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  State<_TagChip> createState() => _TagChipState();
}

class _TagChipState extends State<_TagChip> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: widget.onTap,
      child: MouseRegion(
        cursor: SystemMouseCursors.click,
        onEnter: (_) => setState(() => _hovered = true),
        onExit: (_) => setState(() => _hovered = false),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOut,
          decoration: BoxDecoration(
            color: _hovered ? ViewerPalette.accentSoft : _kTagChipBg,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: _hovered
                  ? ViewerPalette.accent
                  : _kTagChipBorder,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: _kTagChipHorizontalPadding,
              vertical: 4,
            ),
            child: Text(
              widget.label,
              maxLines: 1,
              overflow: TextOverflow.visible,
              softWrap: false,
              style: _kTagChipTextStyle,
            ),
          ),
        ),
      ),
    );
  }
}

class _DataCell extends StatelessWidget {
  const _DataCell({required this.width, required this.child});

  final double width;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: DefaultTextStyle.merge(
        style: _kDataCellTextStyle,
        child: Center(child: child),
      ),
    );
  }
}

class _TableEmptyState extends StatelessWidget {
  const _TableEmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: ViewerPalette.surfaceContainer,
                borderRadius: BorderRadius.circular(
                    ViewerPalette.radiusLg),
                border: Border.all(color: ViewerPalette.border),
              ),
              child: const Padding(
                padding: EdgeInsets.all(16),
                child: Icon(
                  Icons.search_off_rounded,
                  size: 28,
                  color: ViewerPalette.textMuted,
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'No notes match the current filter.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: 'Inter',
                fontWeight: FontWeight.w700,
                fontSize: 15,
                color: ViewerPalette.text,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Try a different search, or clear the filter to see everything.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: 'Inter',
                fontSize: 13,
                color: ViewerPalette.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TableSkeleton extends StatefulWidget {
  const _TableSkeleton();

  @override
  State<_TableSkeleton> createState() => _TableSkeletonState();
}

class _TableSkeletonState extends State<_TableSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: ViewerPalette.surface,
            borderRadius:
                BorderRadius.circular(ViewerPalette.radiusXl),
            border: Border.all(color: ViewerPalette.border),
            boxShadow: ViewerPalette.shadowMid,
          ),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: AnimatedBuilder(
              animation: _pulse,
              builder: (context, _) {
                final t = Curves.easeInOut.transform(_pulse.value);
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (var i = 0; i < 5; i++) ...[
                      _SkeletonLine(
                        alpha: 0.35 + 0.45 * (i.isEven ? t : 1 - t),
                        widthFactor: i == 0 ? 0.9 : (i == 4 ? 0.55 : 0.75),
                      ),
                      if (i < 4) const SizedBox(height: 12),
                    ],
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _SkeletonLine extends StatelessWidget {
  const _SkeletonLine({required this.alpha, required this.widthFactor});

  final double alpha;
  final double widthFactor;

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      widthFactor: widthFactor,
      alignment: Alignment.centerLeft,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: ViewerPalette.textFaint.withValues(alpha: alpha.clamp(0.0, 1.0)),
          borderRadius:
              BorderRadius.circular(ViewerPalette.radiusSm),
        ),
        child: const SizedBox(height: 16),
      ),
    );
  }
}
