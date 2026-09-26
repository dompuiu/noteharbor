import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/viewer_palette.dart';
import '../../models/note_image.dart';
import '../../models/note_record.dart';
import '../../widgets/note_image_provider.dart';
import 'image_lightbox.dart';

const _kBg = ViewerPalette.darkBackground;
const _kCardBg = ViewerPalette.darkSurface;
const _kDetailsBg = ViewerPalette.darkRaised;
const _kBorder = ViewerPalette.darkBorder;
const _kTextPrimary = ViewerPalette.darkText;
const _kTextAccent = ViewerPalette.darkAccent;
const _kTextLabel = ViewerPalette.darkMuted;
const _kTagChipBg = ViewerPalette.tagBackground;
const _kTagChipBorder = ViewerPalette.tagBorder;
const _kTagChipText = ViewerPalette.tagText;

class NoteSlideshowResult {
  const NoteSlideshowResult({
    required this.noteId,
    this.tagName,
  });

  final int noteId;
  final String? tagName;
}

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
  late final FocusNode _slideshowFocusNode =
      FocusNode(debugLabel: 'noteSlideshow');
  late int _currentIndex;

  void _close({String? tagName}) {
    if (!mounted) {
      return;
    }

    Navigator.of(context).pop(
      NoteSlideshowResult(
        noteId: widget.notes[_currentIndex].id,
        tagName: tagName,
      ),
    );
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
    _slideshowFocusNode.dispose();
    super.dispose();
  }

  List<ImageSequenceItem> _buildImageSequence(List<NoteRecord> notes) {
    final items = <ImageSequenceItem>[];
    for (final note in notes) {
      items.add(ImageSequenceItem(note: note, image: note.fullFor('front')));
      items.add(ImageSequenceItem(note: note, image: note.fullFor('back')));
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
    if (widget.notes.isEmpty || _currentIndex <= 0) return;
    _jump(_currentIndex - 1);
  }

  void _goNext() {
    if (widget.notes.isEmpty || _currentIndex >= widget.notes.length - 1) {
      return;
    }
    _jump(_currentIndex + 1);
  }

  void _openCurrentImageViewer() {
    if (widget.notes.isEmpty) return;
    final note = widget.notes[_currentIndex];
    final type = note.fullFor('front') != null ? 'front' : 'back';
    _openImageViewer(note, type);
  }

  void _openImageFromKeyboard() {
    // Let focused controls (Back button, selectable text) handle their own
    // Enter/Space keys instead of opening the popover underneath them.
    if (FocusManager.instance.primaryFocus != _slideshowFocusNode) {
      return;
    }
    if (HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isMetaPressed ||
        HardwareKeyboard.instance.isAltPressed) {
      return;
    }
    _openCurrentImageViewer();
  }

  Future<void> _openImageViewer(NoteRecord note, String type) async {
    final targetImage = note.fullFor(type);
    if (targetImage == null || _imageSequence.isEmpty) return;

    final initialIndex = _imageSequence.indexWhere(
      (item) => item.note.id == note.id && item.image?.type == targetImage.type,
    );
    if (initialIndex < 0) return;

    final selectedNoteId = await Navigator.of(context).push<int>(
      MaterialPageRoute<int>(
        builder: (context) => ImageLightbox(
          items: _imageSequence,
          initialIndex: initialIndex,
        ),
      ),
    );

    if (!mounted || selectedNoteId == null) {
      return;
    }

    final selectedNoteIndex = widget.notes.indexWhere(
      (item) => item.id == selectedNoteId,
    );
    if (selectedNoteIndex < 0 || selectedNoteIndex == _currentIndex) {
      return;
    }

    _pageController.jumpToPage(selectedNoteIndex);
    setState(() => _currentIndex = selectedNoteIndex);
  }

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.escape): DismissIntent(),
        SingleActivator(LogicalKeyboardKey.arrowLeft): _PreviousSlideIntent(),
        SingleActivator(LogicalKeyboardKey.arrowRight): _NextSlideIntent(),
        SingleActivator(LogicalKeyboardKey.arrowDown): _OpenImageIntent(),
        SingleActivator(LogicalKeyboardKey.enter): _OpenImageIntent(),
        SingleActivator(LogicalKeyboardKey.numpadEnter): _OpenImageIntent(),
        SingleActivator(LogicalKeyboardKey.space): _OpenImageIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          DismissIntent: CallbackAction<DismissIntent>(
            onInvoke: (_) {
              _close();
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
          _OpenImageIntent: CallbackAction<_OpenImageIntent>(
            onInvoke: (_) {
              _openImageFromKeyboard();
              return null;
            },
          ),
        },
        child: Focus(
          focusNode: _slideshowFocusNode,
          autofocus: true,
          child: PopScope<NoteSlideshowResult>(
            canPop: false,
            onPopInvokedWithResult: (didPop, result) {
              if (didPop) {
                return;
              }

              _close();
            },
            child: Scaffold(
              backgroundColor: _kBg,
              body: DecoratedBox(
                decoration: const BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment(0.0, -0.45),
                    radius: 1.25,
                    colors: [
                      Color(0xFF2E251B),
                      ViewerPalette.darkBackground,
                    ],
                    stops: [0.0, 1.0],
                  ),
                ),
                child: SafeArea(
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
                                color: ViewerPalette.darkScrim,
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(
                                    color: ViewerPalette.darkBorder),
                              ),
                              child: Text(
                                '${_currentIndex + 1} / ${widget.notes.length}',
                                style: const TextStyle(
                                  fontFamily: 'Inter',
                                  color: _kTextPrimary,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 15,
                                  fontFeatures: [
                                    FontFeature.tabularFigures()
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            FilledButton.tonal(
                              style: FilledButton.styleFrom(
                                backgroundColor:
                                    ViewerPalette.darkScrim,
                                foregroundColor: _kTextPrimary,
                                side: const BorderSide(
                                    color: ViewerPalette.darkBorder),
                              ),
                              onPressed: _close,
                              child: const Text('Back'),
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: Stack(
                          children: [
                            PageView.builder(
                              controller: _pageController,
                              itemCount: widget.notes.length,
                              onPageChanged: (i) =>
                                  setState(() => _currentIndex = i),
                              itemBuilder: (context, index) {
                                return _NoteSlide(
                                  note: widget.notes[index],
                                  onTapImage: _openImageViewer,
                                  onTagTap: (tagName) =>
                                      _close(tagName: tagName),
                                );
                              },
                            ),
                            _EdgeChevron(
                              left: true,
                              onTap: _goPrevious,
                            ),
                            _EdgeChevron(
                              left: false,
                              onTap: _goNext,
                            ),
                          ],
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
                borderRadius: BorderRadius.circular(20),
                boxShadow: const [
                  BoxShadow(
                    blurRadius: 32,
                    offset: Offset(0, 16),
                    color: Color(0x66000000),
                  ),
                ],
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
                            fontFamily: 'Inter',
                            color: _kTextPrimary,
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.3,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        if (widget.note.gradingCompany.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            widget.note.gradingCompany,
                            style: const TextStyle(
                              fontFamily: 'Inter',
                              color: _kTextAccent,
                              fontSize: 15,
                              letterSpacing: 0.2,
                            ),
                            textAlign: TextAlign.center,
                          ),
                        ],
                        const SizedBox(height: 12),
                        Container(
                          height: 1,
                          margin:
                              const EdgeInsets.symmetric(horizontal: 48),
                          color: _kBorder,
                        ),
                        const SizedBox(height: 16),
                        _NoteImage(
                          image: widget.note.fullFor('front'),
                          onTap: () => widget.onTapImage(widget.note, 'front'),
                        ),
                        const SizedBox(height: 12),
                        _NoteImage(
                          image: widget.note.fullFor('back'),
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
  const _NoteImage({required this.image, required this.onTap});

  final NoteImage? image;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: image == null ? null : onTap,
      child: AspectRatio(
        aspectRatio: 1.65,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: _kBorder),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: image == null
                ? const ColoredBox(
                    color: _kDetailsBg,
                    child: Center(
                      child: Text(
                        'No image',
                        style: TextStyle(
                          fontFamily: 'Inter',
                          color: ViewerPalette.darkMuted,
                        ),
                      ),
                    ),
                  )
                : Image(
                    image: createNoteImageProvider(image!),
                    fit: BoxFit.contain,
                    frameBuilder:
                        (context, child, frame, wasSynchronouslyLoaded) {
                      if (wasSynchronouslyLoaded || frame != null) {
                        return child;
                      }
                      return const ColoredBox(
                        color: _kDetailsBg,
                      );
                    },
                    errorBuilder: (_, __, ___) => const ColoredBox(
                      color: _kDetailsBg,
                      child: Center(
                        child: Text(
                          'Missing image',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            color: ViewerPalette.darkMuted,
                          ),
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
                fontFamily: 'Inter',
                color: _kTextLabel,
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
              ),
            ),
            const SizedBox(height: 3),
            SelectableText(
              entry.value,
              style: const TextStyle(
                fontFamily: 'Inter',
                color: _kTextPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(height: 14),
          ],
          if (note.tags.isNotEmpty) ...[
            const Text(
              'Tags',
              style: TextStyle(
                fontFamily: 'Inter',
                color: _kTextLabel,
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
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
                    child: MouseRegion(
                      cursor: SystemMouseCursors.click,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: _kTagChipBg,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: _kTagChipBorder),
                          boxShadow: const [
                            BoxShadow(
                              blurRadius: 8,
                              offset: Offset(0, 2),
                              color: Color(0x40000000),
                            ),
                          ],
                        ),
                        child: Text(
                          tag.name,
                          style: const TextStyle(
                            fontFamily: 'Inter',
                            color: _kTagChipText,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
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
                fontFamily: 'Inter',
                color: _kTextLabel,
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
              ),
            ),
            const SizedBox(height: 3),
            GestureDetector(
              onTap: _openSourceUrl,
              child: Text(
                note.url,
                style: const TextStyle(
                  fontFamily: 'Inter',
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
              fontFamily: 'Inter',
              color: _kTextLabel,
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            note.notes.trim().isEmpty ? 'No extra notes.' : note.notes,
            style: const TextStyle(
              fontFamily: 'Inter',
              color: _kTextPrimary,
              fontSize: 15,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

/// Hover-revealed previous/next affordance floating over the slide edges.
/// Paint-only on touch devices (no hover): it stays invisible and inert.
class _EdgeChevron extends StatefulWidget {
  const _EdgeChevron({required this.left, required this.onTap});

  final bool left;
  final VoidCallback onTap;

  @override
  State<_EdgeChevron> createState() => _EdgeChevronState();
}

class _EdgeChevronState extends State<_EdgeChevron> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: widget.left ? 20 : null,
      right: widget.left ? null : 20,
      top: 0,
      bottom: 0,
      child: Center(
        child: MouseRegion(
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() => _hovered = false),
          child: AnimatedOpacity(
            opacity: _hovered ? 1.0 : 0.0,
            duration: const Duration(milliseconds: 160),
            curve: Curves.easeOut,
            child: IgnorePointer(
              ignoring: !_hovered,
              child: GestureDetector(
                onTap: widget.onTap,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: ViewerPalette.darkScrim,
                    borderRadius: BorderRadius.circular(20),
                    border:
                        Border.all(color: ViewerPalette.darkBorder),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Icon(
                      widget.left
                          ? Icons.chevron_left_rounded
                          : Icons.chevron_right_rounded,
                      color: ViewerPalette.darkText,
                      size: 26,
                    ),
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

class _PreviousSlideIntent extends Intent {
  const _PreviousSlideIntent();
}

class _NextSlideIntent extends Intent {
  const _NextSlideIntent();
}

class _OpenImageIntent extends Intent {
  const _OpenImageIntent();
}
