import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app_info.dart';
import '../../app/viewer_palette.dart';
import '../../data/dataset_controller.dart';
import '../../models/dataset_source.dart';
import '../../utils/dataset_date_format.dart';

class ImportDatasetScreen extends StatefulWidget {
  const ImportDatasetScreen({required this.controller, super.key});

  final DatasetController controller;

  @override
  State<ImportDatasetScreen> createState() => _ImportDatasetScreenState();
}

class _ImportDatasetScreenState extends State<ImportDatasetScreen> {
  String? _selectedArchivePath;
  String? _selectedArchiveName;
  String? _message;
  bool _messageIsError = false;
  bool _isPicking = false;
  bool _isImporting = false;

  Future<void> _pickArchive() async {
    setState(() {
      _isPicking = true;
      _message = null;
      _messageIsError = false;
    });

    try {
      final result = await FilePicker.pickFiles(
        dialogTitle: 'Choose Note Harbor archive',
        type: FileType.custom,
        allowedExtensions: const ['zip'],
      );

      if (result.isEmpty) {
        return;
      }
      final file = result.single;
      if (file.path == null) {
        return;
      }

      setState(() {
        _selectedArchivePath = file.path;
        _selectedArchiveName = file.name;
      });
    } finally {
      if (mounted) {
        setState(() => _isPicking = false);
      }
    }
  }

