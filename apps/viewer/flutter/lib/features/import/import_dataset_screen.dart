import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../data/dataset_controller.dart';
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
  bool _isPicking = false;

  Future<void> _pickArchive() async {
    setState(() {
      _isPicking = true;
      _message = null;
    });

    try {
      final result = await FilePicker.platform.pickFiles(
        dialogTitle: 'Choose Note Harbor archive',
        type: FileType.custom,
        allowedExtensions: const ['zip'],
      );

      final file = result?.files.single;
      if (file == null || file.path == null) {
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
      setState(() => _message = 'Choose an archive before importing.');
      return;
    }

    final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Import archive?'),
            content: const Text(
              'Importing an archive replaces the current imported dataset and pictures on this device.',
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

    try {
      await widget.controller.importArchive(archivePath);
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Imported $_selectedArchiveName successfully.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Import failed: $error';
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
      });
    } catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _message = 'Delete failed: $error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: widget.controller.dataset != null,
        title: const Text('Import Dataset'),
      ),
      body: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            colors: [Color(0xFFF3EADA), Color(0xFFE9DFCF), Color(0xFFDCE6DD)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        child: SafeArea(
          child: AnimatedBuilder(
            animation: widget.controller,
            builder: (context, _) {
              final dataset = widget.controller.dataset;
              final generatedAt = dataset?.generatedAt?.trim();
              final isBusy = widget.controller.isMutating || _isPicking;
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
                            color: Color(0xFF7A5D27),
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
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Manage viewer data',
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 10),
                        const Text(
                          'Import a Note Harbor archive exported from the editor. Imported data stays on this device and replaces the current imported dataset only.',
                        ),
                        const SizedBox(height: 18),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            _InfoPill(
                              label: 'Active source',
                              value: dataset?.source.label ?? 'No dataset imported',
                            ),
                            _InfoPill(
                              label: 'Dataset built',
                              value: generatedAt == null || generatedAt.isEmpty
                                  ? 'Not available yet'
                                  : formatFriendlyDatasetBuiltAt(generatedAt),
                            ),
                            _InfoPill(
                              label: 'Notes',
                              value: '${dataset?.noteCount ?? 0}',
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  _Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Archive import',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Choose a `.zip` archive with `banknotes.db` and `images/`, then import it into the native viewer app.',
                        ),
                        const SizedBox(height: 18),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF9F0),
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: const Color(0xFFBEAA8E)),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Row(
                              children: [
                                const Icon(Icons.archive_outlined, color: Color(0xFF7A5D27)),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    _selectedArchiveName ?? 'No archive selected',
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            OutlinedButton.icon(
                              onPressed: isBusy ? null : _pickArchive,
                              icon: const Icon(Icons.folder_open_rounded),
                              label: Text(_isPicking ? 'Choosing...' : 'Choose archive'),
                            ),
                            FilledButton.icon(
                              onPressed: isBusy || _selectedArchivePath == null ? null : _importArchive,
                              icon: const Icon(Icons.file_upload_outlined),
                              label: Text(widget.controller.isMutating ? 'Importing...' : 'Import archive'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Import is destructive for imported data: it replaces the current imported database and pictures on this device.',
                          style: TextStyle(color: Color(0xFF6A2E1A), fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  _Panel(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Delete imported data',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Delete the imported archive data from this device and return the app to its import-first state.',
                        ),
                        const SizedBox(height: 16),
                        FilledButton.tonalIcon(
                          onPressed: isBusy || dataset == null
                              ? null
                              : _deleteImportedData,
                          icon: const Icon(Icons.delete_outline_rounded),
                          label: const Text('Delete imported data'),
                        ),
                      ],
                    ),
                  ),
                  if (_message != null) ...[
                    const SizedBox(height: 18),
                    _Panel(
                      child: Text(
                        _message!,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFFFFCF7),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: const Color(0xFFBEAA8E), width: 1.5),
        boxShadow: const [
          BoxShadow(
            blurRadius: 24,
            offset: Offset(0, 14),
            color: Color(0x12000000),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: child,
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
        color: const Color(0xFFF5ECDE),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFBEAA8E)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: Theme.of(context)
                  .textTheme
                  .labelMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            Text(value),
          ],
        ),
      ),
    );
  }
}
