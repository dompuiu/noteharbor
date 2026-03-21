import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../data/viewer_repository.dart';
import '../../models/note_record.dart';
import '../../models/viewer_dataset.dart';
import '../slideshow/note_slideshow_screen.dart';

String formatFriendlyDatasetBuiltAt(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) {
    return trimmed;
  }

  final parsed = DateTime.tryParse(trimmed);
  if (parsed == null) {
    return trimmed;
  }

  final normalized = parsed.toUtc();
  const monthNames = <String>[
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  final month = monthNames[normalized.month - 1];
  final day = normalized.day.toString().padLeft(2, '0');
  final hour = normalized.hour.toString().padLeft(2, '0');
  final minute = normalized.minute.toString().padLeft(2, '0');

  return '$month $day, ${normalized.year} at $hour:$minute UTC';
}

const double _kTableContentWidth = 1180;
const double _kTableHorizontalPadding = 14;
const double _kTableTotalWidth = _kTableContentWidth + (_kTableHorizontalPadding * 2);

class NotesTableScreen extends StatefulWidget {
  const NotesTableScreen({super.key});

  @override
  State<NotesTableScreen> createState() => _NotesTableScreenState();
}

class _NotesTableScreenState extends State<NotesTableScreen> {
  final ViewerRepository _repository = const ViewerRepository();
  final TextEditingController _searchController = TextEditingController();
  final ScrollController _horizontalScrollController = ScrollController();
  final ScrollController _verticalScrollController = ScrollController();
  late Future<ViewerDataset> _datasetFuture;
  String _query = '';
  String _sortKey = 'displayOrder';
  bool _ascending = true;

  @override
  void initState() {
    super.initState();
    _datasetFuture = _repository.loadDataset();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _horizontalScrollController.dispose();
    _verticalScrollController.dispose();
    super.dispose();
  }

