import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/viewer_palette.dart';
import '../../models/note_image.dart';
import '../../models/note_record.dart';
import '../../widgets/grade_pill.dart';
import '../../widgets/mouse_drag_scroll_behavior.dart';
import '../../widgets/note_image_provider.dart';
import 'image_lightbox.dart';

const _kBg = ViewerPalette.roomBackground;
const _kCardBg = ViewerPalette.roomSurface;
const _kDetailsBg = ViewerPalette.roomInset;
const _kBorder = ViewerPalette.roomBorder;
const _kTextPrimary = ViewerPalette.roomText;
const _kTextAccent = ViewerPalette.roomAccent;
const _kTextLabel = ViewerPalette.roomMuted;
const _kTagChipBg = ViewerPalette.tagBackground;
const _kTagChipBorder = ViewerPalette.tagBorder;
const _kTagChipText = ViewerPalette.tagText;

/// Fixed height shared by the slideshow's counter pill and Back control.
const double _kRoomControlHeight = 40;

/// Keyboard scroll step for the slide content, in logical pixels.
const _kArrowScrollOffset = 120.0;

/// Fixed landscape stage for the scan images. Measured across the real
/// dataset (914 full images, avg ratio ~1.55, all but 6 landscape), 3:2
/// centers the error so letterboxing stays small on every slide.
const _kImageStageAspectRatio = 3 / 2;

/// The room's inset and border only appear once the window can hold them.
const double _kRoomMinWidth = 760;
const double _kRoomMinHeight = 560;
const double _kRoomInset = 16;

/// Width at which the pair gains a details rail beside it, and the width below
/// which the pair drops back to the stacked slide.
const double _kRailTierMinWidth = 1000;
const double _kPairTierMinWidth = 760;

/// The details rail's fixed column width in the widest tier.
const double _kDetailsRailWidth = 300;

/// Padding inside the white slide card.
const double _kSlidePadding = 20;

/// Gap between the title block, the plates and the details.
const double _kSlideGap = 12;

/// Floor for the plate pair so both faces stay visible before the slide
/// scrolls instead of shrinking further.
const double _kMinPlatePairHeight = 88;

/// The virtual page the first note is pinned to. The slideshow pages an
/// unbounded [PageView] so that a swipe past either end wraps with no visible
/// seam; this leaves enough room behind the first note that a backwards wrap
/// never runs out of pages.
const int _kVirtualPageOrigin = 1 << 20;

const TextStyle _kLabelStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTextLabel,
  fontSize: 11,
  fontWeight: FontWeight.w700,
  letterSpacing: 0.9,
);

const TextStyle _kDetailLabelStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTextLabel,
  fontSize: 10.5,
  fontWeight: FontWeight.w800,
  letterSpacing: 1.1,
);

const TextStyle _kDetailValueStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTextPrimary,
  fontSize: 15,
  fontWeight: FontWeight.w600,
  fontFeatures: [FontFeature.tabularFigures()],
);

/// The details strip is the tight copy of the rail: it sits under the plates
/// and may not push them out of a short window.
const TextStyle _kStripValueStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTextPrimary,
  fontSize: 13.5,
  fontWeight: FontWeight.w600,
  height: 1.3,
  fontFeatures: [FontFeature.tabularFigures()],
);

const TextStyle _kNotesStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTextPrimary,
  fontSize: 14,
  height: 1.5,
);

const TextStyle _kStripNotesStyle = TextStyle(
  fontFamily: 'Inter',
  color: _kTextPrimary,
  fontSize: 13,
  height: 1.45,
);

/// How the details travel with the plates: a rail beside them, a four-column
/// strip below them, or the stacked column on a narrow slide.
enum _DetailsMode { rail, strip, stacked }

/// The three compositions chosen by the slide's width.
enum _SlideTier { rail, strip, stack }

