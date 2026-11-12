import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;

import '../../app/app_info.dart';
import '../../app/viewer_palette.dart';
import '../../data/dataset_controller.dart';
import '../../models/viewer_collection.dart';
import '../../utils/announce.dart';
import '../../utils/dataset_date_format.dart';
import '../../utils/reveal_in_folder.dart';
import '../../widgets/viewer_button_styles.dart';
import 'archive_drop_zone.dart';
import 'import_archive_dialog.dart';

/// The widest the import page's content grows: a readable measure on desktop
/// windows instead of panels that stretch across the whole window.
const double _kContentMaxWidth = 720;

/// The page's minimum padding on every edge.
const double _kPagePadding = 20;

/// The archive summary's own breakpoint: below it the cells stack into rows
/// instead of sharing one line.
const double _kArchiveSummaryBreakpoint = 480;

/// The one sentence each removal scope uses, shared by its row and its dialog.
String _collectionRemoval(String name) =>
    'Delete "$name" and all its notes and note images from this device.';

String _archiveRemoval() =>
    'Delete the archive and all its collections from this device.';

/// What the import screen says when an import fails: the reason the import
/// gave, without Dart's error-type prefixes, and the step that recovers.
String _importFailure(String error) {
  final reason = _plainReason(error);
  const recovery =
      'Choose the archive again and retry, or try a different archive.';
  if (reason == null) {
    return 'Could not import the archive. $recovery';
  }
  return 'Could not import the archive: $reason $recovery';
}

/// [error]'s message with `Bad state: `, `Exception: `, and the other Dart
/// error prefixes removed, ending in a full stop. Null when no reason is left:
/// a bodiless error or the store's own `Import failed.` fallback.
String? _plainReason(String error) {
  // Multi-line messages (FormatException source dumps) read as noise in a
  // banner; the first line carries what happened.
  var reason = error.trim().split('\n').first.trim();
  for (final prefix in const [
    'Bad state: ',
    'Exception: ',
    'Unsupported operation: ',
    'FormatException: ',
    'ArgumentError: ',
  ]) {
    if (reason.startsWith(prefix)) {
      reason = reason.substring(prefix.length).trim();
      break;
    }
  }

  // `Import failed.` is the store's fallback when its isolate returned no
  // error text; without this guard the banner repeats it after the colon.
  if (reason.isEmpty || reason == 'Import failed.' || _isBareError(reason)) {
    return null;
  }

  // Uppercase only an ASCII letter, so a non-BMP first character is never
  // split. Error messages are English, which is enough here.
  final first = reason.codeUnitAt(0);
  if (first >= 0x61 && first <= 0x7A) {
    reason = '${String.fromCharCode(first - 32)}${reason.substring(1)}';
  }
  return _endsSentence(reason) ? reason : '$reason.';
}

/// True when stripping the prefix left only the error's type name, e.g.
/// `Exception()` renders as `Exception`.
bool _isBareError(String text) {
  const bareTypes = {
    'Exception',
    'FormatException',
    'ArgumentError',
    'Unsupported operation',
    'Bad state',
  };
  return bareTypes.contains(text) ||
      RegExp(r"^Instance of '.*'$").hasMatch(text);
}

bool _endsSentence(String text) {
  return '.!?…'.contains(text[text.length - 1]);
}

/// One outcome banner: the sentence, its tone, and, after a successful import,
/// the collection the forward action opens.
class _StatusMessage {
  const _StatusMessage.success(this.message, {this.viewCollection})
      : isError = false;

  const _StatusMessage.error(this.message)
      : isError = true,
        viewCollection = null;

  final String message;
  final bool isError;
  final ViewerCollection? viewCollection;

  /// What a screen reader hears, including the action the sighted banner
  /// offers but an announcement alone cannot describe.
  String get announcement {
    final collection = viewCollection;
    if (!isError && collection != null) {
      return '$message View ${collection.name} to browse its notes.';
    }
    return message;
  }
}

class ImportDatasetScreen extends StatefulWidget {
  const ImportDatasetScreen({
    required this.controller,
    this.revealFolder = revealInFolder,
    super.key,
  });

  final DatasetController controller;

  /// Opens the imported archive's folder in the OS file manager. Tests
  /// replace this so the suite never opens a real window.
  final Future<bool> Function(String path) revealFolder;

