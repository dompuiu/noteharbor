import 'package:flutter/material.dart';

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
    return Scaffold(
      backgroundColor: const Color(0xFFEEE5D6),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Slideshow',
                          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                                color: const Color(0xFF7A5D27),
                                letterSpacing: 1.2,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Tap a note image to open the full viewer',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '${_currentIndex + 1} / ${widget.notes.length}',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(width: 16),
                  FilledButton.tonal(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Back to table'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: widget.notes.length,
                onPageChanged: (value) => setState(() => _currentIndex = value),
                itemBuilder: (context, index) {
                  final note = widget.notes[index];

                  return Padding(
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 1200),
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(30),
                            gradient: const LinearGradient(
                              colors: [Color(0xFFFAF6EE), Color(0xFFE2D5BF)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            boxShadow: const [
                              BoxShadow(
                                blurRadius: 24,
                                color: Color(0x22000000),
                                offset: Offset(0, 16),
                              ),
                            ],
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: LayoutBuilder(
                              builder: (context, constraints) {
                                final showTwoColumns = constraints.maxWidth >= 900;
                                final content = [
                                  Expanded(child: _ImagesPanel(note: note, onTapImage: _openImageViewer)),
                                  const SizedBox(width: 24, height: 24),
                                  Expanded(child: _MetaPanel(note: note)),
                                ];

                                return showTwoColumns
                                    ? Row(crossAxisAlignment: CrossAxisAlignment.start, children: content)
                                    : Column(crossAxisAlignment: CrossAxisAlignment.start, children: content);
                              },
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
    );
  }
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
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          note.title,
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        Text(
          note.gradingCompany.isEmpty ? 'Collection note' : note.gradingCompany,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(color: const Color(0xFF466B5F)),
        ),
        const SizedBox(height: 20),
        Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            _ImageCard(
              label: 'Front',
              imagePath: note.previewFor('front')?.assetPath,
              onTap: () => onTapImage(note, 'front'),
            ),
            _ImageCard(
              label: 'Back',
              imagePath: note.previewFor('back')?.assetPath,
              onTap: () => onTapImage(note, 'back'),
            ),
          ],
        ),
      ],
    );
  }
}

class _ImageCard extends StatelessWidget {
  const _ImageCard({
    required this.label,
    required this.imagePath,
    required this.onTap,
  });

  final String label;
  final String? imagePath;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 320,
      child: InkWell(
        onTap: imagePath == null ? null : onTap,
        borderRadius: BorderRadius.circular(24),
        child: Ink(
          decoration: BoxDecoration(
            color: const Color(0xFFF8F2E6),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFD8C8AA)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 12),
                AspectRatio(
                  aspectRatio: 1.65,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: imagePath == null
                        ? const ColoredBox(
                            color: Color(0xFFE8DFCF),
                            child: Center(child: Text('No image bundled')),
                          )
                        : Image.asset(
                            imagePath!,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) {
                              return const ColoredBox(
                                color: Color(0xFFE8DFCF),
                                child: Center(child: Text('Missing asset')),
                              );
                            },
                          ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  imagePath == null ? 'Image unavailable' : 'Tap to open full-size sequence',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFF5A5C59)),
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

  @override
  Widget build(BuildContext context) {
    final detailEntries = <MapEntry<String, String>>[
      MapEntry('Order', '${note.displayOrder}'),
      MapEntry('Date', note.issueDate),
      MapEntry('Catalog', note.catalogNumber),
      MapEntry('Grade', note.grade),
      MapEntry('Serial', note.serial),
      MapEntry('Watermark', note.watermark),
      MapEntry('Tags', note.tagsLabel),
      MapEntry('Scrape status', note.scrapeStatus),
    ].where((entry) => entry.value.trim().isNotEmpty).toList(growable: false);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBF4),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE3D6C2)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final entry in detailEntries) ...[
              Text(entry.key, style: Theme.of(context).textTheme.labelLarge?.copyWith(color: const Color(0xFF7C6846))),
              const SizedBox(height: 4),
              SelectableText(entry.value, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
              const SizedBox(height: 16),
            ],
            if (note.url.trim().isNotEmpty) ...[
              Text('Source URL', style: Theme.of(context).textTheme.labelLarge?.copyWith(color: const Color(0xFF7C6846))),
              const SizedBox(height: 4),
              SelectableText(note.url),
              const SizedBox(height: 16),
            ],
            Text('Notes', style: Theme.of(context).textTheme.labelLarge?.copyWith(color: const Color(0xFF7C6846))),
            const SizedBox(height: 4),
            Text(note.notes.trim().isEmpty ? 'No extra notes.' : note.notes),
          ],
        ),
      ),
    );
  }
}