_SlideTier _tierFor(double width) {
  if (width >= _kRailTierMinWidth) return _SlideTier.rail;
  if (width >= _kPairTierMinWidth) return _SlideTier.strip;
  return _SlideTier.stack;
}

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
  late int _virtualIndex;
  final Map<int, _NoteSlideState> _slideStates = {};

  /// The note currently on screen, derived from the virtual page so paging past
  /// either end wraps without a seam.
  int get _currentIndex => widget.notes.isEmpty
      ? 0
      : (_virtualIndex - _kVirtualPageOrigin) % widget.notes.length;

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
    _virtualIndex = _kVirtualPageOrigin + widget.initialIndex;
    _pageController = PageController(initialPage: _virtualIndex);
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

  /// Animates to the virtual page [page], used by a single-step arrow move.
  void _animateToPage(int page) {
    _pageController.animateToPage(
      page,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  /// Jumps straight to the virtual page [page] with no page transition, used by
  /// Home, End and a wrap-around so a large Collection reaches its target
  /// immediately instead of animating through every note in between.
  void _jumpToPage(int page) {
    _pageController.jumpToPage(page);
    setState(() => _virtualIndex = page);
  }

  bool get _atFirstNote => widget.notes.isEmpty || _currentIndex <= 0;

  bool get _atLastNote =>
      widget.notes.isEmpty || _currentIndex >= widget.notes.length - 1;

  /// Moves one note back. The step always animates, so the wrap from the first
  /// note to the last glides across the seam exactly like a swipe does.
  void _goPrevious() {
    if (widget.notes.length < 2) return;
    _animateToPage(_virtualIndex - 1);
  }

  /// Moves one note forward. The step always animates, so the wrap from the last
  /// note to the first glides across the seam exactly like a swipe does.
  void _goNext() {
    if (widget.notes.length < 2) return;
    _animateToPage(_virtualIndex + 1);
  }

  void _goToFirst() {
    if (_atFirstNote) return;
    _jumpToPage(_virtualIndex - _currentIndex);
  }

  void _goToLast() {
    if (_atLastNote) return;
    _jumpToPage(_virtualIndex - _currentIndex + widget.notes.length - 1);
  }

  /// Jumps to [contentIndex] within the current cycle, used when the popover
  /// hands a different note back to the slideshow.
  void _jumpToContent(int contentIndex) {
    _jumpToPage(_virtualIndex - _currentIndex + contentIndex);
  }

  void _registerSlide(int index, _NoteSlideState state) {
    _slideStates[index] = state;
  }

  void _unregisterSlide(int index, _NoteSlideState state) {
    if (identical(_slideStates[index], state)) {
      _slideStates.remove(index);
    }
  }

  void _scrollCurrentSlide(double dy) {
    // Let focused controls (Back button, selectable text) handle their own
    // arrow keys instead of scrolling underneath them.
    if (FocusManager.instance.primaryFocus != _slideshowFocusNode) {
      return;
    }
    if (HardwareKeyboard.instance.isControlPressed ||
        HardwareKeyboard.instance.isMetaPressed ||
        HardwareKeyboard.instance.isAltPressed) {
      return;
    }
    _slideStates[_virtualIndex]?.scrollBy(dy);
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

    _jumpToContent(selectedNoteIndex);
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final roomed =
        size.width >= _kRoomMinWidth && size.height >= _kRoomMinHeight;
    final roomInset = roomed ? _kRoomInset : 0.0;
    final roomRadius = roomed ? ViewerPalette.radiusMd : 0.0;
    return Shortcuts(
      // h/j/k/l alias the arrows. The activators stay plain (no modifiers), so
      // any modified arrow or letter is left for the platform and stays inert.
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.escape): DismissIntent(),
        SingleActivator(LogicalKeyboardKey.arrowLeft): _PreviousSlideIntent(),
        SingleActivator(LogicalKeyboardKey.keyH): _PreviousSlideIntent(),
        SingleActivator(LogicalKeyboardKey.arrowRight): _NextSlideIntent(),
        SingleActivator(LogicalKeyboardKey.keyL): _NextSlideIntent(),
        SingleActivator(LogicalKeyboardKey.home): _FirstSlideIntent(),
        SingleActivator(LogicalKeyboardKey.end): _LastSlideIntent(),
        SingleActivator(LogicalKeyboardKey.arrowUp): _ScrollUpIntent(),
        SingleActivator(LogicalKeyboardKey.keyK): _ScrollUpIntent(),
        SingleActivator(LogicalKeyboardKey.arrowDown): _ScrollDownIntent(),
        SingleActivator(LogicalKeyboardKey.keyJ): _ScrollDownIntent(),
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
          _FirstSlideIntent: CallbackAction<_FirstSlideIntent>(
            onInvoke: (_) {
              _goToFirst();
              return null;
            },
          ),
          _LastSlideIntent: CallbackAction<_LastSlideIntent>(
            onInvoke: (_) {
              _goToLast();
              return null;
            },
          ),
          _ScrollUpIntent: CallbackAction<_ScrollUpIntent>(
            onInvoke: (_) {
              _scrollCurrentSlide(-_kArrowScrollOffset);
              return null;
            },
          ),
          _ScrollDownIntent: CallbackAction<_ScrollDownIntent>(
            onInvoke: (_) {
              _scrollCurrentSlide(_kArrowScrollOffset);
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
              backgroundColor: ViewerPalette.roomScrim,
              body: Padding(
                padding: EdgeInsets.all(roomInset),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: _kBg,
                    borderRadius: BorderRadius.circular(roomRadius),
                    border: roomed
                        ? Border.all(color: ViewerPalette.roomBorderControl)
                        : null,
                    boxShadow: roomed ? ViewerPalette.shadowRoom : const [],
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(roomRadius),
                    child: SafeArea(
                      minimum: const EdgeInsets.only(bottom: 12),
                      child: Column(
                        children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                const Spacer(),
                                Container(
                                  height: _kRoomControlHeight,
                                  alignment: Alignment.center,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                  ),
                                  decoration: BoxDecoration(
                                    color: ViewerPalette.roomSurface,
                                    borderRadius: BorderRadius.circular(
                                      ViewerPalette.radiusPill,
                                    ),
                                    border: Border.all(
                                      color: ViewerPalette.roomBorderControl,
                                    ),
                                  ),
                                  child: Text(
                                    '${_currentIndex + 1} / ${widget.notes.length}',
                                    style: const TextStyle(
                                      fontFamily: 'Inter',
                                      color: _kTextPrimary,
                                      fontWeight: FontWeight.w600,
                                      fontSize: 13,
                                      fontFeatures: [
                                        FontFeature.tabularFigures(),
                                      ],
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                SizedBox(
                                  height: _kRoomControlHeight,
                                  child: OutlinedButton(
                                    onPressed: _close,
                                    child: const Text('Back'),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Expanded(
                            child: Stack(
                              children: [
                                ScrollConfiguration(
                                  // A mouse drag pages the slide; the note card
                                  // opts back out below so it does not also
                                  // drag-scroll.
                                  behavior: const MouseDragScrollBehavior(),
                                  child: PageView.builder(
                                    controller: _pageController,
                                    itemCount: widget.notes.isEmpty ? 0 : null,
                                    onPageChanged: (i) =>
                                        setState(() => _virtualIndex = i),
                                    itemBuilder: (context, index) {
                                      return _NoteSlide(
                                        index: index,
                                        note:
                                            widget.notes[(index -
                                                    _kVirtualPageOrigin) %
                                                widget.notes.length],
                                        onTapImage: _openImageViewer,
                                        onTagTap: (tagName) =>
                                            _close(tagName: tagName),
                                        onAttached: _registerSlide,
                                        onDetached: _unregisterSlide,
                                      );
                                    },
                                  ),
                                ),
                                _EdgeChevron(left: true, onTap: _goPrevious),
                                _EdgeChevron(left: false, onTap: _goNext),
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
        ),
      ),
    );
  }
}

class _NoteSlide extends StatefulWidget {
  const _NoteSlide({
    required this.index,
    required this.note,
    required this.onTapImage,
    required this.onTagTap,
    this.onAttached,
    this.onDetached,
  });

  final int index;
  final NoteRecord note;
  final void Function(NoteRecord, String) onTapImage;
  final void Function(String tagName) onTagTap;
  final void Function(int index, _NoteSlideState state)? onAttached;
  final void Function(int index, _NoteSlideState state)? onDetached;

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
    widget.onAttached?.call(widget.index, this);
  }

  @override
  void didUpdateWidget(covariant _NoteSlide oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.index != widget.index ||
        oldWidget.onAttached != widget.onAttached ||
        oldWidget.onDetached != widget.onDetached) {
      oldWidget.onDetached?.call(oldWidget.index, this);
      widget.onAttached?.call(widget.index, this);
    }
  }

  @override
  void dispose() {
    widget.onDetached?.call(widget.index, this);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    final atBottom = _scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 1;
    if (atBottom != _atBottom) setState(() => _atBottom = atBottom);
  }

  /// Scrolls the slide content by [dy] pixels, clamped to the scroll extents.
  void scrollBy(double dy) {
    if (!_scrollController.hasClients) {
      return;
    }
    final position = _scrollController.position;
    final target = (position.pixels + dy).clamp(0.0, position.maxScrollExtent);
    if (target == position.pixels) {
      return;
    }
    _scrollController.animateTo(
      target,
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOut,
    );
  }

  Widget _buildScrollBody(_SlideTier tier) {
    return ScrollConfiguration(
      // Reset to the platform default so the mouse drag that pages the
      // slideshow does not also drag-scroll the card, while keeping the
      // scrollbar hidden (the bottom fade already signals that the card
      // content scrolls).
      behavior: const MaterialScrollBehavior().copyWith(scrollbars: false),
      child: LayoutBuilder(
        builder: (context, constraints) {
          return SingleChildScrollView(
            controller: _scrollController,
            padding: const EdgeInsets.all(_kSlidePadding),
            child: tier == _SlideTier.stack
                ? _buildStacked()
                : ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: math.max(
                        0,
                        constraints.maxHeight - _kSlidePadding * 2,
                      ),
                    ),
                    // IntrinsicHeight lets the body fill the viewport when the
                    // content fits and grow past it (so the slide scrolls) when
                    // it does not. The plate pair reports a zero intrinsic
                    // height so it bends with the viewport instead of pinning
                    // the body to its card-width size.
                    child: IntrinsicHeight(child: _buildTiered(tier)),
                  ),
          );
        },
      ),
    );
  }

  Widget _buildTiered(_SlideTier tier) {
    final header = _SlideHeader(note: widget.note);
    final pair = _PlatePair(
      note: widget.note,
      onTapImage: widget.onTapImage,
    );

    if (tier == _SlideTier.rail) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          header,
          const SizedBox(height: _kSlideGap),
          Expanded(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: _kMinPlatePairHeight,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(child: _IgnoreIntrinsicHeight(child: pair)),
                  const SizedBox(width: 16),
                  SizedBox(
                    width: _kDetailsRailWidth,
                    child: _DetailsRail(
                      note: widget.note,
                      mode: _DetailsMode.rail,
                      onTagTap: widget.onTagTap,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        header,
        const SizedBox(height: _kSlideGap),
        Expanded(
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: _kMinPlatePairHeight),
            child: _IgnoreIntrinsicHeight(child: pair),
          ),
        ),
        const SizedBox(height: 10),
        _DetailsRail(
          note: widget.note,
          mode: _DetailsMode.strip,
          onTagTap: widget.onTagTap,
        ),
      ],
    );
  }

  Widget _buildStacked() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SlideHeader(note: widget.note, centered: true),
        const SizedBox(height: 16),
        _NotePlate(
          image: widget.note.fullFor('front'),
          label: 'Front',
          onTap: () => widget.onTapImage(widget.note, 'front'),
        ),
        const SizedBox(height: 12),
        _NotePlate(
          image: widget.note.fullFor('back'),
          label: 'Back',
          onTap: () => widget.onTapImage(widget.note, 'back'),
        ),
        const SizedBox(height: 16),
        _DetailsRail(
          note: widget.note,
          mode: _DetailsMode.stacked,
          onTagTap: widget.onTagTap,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final tier = _tierFor(MediaQuery.sizeOf(context).width);
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
                borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  Positioned.fill(child: _buildScrollBody(tier)),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: AnimatedOpacity(
                      opacity: _atBottom ? 0.0 : 1.0,
                      duration: const Duration(milliseconds: 250),
                      child: IgnorePointer(
                        child: Container(
                          height: 104,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                _kCardBg.withValues(alpha: 0),
                                _kCardBg.withValues(alpha: 0.82),
                                _kCardBg,
                                _kCardBg,
                              ],
                              stops: const [0.0, 0.45, 0.75, 1.0],
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
                  borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
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

/// Reports no intrinsic height so a flexible child can shrink with the
/// viewport inside the slide's [IntrinsicHeight]; the child still lays out
/// normally under the tight height its parent gives it.
class _IgnoreIntrinsicHeight extends SingleChildRenderObjectWidget {
  const _IgnoreIntrinsicHeight({required super.child});

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderIgnoreIntrinsicHeight();
}

class _RenderIgnoreIntrinsicHeight extends RenderProxyBox {
  @override
  double computeMinIntrinsicHeight(double width) => 0;

  @override
  double computeMaxIntrinsicHeight(double width) => 0;
}

/// The note's eyebrow, denomination and issue date, over a hairline.
class _SlideHeader extends StatelessWidget {
  const _SlideHeader({required this.note, this.centered = false});

  final NoteRecord note;
  final bool centered;

  @override
  Widget build(BuildContext context) {
    final align = centered ? TextAlign.center : TextAlign.start;
    final crossAxisAlignment =
        centered ? CrossAxisAlignment.center : CrossAxisAlignment.start;
    final company = note.gradingCompany.trim();
    final issueDate = note.issueDate.trim();
    final eyebrow = [
      if (company.isNotEmpty) company else 'Collection note',
      if (issueDate.isNotEmpty) issueDate,
    ].join(' · ');
    return Column(
      crossAxisAlignment: crossAxisAlignment,
      children: [
        Text(eyebrow.toUpperCase(), style: _kLabelStyle, textAlign: align),
        const SizedBox(height: 5),
        Text(
          note.title.toUpperCase(),
          style: const TextStyle(
            fontFamily: 'Inter',
            color: _kTextPrimary,
            fontSize: 33.6,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.7,
            height: 1.12,
          ),
          textAlign: align,
        ),
      ],
    );
  }
}

/// Both faces at equal weight, each sized to the height the slide gives them.
class _PlatePair extends StatelessWidget {
  const _PlatePair({required this.note, required this.onTapImage});

  final NoteRecord note;
  final void Function(NoteRecord, String) onTapImage;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Center(
            child: _NotePlate(
              image: note.fullFor('front'),
              label: 'Front',
              onTap: () => onTapImage(note, 'front'),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Center(
            child: _NotePlate(
              image: note.fullFor('back'),
              label: 'Back',
              onTap: () => onTapImage(note, 'back'),
            ),
          ),
        ),
      ],
    );
  }
}

/// One image plate: a white 3:2 stage with a face label, opened full size.
class _NotePlate extends StatelessWidget {
  const _NotePlate({
    required this.image,
    required this.label,
    required this.onTap,
  });

  final NoteImage? image;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final image = this.image;
    return MouseRegion(
      cursor: image == null ? SystemMouseCursors.basic : SystemMouseCursors.click,
      child: GestureDetector(
        onTap: image == null ? null : onTap,
        child: AspectRatio(
          aspectRatio: _kImageStageAspectRatio,
          child: Container(
            // A plate on the white card: white ground, hairline control
            // border, and the picture fitted inside. The room carries no
            // second tint.
            decoration: BoxDecoration(
              color: ViewerPalette.roomSurface,
              borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
              border: Border.all(color: ViewerPalette.roomBorderControl),
            ),
            clipBehavior: Clip.antiAlias,
            padding: const EdgeInsets.all(8),
            child: Stack(
              children: [
                Positioned.fill(
                  child: image == null
                      ? const Center(
                          child: Text(
                            'No image',
                            style: TextStyle(
                              fontFamily: 'Inter',
                              color: ViewerPalette.roomMuted,
                            ),
                          ),
                        )
                      : Image(
                          image: createNoteImageProvider(image),
                          fit: BoxFit.contain,
                          errorBuilder: (_, _, _) => const Center(
                            child: Text(
                              'Missing image',
                              style: TextStyle(
                                fontFamily: 'Inter',
                                color: ViewerPalette.roomMuted,
                              ),
                            ),
                          ),
                        ),
                ),
                Positioned(
                  left: 4,
                  top: 4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: ViewerPalette.roomSurface.withValues(alpha: 0.94),
                      borderRadius: BorderRadius.circular(ViewerPalette.radiusXs),
                      border: Border.all(color: ViewerPalette.borderSoft),
                    ),
                    child: Text(
                      label.toUpperCase(),
                      style: const TextStyle(
                        fontFamily: 'Inter',
                        color: _kTextLabel,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.1,
                      ),
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

/// The note's facts: a rail beside the plates, a four-column strip below them,
/// or the stacked panel on a narrow slide. A blank field is left out.
class _DetailsRail extends StatelessWidget {
  const _DetailsRail({
    required this.note,
    required this.mode,
    required this.onTagTap,
  });

  final NoteRecord note;
  final _DetailsMode mode;
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

  Widget _header() {
    final catalog = note.catalogNumber.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Text(
              'Details',
              style: TextStyle(
                fontFamily: 'Inter',
                color: _kTextLabel,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.1,
              ),
            ),
            const Spacer(),
            if (catalog.isNotEmpty)
              Text(
                catalog,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  color: _kTextLabel,
                  fontSize: 11,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        const Divider(
          height: 1,
          thickness: 1,
          color: ViewerPalette.borderSoft,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final compact = mode == _DetailsMode.strip;
    final valueStyle = compact ? _kStripValueStyle : _kDetailValueStyle;
    final notesStyle = compact ? _kStripNotesStyle : _kNotesStyle;

    final serial = note.serial.trim();
    final watermark = note.watermark.trim();
    final url = note.url.trim();
    final notes = note.notes.trim();

    final grade = note.grade.trim().isEmpty
        ? null
        : _DetailField(label: 'Grade', value: GradePill(grade: note.grade));
    final serialField = serial.isEmpty
        ? null
        : _DetailField(
            label: 'Serial',
            value: SelectableText(serial, style: valueStyle),
          );
    final watermarkField = watermark.isEmpty
        ? null
        : _DetailField(
            label: 'Watermark',
            value: SelectableText(watermark, style: valueStyle),
          );
    final tagsField = note.tags.isEmpty
        ? null
        : _DetailField(
            label: 'Tags',
            value: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final tag in note.tags)
                  _TagChip(name: tag.name, onTap: () => onTagTap(tag.name)),
              ],
            ),
          );
    final sourceField = url.isEmpty
        ? null
        : _DetailField(
            label: 'Source',
            value: GestureDetector(
              onTap: _openSourceUrl,
              child: Text(
                url,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  color: _kTextAccent,
                  decoration: TextDecoration.underline,
                  fontSize: 14,
                ),
              ),
            ),
          );
    final notesField = notes.isEmpty
        ? null
        : _DetailField(
            label: 'Notes',
            value: Text(notes, style: notesStyle),
          );

    final fields = [
      grade,
      serialField,
      watermarkField,
      tagsField,
      sourceField,
      notesField,
    ].whereType<Widget>().toList(growable: false);

    final Widget content;
    if (compact) {
      // Four short facts across, then the two long fields share the row below
      // so a note reads in a couple of lines instead of a narrow column.
      final shortFields = [grade, serialField, watermarkField, tagsField];
      final hasShort = shortFields.any((field) => field != null);
      final longFields = (sourceField == null && notesField == null)
          ? null
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (sourceField != null)
                  Expanded(flex: 2, child: sourceField),
                if (sourceField != null && notesField != null)
                  const SizedBox(width: 22),
                if (notesField != null) Expanded(flex: 3, child: notesField),
              ],
            );
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (hasShort)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var column = 0; column < 4; column++) ...[
                  if (column > 0) const SizedBox(width: 22),
                  Expanded(
                    child: shortFields[column] ?? const SizedBox.shrink(),
                  ),
                ],
              ],
            ),
          if (hasShort && longFields != null) const SizedBox(height: 8),
          ?longFields,
        ],
      );
    } else {
      content = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < fields.length; i++) ...[
            if (i > 0) const SizedBox(height: 14),
            fields[i],
          ],
        ],
      );
    }

    return Container(
      padding: mode == _DetailsMode.stacked
          ? const EdgeInsets.all(20)
          : mode == _DetailsMode.strip
              ? const EdgeInsets.fromLTRB(16, 8, 16, 10)
              : const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _kDetailsBg,
        borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: mode == _DetailsMode.strip
            ? MainAxisSize.min
            : MainAxisSize.max,
        children: [
          _header(),
          if (fields.isNotEmpty) ...[
            SizedBox(height: compact ? 8 : 12),
            content,
          ],
        ],
      ),
    );
  }
}

class _DetailField extends StatelessWidget {
  const _DetailField({required this.label, required this.value});

  final String label;
  final Widget value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label.toUpperCase(), style: _kDetailLabelStyle),
        const SizedBox(height: 3),
        value,
      ],
    );
  }
}