  @override
  State<ImportDatasetScreen> createState() => _ImportDatasetScreenState();
}

class _ImportDatasetScreenState extends State<ImportDatasetScreen> {
  late final FocusNode _screenFocusNode = FocusNode(debugLabel: 'importScreen');
  late final FocusNode _importButtonFocusNode = FocusNode(
    debugLabel: 'importButton',
  );
  late final FocusNode _viewCollectionFocusNode = FocusNode(
    debugLabel: 'importViewCollection',
  );
  late final FocusNode _dismissStatusFocusNode = FocusNode(
    debugLabel: 'importStatusDismiss',
  );
  final ScrollController _scrollController = ScrollController();
  String? _selectedArchivePath;
  String? _selectedArchiveName;
  _StatusMessage? _status;
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
    _importButtonFocusNode.dispose();
    _viewCollectionFocusNode.dispose();
    _dismissStatusFocusNode.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// Shows an outcome banner and says it out loud: the banner is the visual
  /// half, and the announcement covers screen readers that never reach it.
  /// The caller decides where focus goes; this never scrolls mid-page.
  void _showStatus(_StatusMessage status) {
    setState(() => _status = status);
    announce(context, status.announcement);
  }

  /// A success banner belongs at the top of the page, so the forward action
  /// is on screen when it takes focus. Animations are skipped when the
  /// platform asks for reduced motion.
  void _showSuccess(String message, {ViewerCollection? collection}) {
    _showStatus(
      _StatusMessage.success(message, viewCollection: collection),
    );
    _afterFrame(() {
      (collection == null ? _dismissStatusFocusNode : _viewCollectionFocusNode)
          .requestFocus();
      if (!_scrollController.hasClients) {
        return;
      }
      _scrollController.animateTo(
        0,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  void _dismissStatus() {
    final wasError = _status?.isError ?? false;
    setState(() => _status = null);
    if (wasError) {
      _afterFrame(_importButtonFocusNode.requestFocus);
    }
  }

  void _afterFrame(VoidCallback action) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        action();
      }
    });
  }