  List<NoteRecord> _sortedNotes(List<NoteRecord> notes) {
    final loweredQuery = _query.trim().toLowerCase();
    final filtered = notes.where((note) {
      if (loweredQuery.isEmpty) {
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
      return haystack.contains(loweredQuery);
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
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFFF3EADA), Color(0xFFE6DBC9), Color(0xFFD6E3DB)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(
          child: FutureBuilder<ViewerDataset>(
            future: _datasetFuture,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }

              if (snapshot.hasError) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text('Failed to load bundled dataset: ${snapshot.error}'),
                  ),
                );
              }

              final dataset = snapshot.data!;
              final notes = _sortedNotes(dataset.notes);

              return Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Header(
                      totalCount: dataset.noteCount,
                      visibleCount: notes.length,
                      generatedAt: dataset.generatedAt,
                    ),
                    const SizedBox(height: 20),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 420),
                      child: TextField(
                        controller: _searchController,
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: const Color(0xFFFCFAF5),
                          hintText: 'Filter denomination, catalog, serial, tags, notes...',
                          prefixIcon: const Icon(Icons.search_rounded),
                          suffixIcon: _query.isEmpty
                              ? null
                              : IconButton(
                                  onPressed: () {
                                    _searchController.clear();
                                    setState(() => _query = '');
                                  },
                                  icon: const Icon(Icons.close_rounded),
                                ),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(18),
                            borderSide: BorderSide.none,
                          ),
                        ),
                        onChanged: (value) => setState(() => _query = value),
                      ),
                    ),
                    const SizedBox(height: 20),
                    Expanded(
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          final tableWidth = math.max(_kTableTotalWidth, constraints.maxWidth);

                          return DecoratedBox(
                            decoration: BoxDecoration(
                              color: const Color(0xFFFCFAF5),
                              borderRadius: BorderRadius.circular(28),
                              boxShadow: const [
                                BoxShadow(
                                  blurRadius: 28,
                                  offset: Offset(0, 16),
                                  color: Color(0x16000000),
                                ),
                              ],
                            ),
                            child: notes.isEmpty
                                ? const Center(child: Text('No notes match the current filter.'))
                                : ClipRRect(
                                    borderRadius: BorderRadius.circular(28),
                                    child: Scrollbar(
                                      controller: _horizontalScrollController,
                                      child: SingleChildScrollView(
                                        controller: _horizontalScrollController,
                                        scrollDirection: Axis.horizontal,
                                        child: SizedBox(
                                          width: tableWidth,
                                          child: Column(
                                            children: [
                                              _TableHeader(sortKey: _sortKey, ascending: _ascending, onSort: _toggleSort),
                                              const Divider(height: 1),
                                              Expanded(
                                                child: Scrollbar(
                                                  controller: _verticalScrollController,
                                                  child: ListView.separated(
                                                    controller: _verticalScrollController,
                                                    itemCount: notes.length,
                                                    separatorBuilder: (context, index) => const Divider(height: 1),
                                                    itemBuilder: (context, index) {
                                                      final note = notes[index];
                                                      return _TableRow(
                                                        note: note,
                                                        onTap: () {
                                                          Navigator.of(context).push(
                                                            MaterialPageRoute<void>(
                                                              builder: (context) => NoteSlideshowScreen(
                                                                notes: notes,
                                                                initialIndex: index,
                                                              ),
                                                            ),
                                                          );
                                                        },
                                                      );
                                                    },
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
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
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.totalCount,
    required this.visibleCount,
    required this.generatedAt,
  });

  final int totalCount;
  final int visibleCount;
  final String? generatedAt;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      runSpacing: 16,
      spacing: 16,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Romanian Paper Money Archive',
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: const Color(0xFF7A5D27),
                    letterSpacing: 1.4,
                  ),
            ),
            const SizedBox(height: 4),
            Text(
              'Note Harbor Viewew',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
            ),
          ],
        ),
        _StatPill(label: 'Notes', value: '$visibleCount / $totalCount'),
        if (generatedAt != null && generatedAt!.trim().isNotEmpty)
          _StatPill(
            label: 'Dataset built',
            value: formatFriendlyDatasetBuiltAt(generatedAt!),
          ),
      ],
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
        color: const Color(0xFFFEFBF3),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFD8CBB5)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('$label: ', style: const TextStyle(fontWeight: FontWeight.w700)),
            Text(value),
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
  });

  final String sortKey;
  final bool ascending;
  final ValueChanged<String> onSort;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFFE8E1D4),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: _kTableHorizontalPadding, vertical: 12),
        child: Row(
          children: [
            _HeaderCell(width: 90, label: 'Order', sortKey: 'displayOrder', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 120, label: 'Front', isSortable: false, sortKey: '', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 190, label: 'Denomination', sortKey: 'denomination', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 120, label: 'Date', sortKey: 'issueDate', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 130, label: 'Catalog', sortKey: 'catalogNumber', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 120, label: 'Company', sortKey: 'gradingCompany', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 110, label: 'Grade', sortKey: 'grade', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 140, label: 'Serial', sortKey: 'serial', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
            _HeaderCell(width: 160, label: 'Tags', sortKey: 'tags', activeSortKey: sortKey, ascending: ascending, onSort: onSort),
          ],
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
    final icon = isActive ? (ascending ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded) : null;

    return SizedBox(
      width: width,
      child: isSortable
          ? TextButton(
              onPressed: () => onSort(sortKey),
              style: TextButton.styleFrom(alignment: Alignment.center),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (icon != null) ...[
                    const SizedBox(width: 4),
                    Icon(icon, size: 16),
                  ],
                ],
              ),
            )
          : Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Center(child: Text(label, style: const TextStyle(fontWeight: FontWeight.w700))),
            ),
    );
  }
}

class _TableRow extends StatelessWidget {
  const _TableRow({
    required this.note,
    required this.onTap,
  });

  final NoteRecord note;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final imagePath = note.previewFor('front')?.assetPath;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: _kTableHorizontalPadding, vertical: 12),
        child: Row(
          children: [
            _DataCell(width: 90, child: Text('${note.displayOrder}')),
            _DataCell(
              width: 120,
              child: imagePath == null
                  ? const Text('-')
                  : ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.asset(
                        imagePath,
                        width: 96,
                        height: 56,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) => const SizedBox(
                          width: 96,
                          height: 56,
                          child: ColoredBox(color: Color(0xFFE7E0D5)),
                        ),
                      ),
                    ),
            ),
            _DataCell(width: 190, child: Text(note.denomination)),
            _DataCell(width: 120, child: Text(note.issueDate.isEmpty ? '-' : note.issueDate)),
            _DataCell(width: 130, child: Text(note.catalogNumber.isEmpty ? '-' : note.catalogNumber)),
            _DataCell(width: 120, child: Text(note.gradingCompany.isEmpty ? '-' : note.gradingCompany)),
            _DataCell(width: 110, child: Text(note.grade.isEmpty ? '-' : note.grade)),
            _DataCell(width: 140, child: Text(note.serial.isEmpty ? '-' : note.serial)),
            _DataCell(width: 160, child: Text(note.tagsLabel.isEmpty ? '-' : note.tagsLabel)),
          ],
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
      child: Center(child: child),
    );
  }
}