  Future<void> _importArchive() async {
    final archivePath = _selectedArchivePath;
    if (archivePath == null) {
      setState(() {
        _message = 'Choose an archive before importing.';
        _messageIsError = true;
      });
      return;
    }

    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Import archive?'),
            content: const Text(
              'Importing an archive replaces collections found in the archive (matched by name). Collections not present in the archive stay untouched on this device.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Import'),
              ),
            ],
          ),
        ) ??
        false;

    if (!confirmed) {
      return;
    }

    setState(() {
      _isImporting = true;
      _message = null;
      _messageIsError = false;
    });

    // Let the confirm dialog finish dismissing and give the framework a
    // chance to paint the blocking import overlay before the import below
    // monopolizes the UI thread with synchronous disk work.
    await Future<void>.delayed(const Duration(milliseconds: 150));

    try {
      await widget.controller.importArchive(archivePath);
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Imported $_selectedArchiveName successfully.';
        _messageIsError = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Import failed: $error';
        _messageIsError = true;
      });
    } finally {
      if (mounted) {
        setState(() => _isImporting = false);
      }
    }
  }

  Future<void> _setDefaultCollection() async {
    final activeCollection = widget.controller.activeCollection;
    if (activeCollection == null) return;
    await widget.controller.setDefaultCollection(activeCollection.id);
  }

  Future<void> _deleteActiveCollection() async {
    final activeCollection = widget.controller.activeCollection;
    if (activeCollection == null) {
      setState(() {
        _message = 'Select a collection to delete.';
        _messageIsError = true;
      });
      return;
    }

    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Delete collection?'),
            content: Text(
              'Delete "${activeCollection.name}" and all notes/images in that collection from this device?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                style: FilledButton.styleFrom(
                  backgroundColor: ViewerPalette.danger,
                  foregroundColor: ViewerPalette.onDanger,
                ),
                child: const Text('Delete'),
              ),
            ],
          ),
        ) ??
        false;

    if (!confirmed) {
      return;
    }

    try {
      await widget.controller.deleteCollection(activeCollection.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Deleted ${activeCollection.name}.';
        _messageIsError = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Delete failed: $error';
        _messageIsError = true;
      });
    }
  }

  Future<void> _deleteImportedData() async {
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Delete imported data?'),
            content: const Text(
              'This removes the imported archive from this device. You will need to import another archive before browsing notes again.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                style: FilledButton.styleFrom(
                  backgroundColor: ViewerPalette.danger,
                  foregroundColor: ViewerPalette.onDanger,
                ),
                child: const Text('Delete'),
              ),
            ],
          ),
        ) ??
        false;

    if (!confirmed) {
      return;
    }

    try {
      await widget.controller.deleteImportedDataset();
      if (!mounted) {
        return;
      }
      setState(() {
        _selectedArchivePath = null;
        _selectedArchiveName = null;
        _message = 'Imported data deleted. Import another archive to continue.';
        _messageIsError = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Delete failed: $error';
        _messageIsError = true;
      });
    }
  }

  /// Leaves the import screen on Escape, matching the table screen's Escape
  /// handling. Confirm dialogs handle their own Escape before it reaches here,
  /// and [Navigator.maybePop] is a no-op when this is the only route (first
  /// run) or while an import is in progress (`PopScope`).
  KeyEventResult _handleKeyEvent(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    if (event.logicalKey != LogicalKeyboardKey.escape) {
      return KeyEventResult.ignored;
    }
    Navigator.of(context).maybePop();
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: _handleKeyEvent,
      child: PopScope(
        canPop: !_isImporting,
        child: Stack(
        children: [
          Scaffold(
            appBar: AppBar(
              automaticallyImplyLeading:
                  !_isImporting && (widget.controller.dataset?.collections.isNotEmpty ?? false),
              title: const Text('Import Dataset'),
            ),
            body: DecoratedBox(
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
          child: AnimatedBuilder(
            animation: widget.controller,
            builder: (context, _) {
              final dataset = widget.controller.dataset;
              final generatedAt = dataset?.generatedAt?.trim();
              final collections = dataset?.collections ?? const [];
              final activeCollection = widget.controller.activeCollection;
              final isBusy = widget.controller.isMutating || _isPicking || _isImporting;
              final isInitialEmptyState = dataset == null;

              return ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (isInitialEmptyState) ...[
                    _Panel(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline_rounded,
                            color: ViewerPalette.accent,
                            size: 28,
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Import data to get started',
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleLarge
                                      ?.copyWith(fontWeight: FontWeight.w800),
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'This viewer no longer ships with a bundled dataset. Choose a Note Harbor archive exported from the editor to install your notes, pictures, and SQLite database on this device.',
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                  ],
                  _Panel(
                    icon: Icons.inventory_2_outlined,
                    title: 'Manage viewer data',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Import a Note Harbor archive exported from the editor. Imported data stays on this device. Collections present in the archive replace matching local collections by name; other local collections stay untouched.',
                        ),
                        const SizedBox(height: 18),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            _InfoPill(
                              label: 'Active source',
                              value: dataset?.source.label ??
                                  'No dataset imported',
                            ),
                            _InfoPill(
                              label: 'Dataset built',
                              value: generatedAt == null || generatedAt.isEmpty
                                  ? 'Not available yet'
                                  : formatFriendlyDatasetBuiltAt(generatedAt),
                            ),
                            _InfoPill(
                              label: 'Collections',
                              value: '${collections.length}',
                            ),
                            _InfoPill(
                              label: 'Notes (active)',
                              value: '${activeCollection?.noteCount ?? 0}',
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (collections.isNotEmpty) ...[
                    _Panel(
                      icon: Icons.collections_bookmark_outlined,
                      title: 'Active collection',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Select which collection is shown in the table and slideshow screens.',
                          ),
                          const SizedBox(height: 14),
                          DropdownButtonFormField<int>(
                            initialValue: activeCollection?.id,
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                            ),
                            items: collections
                                .map(
                                  (collection) => DropdownMenuItem<int>(
                                    value: collection.id,
                                    child: Text(
                                      '${collection.name}${collection.isDefault ? ' (default)' : ''} (${collection.noteCount})',
                                    ),
                                  ),
                                )
                                .toList(growable: false),
                            onChanged: isBusy
                                ? null
                                : (collectionId) {
                                    if (collectionId == null) {
                                      return;
                                    }
                                    widget.controller.selectCollection(collectionId);
                                    setState(() => _message = null);
                                  },
                          ),
                          const SizedBox(height: 14),
                          FilledButton.tonal(
                            onPressed: isBusy || activeCollection == null || activeCollection.isDefault
                                ? null
                                : _setDefaultCollection,
                            child: const Text('Set as default collection'),
                          ),
                          const SizedBox(height: 8),
                          FilledButton.tonal(
                            onPressed: isBusy || activeCollection == null
                                ? null
                                : _deleteActiveCollection,
                            style: FilledButton.styleFrom(
                              backgroundColor: ViewerPalette.dangerSoft,
                              foregroundColor: ViewerPalette.danger,
                            ),
                            child: const Text('Delete active collection'),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                  ],
                  _Panel(
                    icon: Icons.archive_outlined,
                    title: 'Archive import',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Choose a `.zip` archive with `banknotes.db` and `images/`, then import it into the native viewer app.',
                        ),
                        const SizedBox(height: 18),
                        _ArchiveDropZone(
                          fileName: _selectedArchiveName,
                          onTap: isBusy ? null : _pickArchive,
                        ),
                        const SizedBox(height: 16),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            OutlinedButton.icon(
                              onPressed: isBusy ? null : _pickArchive,
                              icon: const Icon(Icons.folder_open_rounded),
                              label: Text(_isPicking
                                  ? 'Choosing...'
                                  : 'Choose archive'),
                            ),
                            FilledButton.icon(
                              onPressed: isBusy || _selectedArchivePath == null
                                  ? null
                                  : _importArchive,
                              icon: const Icon(Icons.file_upload_outlined),
                              label: Text(widget.controller.isMutating
                                  ? 'Importing...'
                                  : 'Import archive'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Import is destructive for collections present in the archive: matching local collections are replaced from archive data.',
                          style: TextStyle(
                              color: ViewerPalette.danger,
                              fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  _Panel(
                    icon: Icons.delete_forever_outlined,
                    iconColor: ViewerPalette.danger,
                    title: 'Delete imported data',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Delete the imported archive data from this device and return the app to its import-first state.',
                        ),
                        const SizedBox(height: 16),
                        FilledButton.tonalIcon(
                          onPressed: isBusy || dataset == null
                              ? null
                              : _deleteImportedData,
                          style: FilledButton.styleFrom(
                            backgroundColor: ViewerPalette.dangerSoft,
                            foregroundColor: ViewerPalette.danger,
                          ),
                          icon: const Icon(Icons.delete_outline_rounded),
                          label: const Text('Delete imported data'),
                        ),
                      ],
                    ),
                  ),
                  if (_message != null) ...[
                    const SizedBox(height: 18),
                    _StatusBanner(
                      message: _message!,
                      isError: _messageIsError,
                    ),
                  ],
                  const SizedBox(height: 24),
                  const Center(
                    child: Text(
                      'Note Harbor Viewer v${AppInfo.version}',
                      style: TextStyle(
                        color: ViewerPalette.textMuted,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
          ),
          if (_isImporting)
            const ModalBarrier(
              dismissible: false,
              color: Colors.black54,
            ),
          if (_isImporting)
            Center(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: ViewerPalette.surface,
                  borderRadius: BorderRadius.circular(
                      ViewerPalette.radiusXl),
                  border: Border.all(color: ViewerPalette.border),
                  boxShadow: ViewerPalette.shadowHigh,
                ),
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: ViewerPalette.accentSoft,
                          borderRadius: BorderRadius.circular(
                              ViewerPalette.radiusLg),
                        ),
                        child: const Padding(
                          padding: EdgeInsets.all(14),
                          child: CircularProgressIndicator(),
                        ),
                      ),
                      const SizedBox(height: 18),
                      const Text(
                        'Importing archive…',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                      if (_selectedArchiveName != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _selectedArchiveName!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            color: ViewerPalette.textMuted,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child, this.icon, this.title, this.iconColor});

  final Widget child;
  final IconData? icon;
  final String? title;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final resolvedTitle = title;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ViewerPalette.surface,
        borderRadius:
            BorderRadius.circular(ViewerPalette.radiusXl),
        border: Border.all(color: ViewerPalette.border, width: 1),
        boxShadow: ViewerPalette.shadowMid,
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null && resolvedTitle != null) ...[
              Row(
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: ViewerPalette.accentSoft,
                      borderRadius: BorderRadius.circular(
                          ViewerPalette.radiusSm),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: Icon(
                        icon,
                        size: 20,
                        color: iconColor ?? ViewerPalette.accentStrong,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      resolvedTitle,
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(fontSize: 21),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: ViewerPalette.accent,
                  borderRadius: BorderRadius.circular(2),
                ),
                child: const SizedBox(height: 3, width: 40),
              ),
              const SizedBox(height: 14),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.message, required this.isError});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final accent = isError ? ViewerPalette.danger : ViewerPalette.success;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ViewerPalette.surface,
        borderRadius:
            BorderRadius.circular(ViewerPalette.radiusLg),
        border: Border.all(color: ViewerPalette.border, width: 1),
        boxShadow: ViewerPalette.shadowLow,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: accent,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(ViewerPalette.radiusLg - 1),
                bottomLeft: Radius.circular(ViewerPalette.radiusLg - 1),
              ),
            ),
            child: const SizedBox(width: 5),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Icon(
              isError
                  ? Icons.error_outline_rounded
                  : Icons.check_circle_outline_rounded,
              color: accent,
              size: 22,
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 14, 16, 14),
              child: Text(
                message,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ArchiveDropZone extends StatelessWidget {
  const _ArchiveDropZone({required this.fileName, required this.onTap});

  final String? fileName;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final selected = fileName != null;
    return GestureDetector(
      onTap: onTap,
      child: MouseRegion(
        cursor: onTap == null
            ? MouseCursor.defer
            : SystemMouseCursors.click,
        child: CustomPaint(
          painter: _DashedBorderPainter(
            color: selected
                ? ViewerPalette.accent
                : ViewerPalette.borderControl,
            radius: ViewerPalette.radiusLg,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: selected
                  ? ViewerPalette.accentSoft.withValues(alpha: 0.5)
                  : ViewerPalette.surfaceContainer
                      .withValues(alpha: 0.45),
              borderRadius:
                  BorderRadius.circular(ViewerPalette.radiusLg),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: ViewerPalette.surface,
                      borderRadius: BorderRadius.circular(
                          ViewerPalette.radiusSm),
                      border:
                          Border.all(color: ViewerPalette.border),
                    ),
                    child: const Padding(
                      padding: EdgeInsets.all(10),
                      child: Icon(
                        Icons.archive_outlined,
                        color: ViewerPalette.accent,
                        size: 22,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          fileName ?? 'No archive selected',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontWeight: FontWeight.w700,
                            color: selected
                                ? ViewerPalette.text
                                : ViewerPalette.textMuted,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          selected
                              ? 'Ready to import'
                              : 'Tap to choose a .zip archive',
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 12,
                            color: ViewerPalette.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      color: selected
                          ? ViewerPalette.accentStrong
                          : ViewerPalette.surfaceContainer,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: selected
                            ? ViewerPalette.accentStrong
                            : ViewerPalette.border,
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 4),
                      child: Text(
                        'ZIP',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.0,
                          color: selected
                              ? ViewerPalette.surface
                              : ViewerPalette.textMuted,
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
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  const _DashedBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(rect, Radius.circular(radius));
    const dashWidth = 7.0;
    const dashGap = 5.0;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.5
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
  bool shouldRepaint(covariant _DashedBorderPainter oldDelegate) {
    return oldDelegate.color != color || oldDelegate.radius != radius;
  }
}
class _InfoPill extends StatelessWidget {
  const _InfoPill({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: ViewerPalette.surfaceContainer.withValues(alpha: 0.6),
        borderRadius:
            BorderRadius.circular(ViewerPalette.radiusLg),
        border: Border.all(color: ViewerPalette.border),
        boxShadow: ViewerPalette.shadowLow,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
                color: ViewerPalette.accentStrong,
                height: 1,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              value,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontWeight: FontWeight.w700,
                color: ViewerPalette.text,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