class _TagChip extends StatelessWidget {
  const _TagChip({required this.name, required this.onTap});

  final String name;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
          decoration: BoxDecoration(
            color: _kTagChipBg,
            borderRadius: BorderRadius.circular(ViewerPalette.radiusChip),
            border: Border.all(color: _kTagChipBorder),
          ),
          child: Text(
            name,
            style: const TextStyle(
              fontFamily: 'Inter',
              color: _kTagChipText,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
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
                    color: _hovered
                        ? ViewerPalette.accentSoft
                        : ViewerPalette.roomSurface,
                    borderRadius:
                        BorderRadius.circular(ViewerPalette.radiusPill),
                    border: Border.all(
                      color: _hovered
                          ? ViewerPalette.accent
                          : ViewerPalette.roomBorderControl,
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Icon(
                      widget.left
                          ? Icons.chevron_left_rounded
                          : Icons.chevron_right_rounded,
                      color: _hovered
                          ? ViewerPalette.roomAccent
                          : ViewerPalette.roomText,
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

class _FirstSlideIntent extends Intent {
  const _FirstSlideIntent();
}

class _LastSlideIntent extends Intent {
  const _LastSlideIntent();
}

class _OpenImageIntent extends Intent {
  const _OpenImageIntent();
}

class _ScrollUpIntent extends Intent {
  const _ScrollUpIntent();
}

class _ScrollDownIntent extends Intent {
  const _ScrollDownIntent();
}
