import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/note_record.dart';
import 'image_lightbox.dart';

class NoteSlideshowScreen extends StatefulWidget {
  const NoteSlideshowScreen({
    required this.notes,
    required this.initialIndex,
    super.key,
  });

  final List<NoteRecord> notes;
  final int initialIndex;

  @override
  State<NoteSlideshowScreen> createState() => _NoteSlideshowScreenState();
}

class _NoteSlideshowScreenState extends State<NoteSlideshowScreen> {
  late final PageController _pageController;
  late final List<ImageSequenceItem> _imageSequence;
  late int _currentIndex;

  void _jump(int nextIndex) {
    _pageController.animateToPage(
      nextIndex,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  void _goPrevious() {
    if (widget.notes.isEmpty) {
      return;
    }

    _jump((_currentIndex - 1 + widget.notes.length) % widget.notes.length);
  }

  void _goNext() {
    if (widget.notes.isEmpty) {
      return;
    }

    _jump((_currentIndex + 1) % widget.notes.length);
  }

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
    _imageSequence = _buildImageSequence(widget.notes);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  List<ImageSequenceItem> _buildImageSequence(List<NoteRecord> notes) {
    final items = <ImageSequenceItem>[];

    for (final note in notes) {
      final front = note.fullFor('front');
      final back = note.fullFor('back');

      if (front != null) {
        items.add(ImageSequenceItem(note: note, image: front));
      }
      if (back != null) {
        items.add(ImageSequenceItem(note: note, image: back));
      }
    }

    return items;
  }

  void _openImageViewer(NoteRecord note, String type) {
    final targetImage = note.fullFor(type);
    if (targetImage == null || _imageSequence.isEmpty) {
      return;
    }

    final initialIndex = _imageSequence.indexWhere(
      (item) => item.note.id == note.id && item.image.type == targetImage.type,
    );

    if (initialIndex < 0) {
      return;
    }

    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => ImageLightbox(
          items: _imageSequence,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.escape): DismissIntent(),
        SingleActivator(LogicalKeyboardKey.arrowLeft): _PreviousSlideIntent(),
        SingleActivator(LogicalKeyboardKey.arrowRight): _NextSlideIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          DismissIntent: CallbackAction<DismissIntent>(
            onInvoke: (intent) {
              Navigator.of(context).maybePop();
              return null;
            },
          ),
          _PreviousSlideIntent: CallbackAction<_PreviousSlideIntent>(
            onInvoke: (intent) {
              _goPrevious();
              return null;
            },
          ),
          _NextSlideIntent: CallbackAction<_NextSlideIntent>(
            onInvoke: (intent) {
              _goNext();
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: Scaffold(
            backgroundColor: const Color(0xFF18120D),
            body: DecoratedBox(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0xFF18120D),
                    Color(0xFF23180F),
                    Color(0xFF2B1D12)
                  ],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(4, 4, 4, 12),
                        child: Row(
                          children: [
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                '${_currentIndex + 1} / ${widget.notes.length}',
                                style: Theme.of(context)
                                    .textTheme
                                    .titleMedium
                                    ?.copyWith(
                                      color: const Color(0xFFFFF5E9),
                                      fontWeight: FontWeight.w600,
                                    ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            FilledButton.tonal(
                              style: FilledButton.styleFrom(
                                backgroundColor:
                                    Colors.white.withValues(alpha: 0.08),
                                foregroundColor: const Color(0xFFFFF5E9),
                              ),
                              onPressed: () => Navigator.of(context).pop(),
                              child: const Text('Back'),
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: PageView.builder(
                          controller: _pageController,
                          itemCount: widget.notes.length,
                          onPageChanged: (value) =>
                              setState(() => _currentIndex = value),
                          itemBuilder: (context, index) {
                            final note = widget.notes[index];

                            return Padding(
                              padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
                              child: Center(
                                child: ConstrainedBox(
                                  constraints:
                                      const BoxConstraints(maxWidth: 1280),
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(28),
                                      color: const Color(0xCC1F160F),
                                      border: Border.all(
                                          color: const Color(0x33FFEBD4)),
                                      boxShadow: const [
                                        BoxShadow(
                                          blurRadius: 32,
                                          color: Color(0x66000000),
                                          offset: Offset(0, 18),
                                        ),
                                      ],
                                    ),
                                    child: SingleChildScrollView(
                                      padding: const EdgeInsets.all(24),
                                      child: Center(
                                        child: ConstrainedBox(
                                          constraints: const BoxConstraints(
                                            maxWidth:
                                                _kSlideshowContentMaxWidth,
                                          ),
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.stretch,
                                            children: [
                                              _ImagesPanel(
                                                note: note,
                                                onTapImage: _openImageViewer,
                                              ),
                                              const SizedBox(height: 24),
                                              _MetaPanel(note: note),
                                            ],
                                          ),
                                        ),
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
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

const double _kSlideshowImagesMaxWidth = 720;
const double _kSlideshowContentMaxWidth = 760;

class _PreviousSlideIntent extends Intent {
  const _PreviousSlideIntent();
}

class _NextSlideIntent extends Intent {
  const _NextSlideIntent();
}

class _ImagesPanel extends StatelessWidget {
  const _ImagesPanel({
    required this.note,
    required this.onTapImage,
  });

  final NoteRecord note;
  final void Function(NoteRecord note, String type) onTapImage;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          note.title,
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w700,
                color: const Color(0xFFFFF5E9),
              ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          note.gradingCompany.isEmpty ? 'Collection note' : note.gradingCompany,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: const Color(0xFFA3C6B2),
              ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 20),
        Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(maxWidth: _kSlideshowImagesMaxWidth),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _ImageCard(
                  imagePath: note.previewFor('front')?.assetPath,
                  onTap: () => onTapImage(note, 'front'),
                ),
                const SizedBox(height: 16),
                _ImageCard(
                  imagePath: note.previewFor('back')?.assetPath,
                  onTap: () => onTapImage(note, 'back'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ImageCard extends StatelessWidget {
  const _ImageCard({
    required this.imagePath,
    required this.onTap,
  });

  final String? imagePath;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: InkWell(
        onTap: imagePath == null ? null : onTap,
        borderRadius: BorderRadius.circular(24),
        child: Ink(
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0x33FFEBD4)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AspectRatio(
                  aspectRatio: 1.65,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: imagePath == null
                        ? const ColoredBox(
                            color: Color(0xFF2A2019),
                            child: Center(
                              child: Text(
                                'No image bundled',
                                style: TextStyle(color: Colors.white70),
                              ),
                            ),
                          )
                        : Image.asset(
                            imagePath!,
                            fit: BoxFit.contain,
                            errorBuilder: (context, error, stackTrace) {
                              return const ColoredBox(
                                color: Color(0xFF2A2019),
                                child: Center(
                                  child: Text(
                                    'Missing asset',
                                    style: TextStyle(color: Colors.white70),
                                  ),
                                ),
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
    );
  }
}

class _MetaPanel extends StatelessWidget {
  const _MetaPanel({required this.note});

  final NoteRecord note;

  Uri? _parseSourceUri(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return null;
    }

    final parsed = Uri.tryParse(trimmed);
    if (parsed != null && parsed.hasScheme) {
      return parsed;
    }

    return Uri.tryParse('https://$trimmed');
  }

  Future<void> _openSourceUrl() async {
    final uri = _parseSourceUri(note.url);
    if (uri == null) {
      return;
    }

    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final detailEntries = <MapEntry<String, String>>[
      MapEntry('Date', note.issueDate),
      MapEntry('Catalog', note.catalogNumber),
      MapEntry('Grade', note.grade),
      MapEntry('Serial', note.serial),
      MapEntry('Watermark', note.watermark),
      MapEntry('Tags', note.tagsLabel),
    ].where((entry) => entry.value.trim().isNotEmpty).toList(growable: false);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0x33FFEBD4)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final entry in detailEntries) ...[
              Text(
                entry.key,
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: const Color(0xFFA37037),
                    ),
              ),
              const SizedBox(height: 4),
              SelectableText(
                entry.value,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFFFFF5E9),
                    ),
              ),
              const SizedBox(height: 16),
            ],
            if (note.url.trim().isNotEmpty) ...[
              Text(
                'Source URL',
                style: Theme.of(context).textTheme.labelLarge?.copyWith(
                      color: const Color(0xFFA37037),
                    ),
              ),
              const SizedBox(height: 4),
              InkWell(
                onTap: _openSourceUrl,
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(
                    note.url,
                    style: const TextStyle(
                      color: Color(0xFFA3C6B2),
                      decoration: TextDecoration.underline,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
            Text(
              'Notes',
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: const Color(0xFFA37037),
                  ),
            ),
            const SizedBox(height: 4),
            Text(
              note.notes.trim().isEmpty ? 'No extra notes.' : note.notes,
              style: const TextStyle(color: Color(0xFFFFF5E9)),
            ),
          ],
        ),
      ),
    );
  }
}