  /// The table's forward action after a successful import: show the imported
  /// collection, then return to the table on it. A screen with nothing behind
  /// it (first run) is replaced by the table on its own, so maybePop is a
  /// no-op there.
  Future<void> _viewStatusCollection() async {
    final collection = _status?.viewCollection;
    if (collection != null) {
      await widget.controller.selectCollection(collection.id);
    }
    if (!mounted) {
      return;
    }
    await Navigator.of(context).maybePop();
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
    setState(() => _isPicking = true);

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
        _status = null;
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
      _status = null;
    });
  }

  void _reportDropProblem(String message) =>
      _showStatus(_StatusMessage.error(message));

  Future<void> _importArchive() async {
    final archivePath = _selectedArchivePath;
    if (archivePath == null) {
      _showStatus(
        const _StatusMessage.error('Choose an archive before importing.'),
      );
      return;
    }

    final importedCollections = await showDialog<List<ViewerCollection>>(
      context: context,
      builder: (context) => ImportArchiveDialog(
        fileName: _selectedArchiveName ?? p.basename(archivePath),
        peekArchive: () => widget.controller.peekArchive(archivePath),
        installedCollections:
            widget.controller.dataset?.collections ?? const [],
      ),
    );

    if (importedCollections == null || !mounted) {
      return;
    }
    // On first run the import screen is the whole app and the table replaces
    // it as soon as the dataset loads, so there is no table to go back to.
    final canReturnToTable = ModalRoute.of(context)?.canPop ?? false;

    setState(() {
      _isImporting = true;
      _status = null;
    });

    // Let the confirm dialog finish dismissing and the framework paint the
    // blocking import overlay before the import starts.
    await Future<void>.delayed(const Duration(milliseconds: 150));

    try {
      await widget.controller.importArchive(archivePath);
      if (!mounted) {
        return;
      }
      final importedName = _selectedArchiveName ?? p.basename(archivePath);
      final collection =
          canReturnToTable ? _collectionToView(importedCollections) : null;
      setState(() {
        _collectionMessage = null;
        _collectionMessageIsError = false;
      });
      _showSuccess('Imported $importedName.', collection: collection);
    } catch (error) {
      if (!mounted) {
        return;
      }
      _showStatus(_StatusMessage.error(_importFailure('$error')));
      // The retry button is where the failure came from; leave the page where
      // it is and hand the keyboard back to it.
      _afterFrame(_importButtonFocusNode.requestFocus);
    } finally {
      if (mounted) {
        setState(() => _isImporting = false);
      }
    }
  }

  /// The collection the forward action opens: the imported collection that is
  /// already active, else the archive's first collection now installed. Null
  /// when the archive's preview was unreadable, so no View action is offered
  /// for a collection the archive may not hold.
  ViewerCollection? _collectionToView(
    List<ViewerCollection> importedCollections,
  ) {
    final installedByName = {
      for (final collection
          in widget.controller.dataset?.collections ?? const [])
        collection.name.trim(): collection,
    };
    final active = widget.controller.activeCollection;
    if (active != null &&
        importedCollections.any(
          (collection) => collection.name.trim() == active.name.trim(),
        )) {
      return active;
    }
    for (final imported in importedCollections) {
      final match = installedByName[imported.name.trim()];
      if (match != null) {
        return match;
      }
    }
    return null;
  }

  /// Opens the installed archive's folder in the desktop's file manager.
  /// Only shown on desktop, so a failed launch is reported here rather than
  /// falling back to an in-app browser.
  Future<void> _showArchiveInFolder() async {
    final directory = await widget.controller.importedArchiveDirectory();
    if (!mounted) {
      return;
    }
    final revealed = directory != null && await widget.revealFolder(directory);
    if (!mounted || revealed) {
      return;
    }
    _showStatus(
      const _StatusMessage.error('Could not open the archive folder.'),
    );
  }

  Future<void> _deleteActiveCollection() async {
    final activeCollection = widget.controller.activeCollection;
    if (activeCollection == null) {
      return;
    }

    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Delete collection?'),
            content: Text('${_collectionRemoval(activeCollection.name)}?'),
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
        _collectionMessage = 'Deleted collection "${activeCollection.name}".';
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
            content: Text(
              '${_archiveRemoval()} You will need to import an archive again before browsing your notes.',
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
        _collectionMessage = null;
        _collectionMessageIsError = false;
      });
      _showSuccess('Deleted the archive. Import an archive to continue.');
    } catch (_) {
      if (!mounted) {
        return;
      }
      _showStatus(const _StatusMessage.error('Could not delete the archive.'));
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
    final platform = Theme.of(context).platform;
    final canShowInFolder =
        widget.controller.canManageImportedDatasets &&
        (platform == TargetPlatform.windows ||
            platform == TargetPlatform.macOS ||
            platform == TargetPlatform.linux);
    final windowWidth = MediaQuery.sizeOf(context).width;
    final gutter = (windowWidth - _kContentMaxWidth) / 2;
    final sideInset = gutter > _kPagePadding ? gutter : _kPagePadding;

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
                      final activeCollection =
                          widget.controller.activeCollection;
                      final isBusy = widget.controller.isMutating ||
                          _isPicking ||
                          _isImporting;
                      final hasCollections = collections.isNotEmpty;
                      final isFirstRun = dataset == null;
                      final status = _status;

                      Widget buildBanner(_StatusMessage status) =>
                          _StatusBanner(
                            status: status,
                            actionFocusNode: _viewCollectionFocusNode,
                            dismissFocusNode: _dismissStatusFocusNode,
                            onViewCollection: status.viewCollection == null
                                ? null
                                : _viewStatusCollection,
                            onDismiss: _dismissStatus,
                          );

                      final showInFolder = _ShowInFolderButton(
                        onPressed: isBusy ? null : _showArchiveInFolder,
                      );

                      return ListView(
                        controller: _scrollController,
                        padding: EdgeInsets.symmetric(
                          horizontal: sideInset,
                          vertical: _kPagePadding,
                        ),
                        children: [
                          if (status != null && !status.isError) ...[
                            buildBanner(status),
                            const SizedBox(height: 18),
                          ],
                          if (isFirstRun)
                            _FirstRunImportCard(
                              fileName: _selectedArchiveName,
                              isBusy: isBusy,
                              isPicking: _isPicking,
                              isImporting: widget.controller.isMutating,
                              importButtonFocusNode: _importButtonFocusNode,
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
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: [
                                    _ArchiveSummary(
                                      cells: [
                                        _SummaryCell(
                                          label: 'Archive created',
                                          value: generatedAt == null ||
                                                  generatedAt.isEmpty
                                              ? 'Not recorded'
                                              : formatFriendlyDatasetBuiltAt(
                                                  generatedAt,
                                                ),
                                        ),
                                        _SummaryCell(
                                          label: 'Collections',
                                          value: '${collections.length}',
                                        ),
                                      ],
                                    ),
                                    if (canShowInFolder) ...[
                                      const SizedBox(height: 12),
                                      showInFolder,
                                    ],
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
                                      key: ValueKey(
                                        'collection-${activeCollection?.id}',
                                      ),
                                      initialValue: activeCollection?.id,
                                      decoration: const InputDecoration(
                                        border: OutlineInputBorder(),
                                      ),
                                      items: collections
                                          .map(
                                            (
                                              collection,
                                            ) =>
                                                DropdownMenuItem<int>(
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
                                              widget.controller
                                                  .selectCollection(
                                                collectionId,
                                              );
                                              setState(() {
                                                _collectionMessage = null;
                                                _collectionMessageIsError =
                                                    false;
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
                                    enabled:
                                        !isBusy && _selectedArchivePath != null,
                                    isImporting: widget.controller.isMutating,
                                    focusNode: _importButtonFocusNode,
                                    onPressed: _importArchive,
                                  ),
                                  if (canShowInFolder && !hasCollections) ...[
                                    const SizedBox(height: 12),
                                    showInFolder,
                                  ],
                                ],
                              ),
                            ),
                          ],
                          if (status != null && status.isError) ...[
                            const SizedBox(height: 18),
                            buildBanner(status),
                          ],
                          if (!isFirstRun) ...[
                            const SizedBox(height: 18),
                            _Panel(
                              key: const ValueKey('removeSection'),
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
                                      detail: _collectionRemoval(
                                        activeCollection.name,
                                      ),
                                      onPressed: isBusy
                                          ? null
                                          : _deleteActiveCollection,
                                    ),
                                    const Divider(
                                      height: 28,
                                      color: ViewerPalette.borderSoft,
                                    ),
                                  ],
                                  _RemoveRow(
                                    scope: 'Archive',
                                    detail: _archiveRemoval(),
                                    onPressed:
                                        isBusy ? null : _deleteImportedData,
                                  ),
                                  if (_collectionMessage != null) ...[
                                    const SizedBox(height: 16),
                                    Semantics(
                                      liveRegion: true,
                                      child: Text(
                                        _collectionMessage!,
                                        style: TextStyle(
                                          color: _collectionMessageIsError
                                              ? ViewerPalette.danger
                                              : ViewerPalette.textMuted,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ],
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
              const ModalBarrier(dismissible: false, color: Color(0x8C000000)),
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
    required this.importButtonFocusNode,
    required this.onChoose,
    required this.onDropped,
    required this.onDropRejected,
    required this.onImport,
  });

  final String? fileName;
  final bool isBusy;
  final bool isPicking;
  final bool isImporting;
  final FocusNode importButtonFocusNode;
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
            focusNode: importButtonFocusNode,
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
    required this.focusNode,
    required this.onPressed,
  });

  final bool enabled;
  final bool isImporting;
  final FocusNode focusNode;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton.icon(
      onPressed: enabled && !isImporting ? onPressed : null,
      focusNode: focusNode,
      icon: const Icon(Icons.file_upload_outlined),
      label: Text(isImporting ? 'Importing...' : 'Import archive'),
    );
  }
}

/// Opens the installed archive's folder in the desktop's file manager.
class _ShowInFolderButton extends StatelessWidget {
  const _ShowInFolderButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      key: const ValueKey('showArchiveInFolder'),
      onPressed: onPressed,
      icon: const Icon(Icons.folder_open_outlined, size: 18),
      label: const Text('Show in folder'),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({
    required this.child,
    super.key,
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
        borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
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
                        ViewerPalette.radiusSm,
                      ),
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
                      style:
                          Theme.of(context).textTheme.headlineSmall?.copyWith(
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

/// One scope inside the Remove section: what it deletes and the action.
class _RemoveRow extends StatelessWidget {
  const _RemoveRow({
    required this.scope,
    required this.detail,
    required this.onPressed,
  });

  final String scope;
  final String detail;
  final VoidCallback? onPressed;

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
          child: Text('Delete ${scope.toLowerCase()}'),
        ),
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
                borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
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
                          ViewerPalette.radiusControl,
                        ),
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

/// One outcome banner: what happened, and the action that comes next. A
/// failure keeps its tone and copy until the import is retried or the user
/// dismisses it, so the page never changes its story while they read it.
class _StatusBanner extends StatelessWidget {
  const _StatusBanner({
    required this.status,
    required this.onDismiss,
    required this.dismissFocusNode,
    this.onViewCollection,
    this.actionFocusNode,
  });

  final _StatusMessage status;
  final VoidCallback onDismiss;
  final FocusNode dismissFocusNode;
  final VoidCallback? onViewCollection;
  final FocusNode? actionFocusNode;

  @override
  Widget build(BuildContext context) {
    final isError = status.isError;
    final accent = isError ? ViewerPalette.danger : ViewerPalette.success;
    final wash = isError ? ViewerPalette.dangerSoft : ViewerPalette.successSoft;
    final actionStyle = TextButton.styleFrom(
      foregroundColor: accent,
      textStyle: const TextStyle(
        fontFamily: 'Inter',
        fontWeight: FontWeight.w700,
      ),
    );
    final collectionName = status.viewCollection?.name;
    return Semantics(
      container: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: wash,
          borderRadius: BorderRadius.circular(ViewerPalette.radiusSm),
          border: Border.all(color: accent.withValues(alpha: 0.3), width: 1),
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
                padding: const EdgeInsets.fromLTRB(0, 6, 8, 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        status.message,
                        style: TextStyle(
                          fontFamily: 'Inter',
                          fontWeight: FontWeight.w600,
                          color: accent,
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        if (collectionName != null)
                          TextButton.icon(
                            key: const ValueKey('importOutcomeView'),
                            focusNode: actionFocusNode,
                            onPressed: onViewCollection,
                            style: actionStyle,
                            icon: const Icon(
                              Icons.arrow_forward_rounded,
                              size: 18,
                            ),
                            label: Text('View $collectionName'),
                          ),
                        TextButton(
                          key: const ValueKey('importOutcomeDismiss'),
                          focusNode: dismissFocusNode,
                          onPressed: onDismiss,
                          style: actionStyle,
                          child: const Text('Dismiss'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The archive's at-a-glance numbers as one inset strip: label/value cells on a
/// mist ground, split by hairlines instead of a pill per stat. The strip sizes
/// itself from its own available width, so it answers to the panel it sits in
/// rather than the window.
class _ArchiveSummary extends StatelessWidget {
  const _ArchiveSummary({required this.cells});

  /// The cells in reading order. The first takes twice the share of the row
  /// because its date value is the widest.
  final List<_SummaryCell> cells;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: _kContentMaxWidth),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final stacked = constraints.maxWidth < _kArchiveSummaryBreakpoint;
          final children = <Widget>[];
          for (var index = 0; index < cells.length; index++) {
            if (index > 0) {
              children.add(
                SizedBox(
                  height: stacked ? 1 : null,
                  width: stacked ? null : 1,
                  child: const ColoredBox(color: ViewerPalette.borderSoft),
                ),
              );
            }
            children.add(
              stacked
                  ? cells[index]
                  : Expanded(flex: index == 0 ? 2 : 1, child: cells[index]),
            );
          }

          return DecoratedBox(
            decoration: BoxDecoration(
              color: ViewerPalette.surfaceMist,
              borderRadius: BorderRadius.circular(ViewerPalette.radiusSm),
              border: Border.all(color: ViewerPalette.borderSoft),
            ),
            child: stacked
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: children,
                  )
                : IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: children,
                    ),
                  ),
          );
        },
      ),
    );
  }
}

/// One cell of the archive summary: a quiet label above its value. A screen
/// reader hears the pair as one `label: value` node, not two separate stops.
class _SummaryCell extends StatelessWidget {
  const _SummaryCell({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      excludeSemantics: true,
      label: '$label: $value',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label.toUpperCase(),
              // A scaled-up label may take two lines rather than clip.
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: FontWeight.w700,
                // 0.08em at 11px.
                letterSpacing: 0.88,
                height: 1.3,
                color: ViewerPalette.textMuted,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              value,
              maxLines: 1,
              softWrap: false,
              style: const TextStyle(
                fontFamily: 'Inter',
                fontSize: 16,
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
