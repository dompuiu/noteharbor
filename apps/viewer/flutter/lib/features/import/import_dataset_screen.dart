import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;

import '../../app/app_info.dart';
import '../../app/viewer_palette.dart';
import '../../data/dataset_controller.dart';
import '../../utils/dataset_date_format.dart';
import '../../widgets/viewer_button_styles.dart';
import 'archive_drop_zone.dart';
import 'import_archive_dialog.dart';

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

  /// A drop is a selection, not an import: the user still confirms the
  /// destructive import from the panel's Import archive button.
  void _handleDroppedArchive(String path, String name) {
    setState(() {
      _selectedArchivePath = path;
      _selectedArchiveName = name;
      _message = null;
      _messageIsError = false;
    });
  }

  void _reportDropProblem(String message) => _setStatus(message, true);

  Future<void> _importArchive() async {
    final archivePath = _selectedArchivePath;
    if (archivePath == null) {
      _setStatus('Choose an archive before importing.', true);
      return;
    }

    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => ImportArchiveDialog(
            fileName: _selectedArchiveName ?? p.basename(archivePath),
            peekArchive: () => widget.controller.peekArchive(archivePath),
            installedCollections:
                widget.controller.dataset?.collections ?? const [],
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
    } catch (_) {
      if (!mounted) {
        return;
      }
      _setStatus('Could not import the archive.', true);
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
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _collectionMessage = 'Could not delete the collection.';
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
              'This deletes the archive and all its collections from this device. You will need to import an archive again before browsing your notes.',
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
    } catch (_) {
      if (!mounted) {
        return;
      }
      _setStatus('Could not delete the archive.', true);
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
                title: const Text('IMPORT ARCHIVE'),
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
                              isPicking: _isPicking,
                              isImporting: widget.controller.isMutating,
                              onChoose: _pickArchive,
                              onDropped: _handleDroppedArchive,
                              onDropRejected: _reportDropProblem,
                              onImport: _importArchive,
                            )
                          else ...[
                            if (hasCollections) ...[
                              _Panel(
                                icon: Icons.inventory_2_outlined,
                                title: 'Archive on this device',
                                child: Wrap(
                                  spacing: 12,
                                  runSpacing: 12,
                                  children: [
                                    _InfoPill(
                                      label: 'Archive created',
                                      value: generatedAt == null || generatedAt.isEmpty
                                          ? 'Not recorded'
                                          : formatFriendlyDatasetBuiltAt(generatedAt),
                                    ),
                                    _InfoPill(
                                      label: 'Collections',
                                      value: '${collections.length}',
                                    ),
                                    _InfoPill(
                                      label: activeCollection == null
                                          ? 'Notes'
                                          : 'Notes in ${activeCollection.name}',
                                      value: '${activeCollection?.noteCount ?? 0}',
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
                                  ],
                                ),
                              ),
                              const SizedBox(height: 18),
                            ],
                            _Panel(
                              icon: Icons.archive_outlined,
                              title: 'Import archive',
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  ArchiveDropZone(
                                    fileName: _selectedArchiveName,
                                    isPicking: _isPicking,
                                    onChoose: isBusy ? null : _pickArchive,
                                    onDropped: _handleDroppedArchive,
                                    onDropRejected: _reportDropProblem,
                                  ),
                                  const SizedBox(height: 16),
                                  _ImportArchiveButton(
                                    enabled: !isBusy &&
                                        _selectedArchivePath != null,
                                    isImporting:
                                        widget.controller.isMutating,
                                    onPressed: _importArchive,
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
                              title: 'Remove',
                              subdued: true,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  if (activeCollection != null) ...[
                                    _RemoveRow(
                                      scope: 'Collection',
                                      detail:
                                          'Delete "${activeCollection.name}" and its notes and note images from this device.',
                                      actionLabel: 'Delete collection',
                                      onPressed: isBusy
                                          ? null
                                          : _deleteActiveCollection,
                                      message: _collectionMessage,
                                      messageIsError:
                                          _collectionMessageIsError,
                                    ),
                                    const Divider(
                                      height: 28,
                                      color: ViewerPalette.borderSoft,
                                    ),
                                  ],
                                  _RemoveRow(
                                    scope: 'Archive',
                                    detail:
                                        'Delete the archive and every collection in it from this device.',
                                    actionLabel: 'Delete archive',
                                    onPressed:
                                        isBusy ? null : _deleteImportedData,
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

/// The whole first-run page: one card, one action. The drop zone is the
/// picker; the primary pill imports the archive it selects.
class _FirstRunImportCard extends StatelessWidget {
  const _FirstRunImportCard({
    required this.fileName,
    required this.isBusy,
    required this.isPicking,
    required this.isImporting,
    required this.onChoose,
    required this.onDropped,
    required this.onDropRejected,
    required this.onImport,
  });

  final String? fileName;
  final bool isBusy;
  final bool isPicking;
  final bool isImporting;
  final VoidCallback onChoose;
  final ArchiveDroppedCallback onDropped;
  final ValueChanged<String> onDropRejected;
  final VoidCallback onImport;

  @override
  Widget build(BuildContext context) {
    final hasSelection = fileName != null;

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
          ArchiveDropZone(
            fileName: fileName,
            isPicking: isPicking,
            onChoose: isBusy ? null : onChoose,
            onDropped: onDropped,
            onDropRejected: onDropRejected,
          ),
          const SizedBox(height: 16),
          _ImportArchiveButton(
            enabled: !isBusy && hasSelection,
            isImporting: isImporting,
            onPressed: onImport,
          ),
        ],
      ),
    );
  }
}

class _ImportArchiveButton extends StatelessWidget {
  const _ImportArchiveButton({
    required this.enabled,
    required this.isImporting,
    required this.onPressed,
  });

  final bool enabled;
  final bool isImporting;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      onPressed: enabled && !isImporting ? onPressed : null,
      icon: const Icon(Icons.file_upload_outlined),
      label: Text(isImporting ? 'Importing...' : 'Import archive'),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({
    required this.child,
    this.icon,
    this.title,
    this.iconColor,
    this.subdued = false,
  });

  final Widget child;
  final IconData? icon;
  final String? title;
  final Color? iconColor;

  /// Quieter heading for a section that ranks below the page's main panels.
  final bool subdued;

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
                            fontSize: subdued ? 13 : 20,
                            fontWeight:
                                subdued ? FontWeight.w700 : FontWeight.w800,
                            letterSpacing: subdued ? 0.9 : -0.3,
                            color: subdued ? ViewerPalette.textMuted : null,
                          ),
                    ),
                  ),
                ],
              ),
              SizedBox(height: subdued ? 12 : 16),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

/// One scope inside the Remove section: what it deletes, the action, and the
/// action's own inline result.
class _RemoveRow extends StatelessWidget {
  const _RemoveRow({
    required this.scope,
    required this.detail,
    required this.actionLabel,
    required this.onPressed,
    this.message,
    this.messageIsError = false,
  });

  final String scope;
  final String detail;
  final String actionLabel;
  final VoidCallback? onPressed;
  final String? message;
  final bool messageIsError;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          scope.toUpperCase(),
          style: const TextStyle(
            fontFamily: 'Inter',
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.9,
            color: ViewerPalette.textMuted,
          ),
        ),
        const SizedBox(height: 6),
        Text(detail),
        const SizedBox(height: 12),
        FilledButton.tonal(
          onPressed: onPressed,
          style: ViewerButtonStyles.dangerTonal(),
          child: Text(actionLabel),
        ),
        if (message != null) ...[
          const SizedBox(height: 12),
          Text(
            message!,
            style: TextStyle(
              color: messageIsError
                  ? ViewerPalette.danger
                  : ViewerPalette.textMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
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
    return Semantics(
      liveRegion: true,
      container: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wash,
          borderRadius: BorderRadius.circular(ViewerPalette.radiusSm),
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
      ),
    );
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
