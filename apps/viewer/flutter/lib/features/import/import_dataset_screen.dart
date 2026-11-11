import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app_info.dart';
import '../../app/viewer_palette.dart';
import '../../data/dataset_controller.dart';
import '../../utils/dataset_date_format.dart';
import '../../widgets/viewer_button_styles.dart';

class ImportDatasetScreen extends StatefulWidget {
  const ImportDatasetScreen({required this.controller, super.key});

  final DatasetController controller;

  @override
  State<ImportDatasetScreen> createState() => _ImportDatasetScreenState();
}

class _ImportDatasetScreenState extends State<ImportDatasetScreen> {
  late final FocusNode _screenFocusNode =
      FocusNode(debugLabel: 'importScreen');
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _statusKey = GlobalKey();
  String? _selectedArchivePath;
  String? _selectedArchiveName;
  String? _message;
  bool _messageIsError = false;
  String? _collectionMessage;
  bool _collectionMessageIsError = false;
  bool _isPicking = false;
  bool _isImporting = false;

  @override
  void initState() {
    super.initState();
    FocusManager.instance.addListener(_handleFocusDrain);
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_handleFocusDrain);
    _screenFocusNode.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _setStatus(String? message, bool isError) {
    setState(() {
      _message = message;
      _messageIsError = isError;
    });
    if (message != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final context = _statusKey.currentContext;
        if (context != null) {
          Scrollable.ensureVisible(
            context,
            duration: const Duration(milliseconds: 250),
            alignment: 0.5,
          );
        }
      });
    }
  }

  /// Mirrors the table screen's drain guard: after a table→import swap the
  /// exiting table takes focus with it, which would leave this screen's
  /// Escape handling dead. Pushed dialogs make this route non-current, so
  /// confirm dialogs are never disturbed.
  void _handleFocusDrain() {
    if (!mounted) {
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
    _screenFocusNode.requestFocus();
  }

  Future<void> _pickArchive() async {
    setState(() {
      _isPicking = true;
      _message = null;
      _messageIsError = false;
    });

    try {
      final result = await FilePicker.pickFiles(
        dialogTitle: 'Choose a Note Harbor archive',
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
      _setStatus('Choose an archive before importing.', true);
      return;
    }

    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Import this archive?'),
            content: const Text(
              'Importing replaces any collection on this device that shares a name with one in the archive. Collections not in the archive stay as they are.',
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
      _setStatus('Imported $_selectedArchiveName.', false);
    } catch (error) {
      if (!mounted) {
        return;
      }
      _setStatus('Could not import the archive: $error', true);
    } finally {
      if (mounted) {
        setState(() => _isImporting = false);
      }
    }
  }

  Future<void> _deleteActiveCollection() async {
    final activeCollection = widget.controller.activeCollection;
    if (activeCollection == null) {
      setState(() {
        _collectionMessage = 'Choose a collection to delete.';
        _collectionMessageIsError = true;
      });
      return;
    }

    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Delete collection?'),
            content: Text(
              'Delete "${activeCollection.name}" and all its notes and note images from this device?',
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
      await widget.controller.deleteCollection(
        activeCollection.id,
        collectionName: activeCollection.name,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _collectionMessage = 'Deleted ${activeCollection.name}.';
        _collectionMessageIsError = false;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _collectionMessage = 'Could not delete the collection: $error';
        _collectionMessageIsError = true;
      });
    }
  }

  Future<void> _deleteImportedData() async {
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Delete archive?'),
            content: const Text(
              'This deletes the archive and its notes from this device. You will need to import an archive again before browsing your notes.',
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
      });
      _setStatus('Deleted the archive. Import an archive to continue.', false);
    } catch (error) {
      if (!mounted) {
        return;
      }
      _setStatus('Could not delete the archive: $error', true);
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
      focusNode: _screenFocusNode,
      autofocus: true,
      onKeyEvent: _handleKeyEvent,
      child: PopScope(
        canPop: !_isImporting,
        child: Stack(
          children: [
            Scaffold(
              appBar: AppBar(
                automaticallyImplyLeading: !_isImporting &&
                    (widget.controller.dataset?.collections.isNotEmpty ??
                        false),
                title: const Text('IMPORT'),
              ),
              body: ColoredBox(
                color: ViewerPalette.pageBackground,
                child: SafeArea(
                  child: AnimatedBuilder(
                    animation: widget.controller,
                    builder: (context, _) {
                      final dataset = widget.controller.dataset;
                      final generatedAt = dataset?.generatedAt?.trim();
                      final collections = dataset?.collections ?? const [];
                      final activeCollection = widget.controller.activeCollection;
                      final isBusy = widget.controller.isMutating || _isPicking || _isImporting;
                      final hasCollections = collections.isNotEmpty;
                      final isFirstRun = dataset == null;

                      return ListView(
                        controller: _scrollController,
                        padding: const EdgeInsets.all(20),
                        children: [
                          if (isFirstRun)
                            _FirstRunImportCard(
                              fileName: _selectedArchiveName,
                              isBusy: isBusy,
                              busyLabel: _isPicking
                                  ? 'Choosing...'
                                  : widget.controller.isMutating
                                      ? 'Importing...'
                                      : null,
                              onChoose: _pickArchive,
                              onImport: _importArchive,
                            )
                          else ...[
                            if (hasCollections) ...[
                              _Panel(
                                icon: Icons.inventory_2_outlined,
                                title: 'Archive on this device',
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Wrap(
                                      spacing: 12,
                                      runSpacing: 12,
                                      children: [
                                        _InfoPill(
                                          label: 'Archive created',
                                          value: generatedAt == null || generatedAt.isEmpty
                                              ? 'Unknown'
                                              : formatFriendlyDatasetBuiltAt(generatedAt),
                                        ),
                                        _InfoPill(
                                          label: 'Collections',
                                          value: '${collections.length}',
                                        ),
                                        _InfoPill(
                                          label: 'Notes',
                                          value: '${activeCollection?.noteCount ?? 0}',
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 18),
                              _Panel(
                                icon: Icons.collections_bookmark_outlined,
                                title: 'Active collection',
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      'Choose the collection shown in the table and the note slideshow.',
                                    ),
                                    const SizedBox(height: 14),
                                    DropdownButtonFormField<int>(
                                      key: ValueKey('collection-${activeCollection?.id}'),
                                      initialValue: activeCollection?.id,
                                      decoration: const InputDecoration(
                                        border: OutlineInputBorder(),
                                      ),
                                      items: collections
                                          .map(
                                            (collection) => DropdownMenuItem<int>(
                                              value: collection.id,
                                              child: Text(
                                                '${collection.name} (${collection.noteCount})',
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
                                              setState(() {
                                                _message = null;
                                                _collectionMessage = null;
                                                _collectionMessageIsError = false;
                                              });
                                            },
                                    ),
                                    const SizedBox(height: 14),
                                    FilledButton.tonal(
                                      onPressed: isBusy || activeCollection == null
                                          ? null
                                          : _deleteActiveCollection,
                                      style: ViewerButtonStyles.dangerTonal(),
                                      child: const Text('Delete collection'),
                                    ),
                                    if (_collectionMessage != null) ...[
                                      const SizedBox(height: 12),
                                      Text(
                                        _collectionMessage!,
                                        style: TextStyle(
                                          color: _collectionMessageIsError
                                              ? ViewerPalette.danger
                                              : ViewerPalette.textMuted,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                              const SizedBox(height: 18),
                            ],
                            _Panel(
                              icon: Icons.archive_outlined,
                              title: 'Import an archive',
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
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
                                ],
                              ),
                            ),
                          ],
                          if (_message != null) ...[
                            const SizedBox(height: 18),
                            _StatusBanner(
                              key: _statusKey,
                              message: _message!,
                              isError: _messageIsError,
                            ),
                          ],
                          if (!isFirstRun) ...[
                            const SizedBox(height: 18),
                            _Panel(
                              icon: Icons.delete_forever_outlined,
                              iconColor: ViewerPalette.danger,
                              title: 'Delete archive',
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Delete the archive and its notes from this device.',
                                  ),
                                  const SizedBox(height: 16),
                                  FilledButton.tonalIcon(
                                    onPressed: isBusy ? null : _deleteImportedData,
                                    style: ViewerButtonStyles.dangerTonal(),
                                    icon: const Icon(Icons.delete_outline_rounded),
                                    label: const Text('Delete archive'),
                                  ),
                                ],
                              ),
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
                color: Color(0x8C000000),
              ),
            if (_isImporting)
              _ImportProgressOverlay(archiveName: _selectedArchiveName),
          ],
        ),
      ),
    );
  }
}

/// The whole first-run page: one card, one action. Before an archive is
/// chosen the primary pill opens the picker; afterwards it imports.
class _FirstRunImportCard extends StatelessWidget {
  const _FirstRunImportCard({
    required this.fileName,
    required this.isBusy,
    required this.busyLabel,
    required this.onChoose,
    required this.onImport,
  });

  final String? fileName;
  final bool isBusy;
  final String? busyLabel;
  final VoidCallback onChoose;
  final VoidCallback onImport;

  @override
  Widget build(BuildContext context) {
    final hasSelection = fileName != null;
    final label =
        busyLabel ?? (hasSelection ? 'Import archive' : 'Choose archive');

    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'GET STARTED',
            style: TextStyle(
              fontFamily: 'Inter',
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.1,
              color: ViewerPalette.accentStrong,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'BRING YOUR NOTES IN',
            style: Theme.of(context)
                .textTheme
                .headlineSmall
                ?.copyWith(fontSize: 24),
          ),
          const SizedBox(height: 10),
          const Text(
            'Choose the archive you exported from Note Harbor Editor.',
          ),
          const SizedBox(height: 20),
          _ArchiveDropZone(
            fileName: fileName,
            onTap: isBusy ? null : onChoose,
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: isBusy ? null : (hasSelection ? onImport : onChoose),
            icon: Icon(
              hasSelection
                  ? Icons.file_upload_outlined
                  : Icons.folder_open_rounded,
            ),
            label: Text(label),
          ),
        ],
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
            BorderRadius.circular(ViewerPalette.radiusMd),
        border: Border.all(color: ViewerPalette.border, width: 1),
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
                      color: ViewerPalette.surfaceMist,
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
                      resolvedTitle.toUpperCase(),
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.3,
                          ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

class _ImportProgressOverlay extends StatelessWidget {
  const _ImportProgressOverlay({this.archiveName});

  final String? archiveName;

  @override
  Widget build(BuildContext context) {
    // Material ancestor required: this overlay sits beside (not inside) the
    // Scaffold, so without Material the Texts fall back to the debug style
    // with a yellow underline.
    return Material(
      type: MaterialType.transparency,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(ViewerPalette.spaceXl),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: ViewerPalette.surface,
                borderRadius: BorderRadius.circular(
                    ViewerPalette.radiusMd),
                border: Border.all(color: ViewerPalette.border),
                boxShadow: ViewerPalette.shadowHigh,
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: ViewerPalette.surfaceMist,
                        borderRadius: BorderRadius.circular(
                            ViewerPalette.radiusControl),
                      ),
                      child: const SizedBox(
                        width: 64,
                        height: 64,
                        child: Padding(
                          padding: EdgeInsets.all(18),
                          child: CircularProgressIndicator(
                            strokeWidth: 3,
                            color: ViewerPalette.accent,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    const Text(
                      'IMPORTING ARCHIVE…',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: 'Inter',
                        fontWeight: FontWeight.w800,
                        fontSize: 18,
                        letterSpacing: -0.2,
                        color: ViewerPalette.text,
                      ),
                    ),
                    if (archiveName != null) ...[
                      const SizedBox(height: 6),
                      Text(
                        archiveName!,
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: 'Inter',
                          fontSize: 13,
                          color: ViewerPalette.textMuted,
                        ),
                      ),
                    ],
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

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({super.key, required this.message, required this.isError});

  final String message;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final accent = isError ? ViewerPalette.danger : ViewerPalette.success;
    final wash =
        isError ? ViewerPalette.dangerSoft : ViewerPalette.successSoft;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: wash,
        borderRadius:
            BorderRadius.circular(ViewerPalette.radiusSm),
        border: Border.all(
          color: accent.withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              color: accent,
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(ViewerPalette.radiusSm - 1),
                bottomLeft: Radius.circular(ViewerPalette.radiusSm - 1),
              ),
            ),
            child: const SizedBox(width: 3),
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
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontWeight: FontWeight.w600,
                  color: accent,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ArchiveDropZone extends StatefulWidget {
  const _ArchiveDropZone({required this.fileName, required this.onTap});

  final String? fileName;
  final VoidCallback? onTap;

  @override
  State<_ArchiveDropZone> createState() => _ArchiveDropZoneState();
}

class _ArchiveDropZoneState extends State<_ArchiveDropZone> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final fileName = widget.fileName;
    final onTap = widget.onTap;
    final selected = fileName != null;
    final interactive = onTap != null;
    final hovered = interactive && _hovered;

    final borderColor = selected
        ? ViewerPalette.accent
        : hovered
            ? ViewerPalette.accent.withValues(alpha: 0.55)
            : ViewerPalette.borderControl;
    final fillColor = selected
        ? ViewerPalette.accentSoft
        : hovered
            ? ViewerPalette.surfaceStep
            : ViewerPalette.surfaceMist;

    return Semantics(
      button: true,
      label: selected
          ? 'Selected archive $fileName. Choose a different archive'
          : 'Choose an archive',
      child: GestureDetector(
        onTap: onTap,
        child: MouseRegion(
          cursor: interactive
              ? SystemMouseCursors.click
              : MouseCursor.defer,
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() => _hovered = false),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            curve: Curves.easeOut,
            decoration: BoxDecoration(
              color: fillColor,
              borderRadius:
                  BorderRadius.circular(ViewerPalette.radiusControl),
            ),
            child: CustomPaint(
              painter: _DashedBorderPainter(
                color: borderColor,
                radius: ViewerPalette.radiusControl,
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
                            fileName ?? 'No archive chosen',
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
                                : 'A Note Harbor archive',
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
                            : ViewerPalette.surface,
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
                                ? ViewerPalette.onAccent
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
        color: ViewerPalette.surface,
        borderRadius:
            BorderRadius.circular(ViewerPalette.radiusPill),
        border: Border.all(color: ViewerPalette.borderControl),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.9,
                color: ViewerPalette.textMuted,
                height: 1,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              value,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontWeight: FontWeight.w600,
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
