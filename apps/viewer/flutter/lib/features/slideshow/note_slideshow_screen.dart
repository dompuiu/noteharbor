import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/note_record.dart';
import 'image_lightbox.dart';

const _kBg = Color(0xFF1F160F);
const _kCardBg = Color(0xFF160E08);
const _kDetailsBg = Color(0xFF2A1A0E);
const _kBorder = Color(0x44FFEBD4);
const _kTextPrimary = Color(0xFFFFF5E9);
const _kTextAccent = Color(0xFFA3C6B2);
const _kTextLabel = Color(0xFFA37037);
const _kTagChipBg = Color(0xFFE8D8BC);
const _kTagChipBorder = Color(0xFFB08957);
const _kTagChipText = Color(0xFF5C4323);

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
      if (front != null) items.add(ImageSequenceItem(note: note, image: front));
      if (back != null) items.add(ImageSequenceItem(note: note, image: back));
    }
    return items;
  }

  void _jump(int nextIndex) {
    _pageController.animateToPage(
      nextIndex,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  void _goPrevious() {
    if (widget.notes.isEmpty) return;
    _jump((_currentIndex - 1 + widget.notes.length) % widget.notes.length);
  }

  void _goNext() {
    if (widget.notes.isEmpty) return;
    _jump((_currentIndex + 1) % widget.notes.length);
  }

  void _openImageViewer(NoteRecord note, String type) {
    final targetImage = note.fullFor(type);
    if (targetImage == null || _imageSequence.isEmpty) return;

    final initialIndex = _imageSequence.indexWhere(
      (item) => item.note.id == note.id && item.image.type == targetImage.type,
    );
    if (initialIndex < 0) return;

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
            onInvoke: (_) {
              Navigator.of(context).maybePop();
              return null;
            },
          ),
          _PreviousSlideIntent: CallbackAction<_PreviousSlideIntent>(
            onInvoke: (_) {
              _goPrevious();
              return null;
            },
          ),
          _NextSlideIntent: CallbackAction<_NextSlideIntent>(
            onInvoke: (_) {
              _goNext();
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: Scaffold(
            backgroundColor: _kBg,
            body: SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                    child: Row(
                      children: [
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: Text(
                            '${_currentIndex + 1} / ${widget.notes.length}',
                            style: const TextStyle(
                              color: _kTextPrimary,
                              fontWeight: FontWeight.w600,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        FilledButton.tonal(
                          style: FilledButton.styleFrom(
                            backgroundColor:
                                Colors.white.withValues(alpha: 0.08),
                            foregroundColor: _kTextPrimary,
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
                      onPageChanged: (i) => setState(() => _currentIndex = i),
                      itemBuilder: (context, index) {
                        return _NoteSlide(
                          note: widget.notes[index],
                          onTapImage: _openImageViewer,
                          onTagTap: (tagName) =>
                              Navigator.of(context).pop(tagName),
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
    );
  }
}

class _NoteSlide extends StatefulWidget {
  const _NoteSlide({
    required this.note,
    required this.onTapImage,
    required this.onTagTap,
  });

  final NoteRecord note;
  final void Function(NoteRecord, String) onTapImage;
  final void Function(String tagName) onTagTap;

  @override
  State<_NoteSlide> createState() => _NoteSlideState();
}

class _NoteSlideState extends State<_NoteSlide> {
  final _scrollController = ScrollController();
  bool _atBottom = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    final atBottom = _scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 1;
    if (atBottom != _atBottom) setState(() => _atBottom = atBottom);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
      child: Stack(
        children: [
          // Scrollable content clipped inside card background
          Positioned.fill(
            child: Container(
              margin: const EdgeInsets.all(1),
              decoration: BoxDecoration(
                color: _kCardBg,
                borderRadius: BorderRadius.circular(19),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  SingleChildScrollView(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          widget.note.title,
                          style: const TextStyle(
                            color: _kTextPrimary,
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        if (widget.note.gradingCompany.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            widget.note.gradingCompany,
                            style: const TextStyle(
                                color: _kTextAccent, fontSize: 15),
                            textAlign: TextAlign.center,
                          ),
                        ],
                        const SizedBox(height: 16),
                        _NoteImage(
                          imagePath: widget.note.previewFor('front')?.assetPath,
                          onTap: () => widget.onTapImage(widget.note, 'front'),
                        ),
                        const SizedBox(height: 12),
                        _NoteImage(
                          imagePath: widget.note.previewFor('back')?.assetPath,
                          onTap: () => widget.onTapImage(widget.note, 'back'),
                        ),
                        const SizedBox(height: 16),
                        _MetaPanel(
                          note: widget.note,
                          onTagTap: widget.onTagTap,
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: AnimatedOpacity(
                      opacity: _atBottom ? 0.0 : 1.0,
                      duration: const Duration(milliseconds: 250),
                      child: IgnorePointer(
                        child: Container(
                          height: 72,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                _kCardBg.withValues(alpha: 0),
                                _kCardBg,
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Border always rendered on top
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: _kBorder),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _NoteImage extends StatelessWidget {
  const _NoteImage({required this.imagePath, required this.onTap});

  final String? imagePath;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: imagePath == null ? null : onTap,
      child: AspectRatio(
        aspectRatio: 1.65,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: imagePath == null
              ? const ColoredBox(
                  color: Color(0xFF2A1A0E),
                  child: Center(
                    child: Text(
                      'No image',
                      style: TextStyle(color: Colors.white54),
                    ),
                  ),
                )
              : Image.asset(
                  imagePath!,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => const ColoredBox(
                    color: Color(0xFF2A1A0E),
                    child: Center(
                      child: Text(
                        'Missing asset',
                        style: TextStyle(color: Colors.white54),
                      ),
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}

class _MetaPanel extends StatelessWidget {
  const _MetaPanel({required this.note, required this.onTagTap});

  final NoteRecord note;
  final void Function(String tagName) onTagTap;

  Uri? _parseSourceUri(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return null;
    final parsed = Uri.tryParse(trimmed);
    if (parsed != null && parsed.hasScheme) return parsed;
    return Uri.tryParse('https://$trimmed');
  }

  Future<void> _openSourceUrl() async {
    final uri = _parseSourceUri(note.url);
    if (uri == null) return;
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
    ].where((e) => e.value.trim().isNotEmpty).toList(growable: false);

    return Container(
      decoration: BoxDecoration(
        color: _kDetailsBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _kBorder),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final entry in detailEntries) ...[
            Text(
              entry.key,
              style: const TextStyle(
                color: _kTextLabel,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 3),
            SelectableText(
              entry.value,
              style: const TextStyle(
                color: _kTextPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
          ],
          if (note.tags.isNotEmpty) ...[
            const Text(
              'Tags',
              style: TextStyle(
                color: _kTextLabel,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                for (final tag in note.tags)
                  GestureDetector(
                    onTap: () => onTagTap(tag.name),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: _kTagChipBg,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: _kTagChipBorder),
                      ),
                      child: Text(
                        tag.name,
                        style: const TextStyle(
                          color: _kTagChipText,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
          ],
          if (note.url.trim().isNotEmpty) ...[
            const Text(
              'Source URL',
              style: TextStyle(
                color: _kTextLabel,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 3),
            GestureDetector(
              onTap: _openSourceUrl,
              child: Text(
                note.url,
                style: const TextStyle(
                  color: _kTextAccent,
                  decoration: TextDecoration.underline,
                  fontSize: 15,
                ),
              ),
            ),
            const SizedBox(height: 14),
          ],
          const Text(
            'Notes',
            style: TextStyle(
              color: _kTextLabel,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            note.notes.trim().isEmpty ? 'No extra notes.' : note.notes,
            style: const TextStyle(color: _kTextPrimary, fontSize: 15),
          ),
        ],
      ),
    );
  }
}

class _PreviousSlideIntent extends Intent {
  const _PreviousSlideIntent();
}

class _NextSlideIntent extends Intent {
  const _NextSlideIntent();
}
