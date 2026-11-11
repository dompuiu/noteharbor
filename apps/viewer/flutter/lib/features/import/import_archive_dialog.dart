import 'package:flutter/material.dart';

import '../../app/viewer_palette.dart';
import '../../models/archive_preview.dart';
import '../../models/viewer_collection.dart';

/// One archive collection and whether importing it replaces an installed one.
typedef _ArchiveEntry = ({ViewerCollection collection, bool replaces});

/// Confirms an archive import by naming the file and listing what it holds.
///
/// The archive is read while the dialog is open: a spinner covers the wait. A
/// null or failed preview hides the list and falls back to the by-name
/// replacement sentence, so the dialog still names the file and what matching
/// names cost.
class ImportArchiveDialog extends StatefulWidget {
  const ImportArchiveDialog({
    super.key,
    required this.fileName,
    required this.peekArchive,
    required this.installedCollections,
  });

  /// The selected archive's file name, shown in the title.
  final String fileName;

  /// Reads the archive's collections. Null means it is not a readable archive.
  final Future<ArchivePreview?> Function() peekArchive;

  /// Collections already installed on this device, used to tag each archive
  /// collection as replacing one of them or as new.
  final List<ViewerCollection> installedCollections;

  @override
  State<ImportArchiveDialog> createState() => _ImportArchiveDialogState();
}

class _ImportArchiveDialogState extends State<ImportArchiveDialog> {
  late final Future<ArchivePreview?> _preview;
  late final Set<String> _installedNames;

  @override
  void initState() {
    super.initState();
    // .sync turns a synchronous throw from the reader into a failed future,
    // so the dialog always renders and falls back to the by-name sentence.
    _preview = Future<ArchivePreview?>.sync(widget.peekArchive);
    _installedNames = {
      for (final collection in widget.installedCollections)
        _normalizeName(collection.name),
    };
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ArchivePreview?>(
      future: _preview,
      builder: (context, snapshot) {
        final isLoading = snapshot.connectionState != ConnectionState.done;
        // A failed read is not an import failure: the dialog still opens and
        // falls back to the by-name sentence.
        final preview = snapshot.hasError ? null : snapshot.data;
        final entries = _entries(preview);

        return AlertDialog(
          key: const ValueKey('importArchiveDialog'),
          scrollable: true,
          title: Text('Import "${widget.fileName}"?'),
          content: _DialogContent(isLoading: isLoading, entries: entries),
          actions: [
            TextButton(
              key: const ValueKey('importArchiveCancel'),
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              key: const ValueKey('importArchiveConfirm'),
              onPressed:
                  isLoading ? null : () => Navigator.of(context).pop(true),
              child: Text(_confirmLabel(entries)),
            ),
          ],
        );
      },
    );
  }

  /// Null when the archive cannot be read, which hides the collection list.
  List<_ArchiveEntry>? _entries(ArchivePreview? preview) {
    if (preview == null || preview.collections.isEmpty) {
      return null;
    }

    return [
      for (final collection in preview.collections)
        (
          collection: collection,
          replaces: _installedNames.contains(_normalizeName(collection.name)),
        ),
    ];
  }
}

/// SQLite's `lower()` only folds ASCII, so the dialog folds the same range to
/// agree with the import's case-insensitive name match.
String _normalizeName(String name) {
  final trimmed = name.trim();
  final folded = StringBuffer();
  for (final codeUnit in trimmed.codeUnits) {
    folded.writeCharCode(
      codeUnit >= 0x41 && codeUnit <= 0x5A ? codeUnit + 0x20 : codeUnit,
    );
  }
  return folded.toString();
}

/// `1 note` / `2 notes`, without repeating the plural ternary everywhere.
String _counted(int count, String noun) =>
    '$count $noun${count == 1 ? '' : 's'}';

String _confirmLabel(List<_ArchiveEntry>? entries) {
  if (entries == null) {
    return 'Import';
  }

  final replacingCount = entries.where((entry) => entry.replaces).length;
  final verb = replacingCount == 0
      ? 'Add'
      : replacingCount == entries.length
          ? 'Replace'
          : 'Import';
  return '$verb ${_counted(entries.length, 'collection')}';
}

class _DialogContent extends StatelessWidget {
  const _DialogContent({required this.isLoading, required this.entries});

  final bool isLoading;
  final List<_ArchiveEntry>? entries;

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Row(
        children: [
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              semanticsLabel: 'Reading the archive',
            ),
          ),
          SizedBox(width: ViewerPalette.spaceMd),
          Expanded(child: Text('Reading the archive…')),
        ],
      );
    }

    final entries = this.entries;
    if (entries == null) {
      return const Text(
        'Importing replaces any collection on this device with the same name as a collection in the archive. Collections not in the archive stay as they are.',
      );
    }

    final replacingCount = entries.where((entry) => entry.replaces).length;
    return Semantics(
      container: true,
      liveRegion: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
              'This archive contains ${_counted(entries.length, 'collection')}.'),
          const SizedBox(height: ViewerPalette.spaceMd),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 220),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final (index, entry) in entries.indexed) ...[
                    if (index > 0)
                      const Divider(
                        height: 1,
                        color: ViewerPalette.borderSoft,
                      ),
                    _CollectionRow(entry: entry),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: ViewerPalette.spaceLg),
          Text(
            replacingCount > 0
                ? 'The collections marked "Replaces" are already on this device and will be replaced. Collections not in this archive stay as they are.'
                : 'Nothing on this device is replaced. These collections are new.',
            style: const TextStyle(
              color: ViewerPalette.textMuted,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

class _CollectionRow extends StatelessWidget {
  const _CollectionRow({required this.entry});

  final _ArchiveEntry entry;

  @override
  Widget build(BuildContext context) {
    final collection = entry.collection;
    return MergeSemantics(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: ViewerPalette.spaceSm),
        child: Row(
          children: [
            Expanded(
              child: Text(
                collection.name,
                style: const TextStyle(
                  color: ViewerPalette.text,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: ViewerPalette.spaceMd),
            Text(
              _counted(collection.noteCount, 'note'),
              style: const TextStyle(
                color: ViewerPalette.textMuted,
                fontSize: 12,
              ),
            ),
            const SizedBox(width: ViewerPalette.spaceMd),
            _OutcomeTag(replaces: entry.replaces),
          ],
        ),
      ),
    );
  }
}

class _OutcomeTag extends StatelessWidget {
  const _OutcomeTag({required this.replaces});

  final bool replaces;

  @override
  Widget build(BuildContext context) {
    final color = replaces ? ViewerPalette.danger : ViewerPalette.info;
    final wash = replaces ? ViewerPalette.dangerSoft : ViewerPalette.infoSoft;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wash,
        borderRadius: BorderRadius.circular(ViewerPalette.radiusPill),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        child: Text(
          replaces ? 'Replaces' : 'New',
          style: TextStyle(
            fontFamily: 'Inter',
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.4,
            color: color,
          ),
        ),
      ),
    );
  }
}
