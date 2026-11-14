import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import '../../app/viewer_palette.dart';
import '../../models/note_image.dart';
import '../../models/note_record.dart';
import '../../widgets/mouse_drag_scroll_behavior.dart';
import '../../widgets/note_image_provider.dart';
import 'image_zoom_levels.dart';
import 'slideshow_room_style.dart';

/// The virtual page the first image is pinned to. The popover pages an
/// unbounded [PageView] so that a swipe past either end wraps with no visible
/// seam; this leaves enough room behind the first image that a backwards wrap
/// never runs out of pages.
const int _kVirtualPageOrigin = 1 << 20;

/// The empty mat's words. The page's label and the live region borrow them so
/// the screen reader hears the same sentence the mat shows.
const String _kNoImageLabel = 'No image';

/// The failed note image's words, again shared by the mat, the page label and
/// the live region.
const String _kMissingFileNotice =
    'This image file is missing from the current collection.';

/// The page's hint at fit. Zoom is a gesture; the page's semantic tap performs
/// the same toggle for a reader who cannot double-click the note image.
const String _kPageZoomHint = 'Double-click to zoom';

/// The hint once the page is above fit, where the same tap returns to fit.
const String _kPageFitHint = 'Double-click to fit';

/// The counter's first line, shared by the visible pill and the page label so
/// the popover has one vocabulary for the image's position.
String _imagePositionLabel(int position, int total) =>
    'Image $position of $total';

/// A quiet step below the image position, so the note's position never
/// competes with the domain the pill is naming.
const TextStyle _kCounterNoteStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.roomMuted,
  fontWeight: FontWeight.w600,
  fontSize: 10.88,
  fontFeatures: [FontFeature.tabularFigures()],
);

class ImageSequenceItem {
  ImageSequenceItem({
    required this.note,
    required this.image,
    required this.face,
    this.notePosition = 1,
    this.noteTotal = 1,
  }) : assert(
         image == null || image.type == face,
         'face must name the image it carries',
       );

  final NoteRecord note;
  final NoteImage? image;

  /// `front` or `back`; the mat chip names the face from it even when [image]
  /// is missing, and it must agree with [image] when one is present.
  final String face;

  /// The note's 1-based position in the sequence, in the order it was opened.
  /// Never re-derived from a sort of the notes.
  final int notePosition;

  /// How many notes the sequence spans.
  final int noteTotal;

  String get label => note.title;

  /// The face in the room's vocabulary: `Front` or `Back`.
  String get faceLabel => face == 'front' ? 'Front' : 'Back';

  /// The counter's second line, or null when the sequence holds one note.
  String? get notePositionLabel =>
      noteTotal > 1 ? 'Note $notePosition of $noteTotal' : null;
}

class ImageLightbox extends StatefulWidget {
  const ImageLightbox({
    required this.items,
    required this.initialIndex,
    super.key,
  });

  final List<ImageSequenceItem> items;
  final int initialIndex;

  @override
  State<ImageLightbox> createState() => _ImageLightboxState();
}

class _ImageLightboxState extends State<ImageLightbox> {
  final _ImageZoomController _zoomController = _ImageZoomController();
  late final PageController _controller;
  late int _virtualIndex;
  bool _pageScrollEnabled = true;
  int _pageGeneration = 0;

  /// The image currently on screen, derived from the virtual page so paging
  /// past either end wraps without a seam.
  int get _currentIndex => widget.items.isEmpty
      ? 0
      : (_virtualIndex - _kVirtualPageOrigin) % widget.items.length;

  void _closeWithCurrentNote() {
    if (!mounted) {
      return;
    }

    Navigator.of(context).pop(widget.items[_currentIndex].note.id);
  }

  @override
  void initState() {
    super.initState();
    _virtualIndex = _kVirtualPageOrigin + widget.initialIndex;
    _controller = PageController(initialPage: _virtualIndex);
  }

  @override
  void dispose() {
    _zoomController.dispose();
    _controller.dispose();
    super.dispose();
  }

  /// Animates to the virtual page [page], used by a single-step arrow move.
  void _animateToPage(int page) {
    _controller.animateToPage(
      page,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  /// Jumps straight to the virtual page [page] with no page transition, used by
  /// Home, End and a wrap-around so a large sequence reaches its target
  /// immediately instead of animating through every page in between.
  void _jumpToPage(int page) {
    _controller.jumpToPage(page);
    setState(() => _virtualIndex = page);
  }

  bool get _atFirstPage => widget.items.isEmpty || _currentIndex <= 0;

  bool get _atLastPage =>
      widget.items.isEmpty || _currentIndex >= widget.items.length - 1;

  /// Moves one image back. The step always animates, so the wrap from the first
  /// image to the last glides across the seam exactly like a swipe does.
  void _goPrevious() {
    if (widget.items.length < 2) return;
    _animateToPage(_virtualIndex - 1);
  }

  /// Moves one image forward. The step always animates, so the wrap from the last
  /// image to the first glides across the seam exactly like a swipe does.
  void _goNext() {
    if (widget.items.length < 2) return;
    _animateToPage(_virtualIndex + 1);
  }

  void _goToFirst() {
    if (_atFirstPage) return;
    _jumpToPage(_virtualIndex - _currentIndex);
  }

  void _goToLast() {
    if (_atLastPage) return;
    _jumpToPage(_virtualIndex - _currentIndex + widget.items.length - 1);
  }

  void _setPageScrollEnabled(bool enabled) {
    if (_pageScrollEnabled == enabled) {
      return;
    }

    setState(() => _pageScrollEnabled = enabled);
  }

  /// The current note's front and back pages, or -1 for a face it does not
  /// carry. One pass, because the header asks for both on every build.
  ({int front, int back}) get _currentNoteFaces {
    final noteId = widget.items[_currentIndex].note.id;
    var front = -1;
    var back = -1;
    for (var index = 0; index < widget.items.length; index++) {
      final item = widget.items[index];
      if (item.note.id != noteId || item.image == null) {
        continue;
      }
      if (item.face == 'front' && front < 0) {
        front = index;
      } else if (item.face == 'back' && back < 0) {
        back = index;
      }
    }
    return (front: front, back: back);
  }

  /// Index of the current note's [face] page, or -1 when it has none.
  int _faceIndex(String face) {
    final faces = _currentNoteFaces;
    return face == 'front' ? faces.front : faces.back;
  }

  /// One label for the page at [index]: the words the visible header and mat
  /// show — the note's title and date, the face, and the counter's lines — then
  /// the state of the image when there is none to describe. The page owns these
  /// words; the header's copy is excluded from semantics so nothing is read
  /// twice.
  String _pageLabel(int index, {String? state}) {
    final item = widget.items[index];
    final date = item.note.issueDate.trim();
    return <String>[
      item.label,
      if (date.isNotEmpty) date,
      item.faceLabel,
      _imagePositionLabel(index + 1, widget.items.length),
      ?item.notePositionLabel,
      ?state,
    ].join(', ');
  }

  /// The page's identity for the live region's failure guard: the note plus
  /// the image, because a path-less image's cache key can repeat across notes.
  String _pageIdentity(ImageSequenceItem item) =>
      '${item.note.id}-${item.image!.cacheKey}';

  /// The live region's words: what moved — the face, the image position and
  /// the note position when shown — plus a state the page cannot name for
  /// itself. The page label already carries the title and date, so they are
  /// not repeated in the announcement.
  ///
  /// A failed note image belongs to the page that owns it, so its key must
  /// match the page on screen; a state left over from the page just paged away
  /// is never announced against the new one.
  String _pageAnnouncement(_ImageZoomState zoom) {
    final item = widget.items[_currentIndex];
    final String? state;
    if (item.image == null) {
      state = _kNoImageLabel;
    } else if (zoom.failed && zoom.pageKey == _pageIdentity(item)) {
      state = _kMissingFileNotice;
    } else {
      state = null;
    }

    return <String>[
      item.faceLabel,
      _imagePositionLabel(_currentIndex + 1, widget.items.length),
      ?item.notePositionLabel,
      ?state,
    ].join(', ');
  }

  /// Jumps to the current note's [face].
  void _selectFace(String face) {
    final target = _faceIndex(face);
    if (target < 0 || target == _currentIndex) {
      return;
    }

    _jumpToPage(_virtualIndex - _currentIndex + target);
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.items[_currentIndex];
    final faces = _currentNoteFaces;
    final roomed = roomedFor(MediaQuery.sizeOf(context));
    final roomInset = roomed ? kRoomInset : 0.0;
    final roomRadius = roomed ? ViewerPalette.radiusMd : 0.0;

    return Shortcuts(
      shortcuts: _kImageLightboxShortcuts,
      child: Actions(
        actions: <Type, Action<Intent>>{
          // Escape's own intent; see _CloseImageIntent for why it is not the
          // standard DismissIntent.
          _CloseImageIntent: CallbackAction<_CloseImageIntent>(
            onInvoke: (intent) {
              if (_zoomController.fit()) {
                return null;
              }
              _closeWithCurrentNote();
              return null;
            },
          ),
          _PreviousImageIntent: CallbackAction<_PreviousImageIntent>(
            onInvoke: (intent) {
              _goPrevious();
              return null;
            },
          ),
          _NextImageIntent: CallbackAction<_NextImageIntent>(
            onInvoke: (intent) {
              _goNext();
              return null;
            },
          ),
          _FirstImageIntent: CallbackAction<_FirstImageIntent>(
            onInvoke: (intent) {
              _goToFirst();
              return null;
            },
          ),
          _LastImageIntent: CallbackAction<_LastImageIntent>(
            onInvoke: (intent) {
              _goToLast();
              return null;
            },
          ),
          _ZoomInIntent: CallbackAction<_ZoomInIntent>(
            onInvoke: (intent) {
              _zoomController.zoomIn();
              return null;
            },
          ),
          _ZoomOutIntent: CallbackAction<_ZoomOutIntent>(
            onInvoke: (intent) {
              _zoomController.zoomOut();
              return null;
            },
          ),
          _PanImageIntent: CallbackAction<_PanImageIntent>(
            onInvoke: (intent) {
              final direction = intent.direction;
              // Pans in Zoom view. In fit view there is nothing to pan, so the
              // horizontal modified keys fall back to paging the sequence and
              // the vertical ones are a no-op.
              if (_zoomController.pan(direction.dx, direction.dy)) {
                return null;
              }
              if (direction == _PanDirection.left) {
                _goPrevious();
              } else if (direction == _PanDirection.right) {
                _goNext();
              }
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: PopScope<int>(
            canPop: false,
            onPopInvokedWithResult: (didPop, result) {
              if (didPop) {
                return;
              }

              _closeWithCurrentNote();
            },
            child: Scaffold(
              backgroundColor: ViewerPalette.roomScrim,
              body: Padding(
                padding: EdgeInsets.all(roomInset),
                child: DecoratedBox(
                  key: const ValueKey('imageRoom'),
                  decoration: BoxDecoration(
                    color: ViewerPalette.roomBackground,
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
                          _ImagePopoverHeader(
                            item: item,
                            counterPosition: _currentIndex + 1,
                            counterTotal: widget.items.length,
                            canShowFront: faces.front >= 0,
                            canShowBack: faces.back >= 0,
                            onSelectFace: _selectFace,
                            zoomController: _zoomController,
                            onBack: _closeWithCurrentNote,
                          ),
                          Expanded(
                            // The stage is the live region: it has real
                            // geometry, so the semantics tree keeps it, and its
                            // label changes with the page. Only what moved is
                            // announced; the page's own label owns the note's
                            // title and date. Zoom keeps its own readout so a
                            // pinch never re-announces the page.
                            child: ValueListenableBuilder<_ImageZoomState>(
                              valueListenable: _zoomController.state,
                              builder: (context, zoom, child) => Semantics(
                                container: true,
                                liveRegion: true,
                                label: _pageAnnouncement(zoom),
                                child: child,
                              ),
                              child: ScrollConfiguration(
                                // A mouse drag pages the sequence at fit scale;
                                // while zoomed the physics below are disabled so
                                // the drag pans the image instead.
                                behavior: const MouseDragScrollBehavior(),
                                child: PageView.builder(
                                  controller: _controller,
                                  physics: _pageScrollEnabled
                                      ? const PageScrollPhysics()
                                      : const NeverScrollableScrollPhysics(),
                                  itemCount: widget.items.isEmpty ? 0 : null,
                                  onPageChanged: (value) => setState(() {
                                    _virtualIndex = value;
                                    _pageGeneration += 1;
                                    _pageScrollEnabled = true;
                                  }),
                                  itemBuilder: (context, index) {
                                    final itemIndex =
                                        (index - _kVirtualPageOrigin) %
                                        widget.items.length;
                                    final imageItem = widget.items[itemIndex];
                                    // The page's one label. An imaged page adds
                                    // its load state from inside the page, where
                                    // the failure is known.
                                    final pageLabel = _pageLabel(
                                      itemIndex,
                                      state: imageItem.image == null
                                          ? _kNoImageLabel
                                          : null,
                                    );
                                    // The room's mat is the page; outside it,
                                    // an imaged page hugs its artifact and paints
                                    // its own plate on the canvas-soft stage, so
                                    // a portrait window never shows a thumbnail
                                    // in a metre of white.
                                    final hugArtifact =
                                        !roomed && imageItem.image != null;
                                    final content = imageItem.image == null
                                        ? const Center(
                                            child: Text(
                                              _kNoImageLabel,
                                              style: TextStyle(
                                                fontFamily: 'Inter',
                                                color: ViewerPalette.roomMuted,
                                                fontSize: 16,
                                              ),
                                            ),
                                          )
                                        : _ZoomableImagePage(
                                            key: ValueKey(
                                              '${imageItem.image!.cacheKey}-$index-$_pageGeneration',
                                            ),
                                            image: imageItem.image!,
                                            identity: _pageIdentity(imageItem),
                                            semanticLabel: pageLabel,
                                            faceLabel: imageItem.faceLabel,
                                            hugArtifact: hugArtifact,
                                            controller: _zoomController,
                                            onPageScrollEnabledChanged:
                                                _setPageScrollEnabled,
                                          );

                                    final page = Padding(
                                      padding: const EdgeInsets.fromLTRB(
                                        12,
                                        4,
                                        12,
                                        0,
                                      ),
                                      child: MouseRegion(
                                        cursor: imageItem.image == null
                                            ? MouseCursor.defer
                                            : SystemMouseCursors.zoomIn,
                                        child: hugArtifact
                                            ? content
                                            : Container(
                                                key: const ValueKey('imageMat'),
                                                decoration: _kMatDecoration,
                                                clipBehavior: Clip.antiAlias,
                                                child: Stack(
                                                  children: [
                                                    Positioned.fill(
                                                      child: Padding(
                                                        padding:
                                                            const EdgeInsets.all(
                                                              _kPlatePadding,
                                                            ),
                                                        child: content,
                                                      ),
                                                    ),
                                                    Positioned(
                                                      left: 8,
                                                      top: 8,
                                                      child: _FaceChip(
                                                        face:
                                                            imageItem.faceLabel,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                      ),
                                    );

                                    if (imageItem.image != null) {
                                      return page;
                                    }

                                    // A page with no image has no page widget to
                                    // name it, so the mat names itself. It is not
                                    // an image: there is no note image to show.
                                    return Semantics(
                                      container: true,
                                      label: pageLabel,
                                      excludeSemantics: true,
                                      child: page,
                                    );
                                  },
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
          ),
        ),
      ),
    );
  }
}

/// The white ground a note image sits on: the room's mat and the portrait
/// plate share the same surface, hairline and radius.
final BoxDecoration _kMatDecoration = BoxDecoration(
  color: ViewerPalette.roomSurface,
  borderRadius: BorderRadius.circular(ViewerPalette.radiusMd),
  border: Border.all(color: ViewerPalette.roomBorder),
);

/// The face on the mat, exactly as the slideshow's plate chip does, so the
/// image never loses its name. It is paint only: the page label already names
/// the face.
class _FaceChip extends StatelessWidget {
  const _FaceChip({required this.face});

  /// The room's vocabulary: `Front` or `Back`.
  final String face;

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: IgnorePointer(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
          decoration: plateOverlayDecoration(),
          child: Text(face.toUpperCase(), style: kPlateLabelStyle),
        ),
      ),
    );
  }
}

/// The header's segmented controls sit inside a 40px pill with a 2px inset.
const double _kSegmentHeight = kRoomControlHeight - 4;

/// Dense chrome clamps the reader's text scale so the five-stop instrument
/// still fits a phone; the title, counter and exit keep the full scale.
const double _kSegmentTextScale = 1.4;

/// Below this width the controls and a readable title cannot share one row, so
/// the title keeps the full width and the controls wrap beneath it. The test
/// grows with the reader's text scale, because the controls do too.
const double _kHeaderStackWidth = 900;

/// The title's share beside the controls on a wide window; the controls wrap
/// rather than squeeze it past this.
const double _kHeaderTitleMinWidth = 160;

/// The ink and figures every header control shares.
const TextStyle _kRoomControlStyle = TextStyle(
  fontFamily: 'Inter',
  fontWeight: FontWeight.w600,
  fontSize: 13,
  fontFeatures: [FontFeature.tabularFigures()],
);

/// The popover's top bar: the note title, then the counter, face toggle, zoom
/// instrument and exit. On a narrow window the title keeps the full width and
/// the controls wrap beneath it; a wide one puts them beside it, wrapping the
/// controls into another run rather than shrinking the title to nothing.
class _ImagePopoverHeader extends StatelessWidget {
  const _ImagePopoverHeader({
    required this.item,
    required this.counterPosition,
    required this.counterTotal,
    required this.canShowFront,
    required this.canShowBack,
    required this.onSelectFace,
    required this.zoomController,
    required this.onBack,
  });

  final ImageSequenceItem item;
  final int counterPosition;
  final int counterTotal;
  final bool canShowFront;
  final bool canShowBack;
  final ValueChanged<String> onSelectFace;
  final _ImageZoomController zoomController;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final controls = <Widget>[
      _counterPill(),
      _faceToggle(),
      ValueListenableBuilder<_ImageZoomState>(
        valueListenable: zoomController.state,
        builder: (context, state, child) => _zoomInstrument(state),
      ),
      ConstrainedBox(
        constraints: const BoxConstraints(minHeight: kRoomControlHeight),
        child: OutlinedButton(
          onPressed: onBack,
          child: const Text('Back to note'),
        ),
      ),
    ];
    final title = _titleBlock();

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: LayoutBuilder(
        builder: (context, constraints) {
          // A narrow window, or a large text scale on any window, cannot hold
          // the title and all four controls on one row. The threshold grows
          // with the text scale because the controls grow with it; past 2x the
          // stack holds on every sensible width.
          final textScale = MediaQuery.textScalerOf(context)
              .scale(1)
              .clamp(1.0, 2.0);
          if (constraints.maxWidth < _kHeaderStackWidth * textScale) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                title,
                const SizedBox(height: 8),
                // The Wrap keeps the controls on one line when they fit and
                // sends them below the title when a large text size or a
                // narrow phone leaves no room.
                Align(
                  alignment: Alignment.centerRight,
                  child: Wrap(
                    alignment: WrapAlignment.end,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 10,
                    runSpacing: 8,
                    children: controls,
                  ),
                ),
              ],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: title),
              const SizedBox(width: 12),
              // The controls take what they need up to a cap that keeps the
              // title readable; past it they wrap into a second run instead of
              // pushing the row past the window.
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxWidth: math.max(
                    0,
                    constraints.maxWidth - 12 - _kHeaderTitleMinWidth,
                  ),
                ),
                child: Wrap(
                  alignment: WrapAlignment.end,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: controls,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _titleBlock() {
    // The page label owns the title and the date; the header's copy is sight
    // only so a reader does not hear the same words twice.
    return ExcludeSemantics(
      child: Align(
        alignment: Alignment.centerLeft,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              item.label,
              style: const TextStyle(
                fontFamily: 'Inter',
                color: ViewerPalette.roomText,
                fontSize: 17,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.2,
              ),
              overflow: TextOverflow.ellipsis,
            ),
            if (item.note.issueDate.trim().isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(
                item.note.issueDate,
                style: const TextStyle(
                  fontFamily: 'Inter',
                  color: ViewerPalette.roomMuted,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _counterPill() {
    // The page label repeats the counter's lines, so the pill is sight only.
    final notePosition = item.notePositionLabel;
    return ExcludeSemantics(
      child: Container(
        constraints: const BoxConstraints(minHeight: kRoomControlHeight),
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: _pillDecoration(),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _imagePositionLabel(counterPosition, counterTotal),
              style: kRoomCounterStyle,
            ),
            if (notePosition != null) ...[
              const SizedBox(height: 1),
              Text(notePosition, style: _kCounterNoteStyle),
            ],
          ],
        ),
      ),
    );
  }

  /// A side toggle: pressing the other face jumps to it instead of walking
  /// the sequence.
  Widget _faceToggle() {
    return _segmentPill([
      _segment(
        label: 'Front',
        title: canShowFront
            ? 'Show the front image'
            : 'No front image for this note',
        selected: item.face == 'front',
        onPressed: canShowFront ? () => onSelectFace('front') : null,
      ),
      _segment(
        label: 'Back',
        title: canShowBack
            ? 'Show the back image'
            : 'No back image for this note',
        selected: item.face == 'back',
        onPressed: canShowBack ? () => onSelectFace('back') : null,
      ),
    ]);
  }

  /// The Editor's scale instrument: Fit | 1:1, then - level +.
  Widget _zoomInstrument(_ImageZoomState state) {
    final enabled = state.zoomable;
    final atFit = enabled && state.atFit;
    final atActualSize = enabled && state.atActualSize;
    final levelPercent = state.levelPercent;
    final levelColor = enabled
        ? ViewerPalette.roomMuted
        : ViewerPalette.controlDisabledText;

    return Semantics(
      container: true,
      label: 'Image zoom',
      explicitChildNodes: true,
      child: _segmentPill([
        _segment(
          label: 'Fit',
          title: 'Fit the image to the plate',
          selected: atFit,
          onPressed: state.canStepOut ? zoomController.fit : null,
        ),
        _segment(
          label: '1:1',
          title: state.actualSizeTitle,
          selected: atActualSize,
          onPressed: state.canShowActualSize
              ? () => zoomController.zoomToActualSize()
              : null,
        ),
        Container(
          width: 1,
          height: 18,
          margin: const EdgeInsets.symmetric(horizontal: 3),
          color: ViewerPalette.roomBorder,
        ),
        _segment(
          label: 'Zoom out',
          glyph: '\u2212',
          title: 'Zoom out (-)',
          onPressed: state.canStepOut ? zoomController.zoomOut : null,
        ),
        Semantics(
          container: true,
          liveRegion: true,
          excludeSemantics: true,
          label: 'Zoom level',
          value: levelPercent == null ? 'unknown' : '$levelPercent%',
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 42),
            child: Text(
              levelPercent == null ? '\u2014' : '$levelPercent%',
              textAlign: TextAlign.center,
              style: _kRoomControlStyle.copyWith(color: levelColor),
            ),
          ),
        ),
        _segment(
          label: 'Zoom in',
          glyph: '+',
          title: 'Zoom in (+)',
          onPressed: state.canStepIn ? zoomController.zoomIn : null,
        ),
      ]),
    );
  }

  /// One focusable segment. Every stop is a button in the tree: a toggle passes
  /// [selected] and carries the pressed mark, a step passes a [glyph] and
  /// leaves it null. The [Semantics] wrapper also owns the tap action so the
  /// label, state and action stay one node, never the glyph and its parent
  /// button separately.
  Widget _segment({
    required String label,
    required String title,
    required VoidCallback? onPressed,
    bool? selected,
    String? glyph,
  }) {
    final button = Tooltip(
      message: title,
      child: TextButton(
        onPressed: onPressed,
        style: _segmentStyle(
          selected: selected ?? false,
          enabled: onPressed != null,
        ),
        child: Text(glyph ?? label),
      ),
    );

    return Semantics(
      container: true,
      button: true,
      enabled: onPressed != null,
      toggled: selected,
      label: label,
      tooltip: title,
      onTap: onPressed,
      excludeSemantics: true,
      child: button,
    );
  }

  BoxDecoration _pillDecoration() {
    return BoxDecoration(
      color: ViewerPalette.roomSurface,
      borderRadius: BorderRadius.circular(ViewerPalette.radiusPill),
      border: Border.all(color: ViewerPalette.roomBorderControl),
    );
  }

  /// A 40px pill with a 2px inset holding one row of segments.
  ///
  /// The pill is dense chrome with five stops, so the reader's text scale is
  /// clamped here: at 200% the instrument is wider than a phone and could only
  /// wrap into an unreadable stack. The title, counter and exit keep the full
  /// scale.
  Widget _segmentPill(List<Widget> children) {
    return Container(
      height: kRoomControlHeight,
      padding: const EdgeInsets.all(2),
      decoration: _pillDecoration(),
      child: MediaQuery.withClampedTextScaling(
        maxScaleFactor: _kSegmentTextScale,
        child: Row(mainAxisSize: MainAxisSize.min, children: children),
      ),
    );
  }

  /// A pressed stop keeps its accent mark even when it is also disabled, so
  /// "you are here" and "nothing to do" read as one state.
  ButtonStyle _segmentStyle({required bool selected, required bool enabled}) {
    final Color color;
    if (selected) {
      color = ViewerPalette.roomAccent;
    } else if (enabled) {
      color = ViewerPalette.roomText;
    } else {
      color = ViewerPalette.controlDisabledText;
    }
    final background = selected
        ? ViewerPalette.roomSelection
        : Colors.transparent;

    return TextButton.styleFrom(
      minimumSize: const Size(0, _kSegmentHeight),
      padding: const EdgeInsets.symmetric(horizontal: 10),
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      foregroundColor: color,
      backgroundColor: background,
      disabledForegroundColor: color,
      disabledBackgroundColor: background,
      overlayColor: ViewerPalette.accentSoft,
      shape: const StadiumBorder(),
      textStyle: _kRoomControlStyle,
    ).copyWith(side: const WidgetStatePropertyAll(BorderSide.none));
  }
}

/// What the header needs to know about the page on screen: the live scale, the
/// stops around it, and whether there are pixels to step through at all.
@immutable
class _ImageZoomState {
  const _ImageZoomState({
    this.hasPage = false,
    this.ready = false,
    this.failed = false,
    this.scale = 1,
    this.realScale = 1,
    this.topStop = 1,
    this.pageKey,
  });

  /// Whether any image page is mounted. A page with no image mounts none, so
  /// this is what tells "no image here" apart from "the scan is still loading".
  final bool hasPage;
  final bool ready;
  final bool failed;

  /// The scan the state describes. A failed state must only be announced
  /// against the page that owns it, never the one the reader just paged to.
  final String? pageKey;

  /// The scale relative to the fit view: 1 is fit, [realScale] is 1:1.
  final double scale;
  final double realScale;

  /// The ladder's highest stop above fit. Pinch can go past it up to the cap;
  /// the stepper stops here.
  final double topStop;

  /// A page is mounted with a known size and no load failure.
  bool get available => hasPage && ready && !failed;

  bool get zoomable => available && topStop > 1 + _kZoomEpsilon;

  bool get atFit => scale <= 1 + _kZoomEpsilon;

  bool get atActualSize =>
      scale > 1 + _kZoomEpsilon && (scale - realScale).abs() < _kZoomEpsilon;

  /// The 1:1 stop is inert when the fit is already actual size, and pressed
  /// once the reader is there; otherwise it lands on the scan's real size.
  bool get canShowActualSize =>
      zoomable && realScale > 1 + _kZoomEpsilon && !atActualSize;

  /// Whether the reader can step down to fit or up one stop.
  bool get canStepOut => zoomable && !atFit;

  bool get canStepIn => zoomable && scale < topStop - _kZoomEpsilon;

  /// The live level as a percentage of the scan's real size.
  int? get levelPercent => available ? (scale / realScale * 100).round() : null;

  String get actualSizeTitle {
    if (!hasPage || failed) {
      return 'Image unavailable';
    }
    if (!ready) {
      return 'The image is still loading';
    }
    if (realScale <= 1 + _kZoomEpsilon) {
      return 'The fit view already shows the image at its real size or larger';
    }
    if (atActualSize) {
      return 'The image already shows one image pixel per screen pixel';
    }
    return 'Show the image at one image pixel per screen pixel';
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is _ImageZoomState &&
          other.hasPage == hasPage &&
          other.ready == ready &&
          other.failed == failed &&
          other.scale == scale &&
          other.realScale == realScale &&
          other.topStop == topStop &&
          other.pageKey == pageKey;

  @override
  int get hashCode =>
      Object.hash(hasPage, ready, failed, scale, realScale, topStop, pageKey);
}

class _PreviousImageIntent extends Intent {
  const _PreviousImageIntent();
}

/// Escape's private intent. The standard [DismissIntent] is not used because a
/// Scaffold's disabled drawer action shadows it once a control holds focus.
class _CloseImageIntent extends Intent {
  const _CloseImageIntent();
}

class _NextImageIntent extends Intent {
  const _NextImageIntent();
}

class _FirstImageIntent extends Intent {
  const _FirstImageIntent();
}

class _LastImageIntent extends Intent {
  const _LastImageIntent();
}

class _ZoomInIntent extends Intent {
  const _ZoomInIntent();
}

class _ZoomOutIntent extends Intent {
  const _ZoomOutIntent();
}

class _PanImageIntent extends Intent {
  const _PanImageIntent(this.direction);

  final _PanDirection direction;
}

/// A pan direction. The dx/dy steps are multiples of 5% of the overflow; the
/// horizontal directions also page the sequence when the image is not pannable.
enum _PanDirection {
  left(dx: 1.0, dy: 0.0),
  right(dx: -1.0, dy: 0.0),
  up(dx: 0.0, dy: 1.0),
  down(dx: 0.0, dy: -1.0);

  const _PanDirection({required this.dx, required this.dy});

  final double dx;
  final double dy;
}

/// The arrow keys with h/j/k/l aliased onto them.
final Map<LogicalKeyboardKey, _PanDirection> _kPanDirections = {
  LogicalKeyboardKey.arrowLeft: _PanDirection.left,
  LogicalKeyboardKey.keyH: _PanDirection.left,
  LogicalKeyboardKey.arrowRight: _PanDirection.right,
  LogicalKeyboardKey.keyL: _PanDirection.right,
  LogicalKeyboardKey.arrowUp: _PanDirection.up,
  LogicalKeyboardKey.keyK: _PanDirection.up,
  LogicalKeyboardKey.arrowDown: _PanDirection.down,
  LogicalKeyboardKey.keyJ: _PanDirection.down,
};

/// Ctrl, Cmd and Shift are interchangeable for the pans, so each direction key
/// gets one activator per modifier. A [SingleActivator] requires every modifier
/// it does not name to be up, so the three cannot share a single activator.
List<SingleActivator> _panActivatorsFor(LogicalKeyboardKey key) =>
    <SingleActivator>[
      SingleActivator(key, shift: true),
      SingleActivator(key, control: true),
      SingleActivator(key, meta: true),
    ];

/// The Image popover's keyboard map. Plain Left/Right and h/l page the
/// sequence; the modified directions pan in Zoom view and, when the image is
/// not pannable, fall back to paging on the horizontal axis. Alt is named on
/// no activator, so Alt + arrow stays inert.
final Map<ShortcutActivator, Intent> _kImageLightboxShortcuts =
    _buildImageLightboxShortcuts();

Map<ShortcutActivator, Intent> _buildImageLightboxShortcuts() {
  final shortcuts = <ShortcutActivator, Intent>{
    const SingleActivator(LogicalKeyboardKey.escape): const _CloseImageIntent(),
    const SingleActivator(LogicalKeyboardKey.arrowLeft):
        const _PreviousImageIntent(),
    const SingleActivator(LogicalKeyboardKey.keyH):
        const _PreviousImageIntent(),
    const SingleActivator(LogicalKeyboardKey.arrowRight):
        const _NextImageIntent(),
    const SingleActivator(LogicalKeyboardKey.keyL): const _NextImageIntent(),
    const SingleActivator(LogicalKeyboardKey.home): const _FirstImageIntent(),
    const SingleActivator(LogicalKeyboardKey.end): const _LastImageIntent(),
    const SingleActivator(LogicalKeyboardKey.equal, shift: true):
        const _ZoomInIntent(),
    const SingleActivator(LogicalKeyboardKey.add): const _ZoomInIntent(),
    const SingleActivator(LogicalKeyboardKey.numpadAdd): const _ZoomInIntent(),
    const SingleActivator(LogicalKeyboardKey.minus): const _ZoomOutIntent(),
    const SingleActivator(LogicalKeyboardKey.minus, shift: true):
        const _ZoomOutIntent(),
    const SingleActivator(LogicalKeyboardKey.numpadSubtract):
        const _ZoomOutIntent(),
  };

  for (final direction in _kPanDirections.entries) {
    for (final activator in _panActivatorsFor(direction.key)) {
      shortcuts[activator] = _PanImageIntent(direction.value);
    }
  }

  return shortcuts;
}

/// How close two scales must be before they count as the same stop.
const double _kZoomEpsilon = 1e-3;

/// The white padding a mat or plate keeps around the scan. On a page that hugs
/// its artifact the plate is the scan plus this padding on every side.
const double _kPlatePadding = 16;

/// Routes zoom/pan intents from the lightbox (which owns keyboard focus) to the
/// currently visible [_ZoomableImagePage], and publishes the live scale so the
/// header can show it without guessing from a rebuild.
class _ImageZoomController {
  final ValueNotifier<_ImageZoomState> _state = ValueNotifier<_ImageZoomState>(
    const _ImageZoomState(),
  );

  /// The live state for the header. Read-only so only the active page writes.
  ValueListenable<_ImageZoomState> get state => _state;

  _ZoomableImagePageState? _active;
  bool _publishScheduled = false;
  bool _disposed = false;

  void attach(_ZoomableImagePageState page) {
    _active = page;
    // A page mounts during the PageView's build, so its first state must wait
    // for the frame; notifying a ValueListenableBuilder mid-build is an error.
    requestPublish();
  }

  void detach(_ZoomableImagePageState page) {
    if (!identical(_active, page)) {
      return;
    }

    _active = null;
    // Disposal also runs while the PageView rebuilds; defer the reset so the
    // header is not marked dirty during that build.
    requestPublish();
  }

  /// Publishes the active page's current state after the frame. Pages attach,
  /// detach and resize inside a build, and a paused frame may queue several
  /// requests; one pull at the boundary always reads the latest state.
  void requestPublish() {
    if (_publishScheduled || _disposed) {
      return;
    }

    _publishScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _publishScheduled = false;
      if (_disposed) {
        return;
      }

      final active = _active;
      if (active == null) {
        _state.value = const _ImageZoomState();
      } else {
        active.publishZoomState();
      }
    });
  }

  void publish(_ImageZoomState next) {
    if (_disposed) {
      return;
    }

    // A cached image answers its listener synchronously while the page mounts,
    // so a publish that lands inside build waits for the frame boundary.
    if (WidgetsBinding.instance.schedulerPhase ==
        SchedulerPhase.persistentCallbacks) {
      requestPublish();
      return;
    }

    _state.value = next;
  }

  /// Whether [page] is the one the header is describing. A page that has been
  /// paged away may still answer a late image or pinch event; its level must
  /// not overwrite the visible page's.
  bool isActive(_ZoomableImagePageState page) => identical(_active, page);

  void zoomIn() => _active?.zoomIn();

  void zoomOut() => _active?.zoomOut();

  /// Returns the active page to the fit view, telling whether it moved.
  bool fit() => _active?.fit() ?? false;

  /// Lands the active page on the scan's real size.
  void zoomToActualSize() => _active?.zoomToActualSize();

  /// Pans the active page. Returns whether the image is pannable; when it is
  /// not, the caller falls back to paging on the horizontal axis.
  bool pan(double dx, double dy) => _active?.pan(dx, dy) ?? false;

  void dispose() {
    _disposed = true;
    _state.dispose();
  }
}

class _ZoomableImagePage extends StatefulWidget {
  const _ZoomableImagePage({
    required this.image,
    required this.identity,
    required this.semanticLabel,
    required this.faceLabel,
    required this.hugArtifact,
    required this.controller,
    required this.onPageScrollEnabledChanged,
    super.key,
  });

  final NoteImage image;

  /// The note plus the image, used to keep this page's failure from being
  /// announced against the page the reader paged to.
  final String identity;

  /// The page's words: the note, face and counter, without the image's state.
  /// The page adds a failed note image from its own load, where that state
  /// lives.
  final String semanticLabel;

  /// The room's vocabulary: `Front` or `Back`, painted on the page's own
  /// plate when it hugs the artifact.
  final String faceLabel;

  /// Whether this page paints a plate sized to the scan and its padding (the
  /// portrait fit) instead of filling the room's mat. Once above fit the plate
  /// returns to the whole stage, so the zoom keeps its own overflow rules.
  final bool hugArtifact;

  final _ImageZoomController controller;
  final ValueChanged<bool> onPageScrollEnabledChanged;

  @override
  State<_ZoomableImagePage> createState() => _ZoomableImagePageState();
}

class _ZoomableImagePageState extends State<_ZoomableImagePage> {
  static const double _kMaxZoomCap = 12;
  static const double _kMinSpan = 1;
  static const double _kPanOverflowFraction = 0.05;

  /// How close to the fit size (as a fraction of it) a narrowing pinch must
  /// get before it is drawn all the way back to fit. Pinching out rarely lands
  /// exactly on fit, and any leftover zoom keeps the sequence unswipeable until
  /// a double tap resets it.
  static const double _kFitSnapFraction = 0.2;

  final Map<int, Offset> _activePointers = <int, Offset>{};
  ImageStream? _imageStream;
  ImageStreamListener? _imageStreamListener;

  Size? _intrinsicSize;
  Size _viewport = Size.zero;
  Offset? _lastDoubleTapPosition;
  double _scale = 1;
  Offset _offset = Offset.zero;
  Offset? _lastFocalPoint;
  double? _lastSpan;
  // A scan can be missing from the collection; the header's zoom cluster says
  // so by going inert rather than stepping through pixels that are not there.
  bool _loadFailed = false;
  // The scale when the current pinch began, so a pinch that narrows the image
  // can be told apart from one that enlarges it.
  double? _pinchStartScale;
  bool _isPannable = false;
  int? _dragPointer;
  Offset? _dragStartPosition;
  Offset? _dragStartOffset;

  @override
  void initState() {
    super.initState();
    widget.controller.attach(this);
    _resolveImage();
  }

  @override
  void didUpdateWidget(covariant _ZoomableImagePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.detach(this);
      widget.controller.attach(this);
    }
    if (oldWidget.image.cacheKey != widget.image.cacheKey) {
      _removeImageListener();
      _activePointers.clear();
      _intrinsicSize = null;
      _loadFailed = false;
      _lastDoubleTapPosition = null;
      _scale = 1;
      _offset = Offset.zero;
      _lastFocalPoint = null;
      _lastSpan = null;
      _pinchStartScale = null;
      _cancelDrag();
      _isPannable = false;
      _resolveImage();
      _syncPageScroll();
      publishZoomState();
    }
  }

  @override
  void dispose() {
    widget.controller.detach(this);
    _removeImageListener();
    widget.onPageScrollEnabledChanged(true);
    super.dispose();
  }

  // --- Zoom / pan entry points (driven by the lightbox keyboard shortcuts) ---

  /// Whether the page is at the fit view, the one state the plate hugs.
  bool get _atFit => _scale <= 1 + _kZoomEpsilon;

  void zoomIn() => _changeZoom(1);

  void zoomOut() => _changeZoom(-1);

  /// Returns to the fit view, which also re-enables paging. Returns whether
  /// the page moved.
  bool fit() {
    if (_atFit) {
      return false;
    }

    _resetZoom();
    return true;
  }

  /// Lands on the scan's real size: one image pixel per screen pixel.
  void zoomToActualSize({Offset? focalPoint}) {
    if (_viewport.isEmpty) {
      return;
    }

    final target = _realSizeScale(_viewport).clamp(1.0, _maxScale);
    if (target <= 1 + _kZoomEpsilon) {
      return;
    }

    _applyScale(
      target,
      focalPoint: focalPoint ?? _viewport.center(Offset.zero),
    );
  }

  /// Pans by [dx]/[dy] steps of 5% of the overflow. Returns whether the image
  /// is pannable; when it is not (i.e. in fit view) the caller falls back to
  /// paging.
  bool pan(double dx, double dy) {
    if (!_isPannable || _viewport.isEmpty) {
      return false;
    }

    final contentSize = _fittedContentSize(_viewport);
    final overflowX = math.max(
      0.0,
      contentSize.width * _scale - _viewport.width,
    );
    final overflowY = math.max(
      0.0,
      contentSize.height * _scale - _viewport.height,
    );
    final delta = Offset(
      dx * overflowX * _kPanOverflowFraction,
      dy * overflowY * _kPanOverflowFraction,
    );
    if (delta != Offset.zero) {
      setState(() {
        _offset = _clampOffset(
          offset: _offset + delta,
          viewport: _viewport,
          contentSize: contentSize,
          scale: _scale,
        );
      });
    }
    return true;
  }

  void _resetZoom() {
    setState(() {
      _scale = 1;
      _offset = Offset.zero;
    });
    _syncPageScroll();
    publishZoomState();
  }

  void _changeZoom(int direction, {Offset? focalPoint}) {
    if (_viewport.isEmpty) {
      return;
    }

    final stops = imageZoomStops(
      realSizeScale: _realSizeScale(_viewport),
      maxScale: _maxScale,
    );
    final nextScale = direction > 0
        ? nextImageZoomStop(stops, _scale)
        : previousImageZoomStop(stops, _scale);

    if (nextScale == null) {
      if (direction < 0) {
        // Already at the bottom stop: step back to the fit view.
        _resetZoom();
      }
      return;
    }

    _applyScale(
      nextScale,
      focalPoint: focalPoint ?? _viewport.center(Offset.zero),
    );
  }

  void _applyScale(double nextScale, {required Offset focalPoint}) {
    final contentSize = _fittedContentSize(_viewport);
    final nextOffset = _offsetForScale(
      focalPoint: focalPoint,
      viewport: _viewport,
      contentSize: contentSize,
      currentScale: _scale,
      nextScale: nextScale,
      currentOffset: _offset,
    );

    setState(() {
      _scale = nextScale;
      _offset = nextOffset;
    });
    _syncPageScroll();
    publishZoomState();
  }

  double get _maxScale =>
      math.max(_viewport.isEmpty ? 1 : _realSizeScale(_viewport), _kMaxZoomCap);

  void _syncPageScroll() {
    final enabled = _activePointers.length < 2 && _atFit;
    widget.onPageScrollEnabledChanged(enabled);
  }

  /// Publishes the live scale so the header's readout and stops follow the
  /// image rather than a rebuild guess. Called after every scale change and
  /// once the viewport or the image's own size is known.
  void publishZoomState() {
    if (!mounted || !widget.controller.isActive(this)) {
      return;
    }

    final ready = !_viewport.isEmpty && _intrinsicSize != null && !_loadFailed;
    final pageKey = widget.identity;
    if (!ready) {
      widget.controller.publish(
        _ImageZoomState(hasPage: true, failed: _loadFailed, pageKey: pageKey),
      );
      return;
    }

    final realScale = _realSizeScale(_viewport);
    final stops = imageZoomStops(realSizeScale: realScale, maxScale: _maxScale);
    widget.controller.publish(
      _ImageZoomState(
        hasPage: true,
        ready: true,
        scale: _scale,
        realScale: realScale,
        topStop: stops.isEmpty ? 1 : stops.last,
        pageKey: pageKey,
      ),
    );
  }

  void _cancelDrag() {
    _dragPointer = null;
    _dragStartPosition = null;
    _dragStartOffset = null;
  }

  void _resolveImage() {
    final provider = createNoteImageProvider(widget.image);
    final stream = provider.resolve(const ImageConfiguration());
    _imageStream = stream;
    _imageStreamListener = ImageStreamListener(
      (imageInfo, _) {
        if (!mounted) {
          return;
        }

        setState(() {
          _intrinsicSize = Size(
            imageInfo.image.width.toDouble(),
            imageInfo.image.height.toDouble(),
          );
        });
        publishZoomState();
      },
      onError: (error, stackTrace) {
        if (!mounted) {
          return;
        }

        setState(() => _loadFailed = true);
        publishZoomState();
      },
    );
    stream.addListener(_imageStreamListener!);
  }

  void _removeImageListener() {
    final listener = _imageStreamListener;
    final stream = _imageStream;
    if (listener != null && stream != null) {
      stream.removeListener(listener);
    }
    _imageStreamListener = null;
    _imageStream = null;
  }

  void _handlePointerDown(PointerDownEvent event) {
    _activePointers[event.pointer] = event.localPosition;
    if (_activePointers.length >= 2) {
      _cancelDrag();
      _pinchStartScale ??= _scale;
      _lastFocalPoint = _currentFocalPoint();
      _lastSpan = _currentSpan();
      _syncPageScroll();
      return;
    }

    if (_isPannable && (event.buttons & kPrimaryButton) != 0) {
      _dragPointer = event.pointer;
      _dragStartPosition = event.localPosition;
      _dragStartOffset = _offset;
    }
  }

  void _handlePointerMove(
    PointerMoveEvent event,
    Size viewport,
    double maxScale,
  ) {
    if (!_activePointers.containsKey(event.pointer)) {
      return;
    }

    _activePointers[event.pointer] = event.localPosition;

    if (_activePointers.length >= 2) {
      _handlePinchMove(viewport, maxScale);
      return;
    }

    final dragStartPosition = _dragStartPosition;
    final dragStartOffset = _dragStartOffset;
    if (_dragPointer == event.pointer &&
        dragStartPosition != null &&
        dragStartOffset != null) {
      final delta = event.localPosition - dragStartPosition;
      setState(() {
        _offset = _clampOffset(
          offset: dragStartOffset + delta,
          viewport: viewport,
          contentSize: _fittedContentSize(viewport),
          scale: _scale,
        );
      });
    }
  }

  void _handlePinchMove(Size viewport, double maxScale) {
    final focalPoint = _currentFocalPoint();
    final span = _currentSpan();
    final previousFocalPoint = _lastFocalPoint ?? focalPoint;
    final previousSpan = (_lastSpan ?? span).clamp(_kMinSpan, double.infinity);
    final focalDelta = focalPoint - previousFocalPoint;

    var nextScale = _scale;
    if (span > 0 && previousSpan > 0) {
      nextScale = (_scale * (span / previousSpan)).clamp(1.0, maxScale);
    }

    // A pinch that is narrowing the image and has reached within
    // [_kFitSnapFraction] of fit is drawn the rest of the way, so releasing it
    // leaves the image swipeable instead of a few pixels above fit.
    final startScale = _pinchStartScale;
    final snapToFit =
        startScale != null &&
        _pinchSettlesToFit(scale: nextScale, startScale: startScale);
    if (snapToFit) {
      nextScale = 1;
    }

    var nextOffset = _offset + focalDelta;
    nextOffset = _offsetForScale(
      focalPoint: focalPoint,
      viewport: viewport,
      contentSize: _fittedContentSize(viewport),
      currentScale: _scale,
      nextScale: nextScale,
      currentOffset: nextOffset,
    );

    setState(() {
      _scale = nextScale;
      _offset = snapToFit
          ? Offset.zero
          : _clampOffset(
              offset: nextOffset,
              viewport: viewport,
              contentSize: _fittedContentSize(viewport),
              scale: _scale,
            );
    });

    _lastFocalPoint = focalPoint;
    _lastSpan = math.max(span, _kMinSpan);
    _syncPageScroll();
    publishZoomState();
  }

  void _handlePointerEnd(PointerEvent event) {
    _activePointers.remove(event.pointer);
    if (_dragPointer == event.pointer) {
      _cancelDrag();
    }
    if (_activePointers.length < 2) {
      _lastFocalPoint = null;
      _lastSpan = null;
      _settlePinchToFit();
    }
    _syncPageScroll();
  }

  /// Settles a pinch that ended just short of fit onto fit. The snap is applied
  /// live during the pinch, but a dropped final move event can leave the last
  /// scale a little above fit, so this catches the release as well.
  void _settlePinchToFit() {
    final startScale = _pinchStartScale;
    _pinchStartScale = null;
    if (startScale == null ||
        !_pinchSettlesToFit(scale: _scale, startScale: startScale)) {
      return;
    }

    _resetZoom();
  }

  /// Whether a pinch that started at [startScale] and has been drawn down to
  /// [scale] is narrowing the image and is close enough to fit to settle onto
  /// it. A pinch that is enlarging the image is never snapped, so the first few
  /// percent of a deliberate zoom-in are not swallowed.
  bool _pinchSettlesToFit({
    required double scale,
    required double startScale,
  }) => scale < startScale && scale <= 1 + _kFitSnapFraction;

  void _handlePointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) {
      return;
    }

    // Claim the scroll so the surrounding PageView does not also scroll.
    GestureBinding.instance.pointerSignalResolver.register(event, (resolved) {
      if (resolved is! PointerScrollEvent) {
        return;
      }

      _changeZoom(
        resolved.scrollDelta.dy < 0 ? 1 : -1,
        focalPoint: resolved.localPosition,
      );
    });
  }

  Offset _currentFocalPoint() {
    final positions = _activePointers.values.toList(growable: false);
    final sum = positions.fold<Offset>(
      Offset.zero,
      (total, value) => total + value,
    );
    return sum / positions.length.toDouble();
  }

  double _currentSpan() {
    final positions = _activePointers.values.toList(growable: false);
    if (positions.length < 2) {
      return _kMinSpan;
    }

    return (positions[0] - positions[1]).distance;
  }

  Size _imageLogicalSize(BuildContext context) {
    final intrinsicSize = _intrinsicSize;
    if (intrinsicSize == null) {
      return const Size(1, 1);
    }

    final devicePixelRatio = MediaQuery.devicePixelRatioOf(context);
    return Size(
      intrinsicSize.width / devicePixelRatio,
      intrinsicSize.height / devicePixelRatio,
    );
  }

  Size _fittedContentSize(Size viewport) {
    final intrinsicSize = _intrinsicSize;
    if (intrinsicSize == null || viewport.isEmpty) {
      return viewport;
    }

    final box = _fitBox(viewport);
    final devicePixelRatio = MediaQuery.devicePixelRatioOf(context);
    final logicalSize = Size(
      intrinsicSize.width / devicePixelRatio,
      intrinsicSize.height / devicePixelRatio,
    );
    final fitScale = math.min(
      box.width / logicalSize.width,
      box.height / logicalSize.height,
    );
    return Size(logicalSize.width * fitScale, logicalSize.height * fitScale);
  }

  /// The box the scan fits into: the whole stage in the room, or the stage
  /// inside the plate's padding when the page hugs its artifact, so the plate
  /// never exceeds the stage.
  Size _fitBox(Size viewport) {
    if (!widget.hugArtifact) {
      return viewport;
    }

    return Size(
      math.max(0, viewport.width - _kPlatePadding * 2),
      math.max(0, viewport.height - _kPlatePadding * 2),
    );
  }

  /// The plate's size on a page that hugs its artifact, or null while there is
  /// no measured scan to frame. At fit it is the scan plus 16px on every side
  /// (the hairline is drawn inside that padding); above fit, and for a scan
  /// that would not load, it is the whole stage, so it never exceeds it.
  Size? _plateSize(Size viewport, Size contentSize) {
    if (_loadFailed) {
      return viewport;
    }
    if (_intrinsicSize == null) {
      return null;
    }
    if (!_atFit) {
      return viewport;
    }

    return Size(
      math.min(viewport.width, contentSize.width + _kPlatePadding * 2),
      math.min(viewport.height, contentSize.height + _kPlatePadding * 2),
    );
  }

  /// Lays [content] on the page's white plate when it hugs the artifact, with
  /// the face chip on the plate's corner above the scan. In the room the mat is
  /// the page container outside this widget, so the content stands alone.
  Widget _onPlate(Size viewport, Widget content) {
    if (!widget.hugArtifact) {
      return content;
    }

    final plate = _plateSize(viewport, _fittedContentSize(viewport));
    if (plate == null) {
      // Still decoding: no plate until there is an artifact to fit, so the
      // stage never flashes a full mat that then shrinks.
      return content;
    }

    return ClipRect(
      child: Stack(
        fit: StackFit.expand,
        children: [
          Center(
            child: Container(
              key: const ValueKey('imagePlate'),
              width: plate.width,
              height: plate.height,
              decoration: _kMatDecoration,
            ),
          ),
          content,
          Positioned(
            left: (viewport.width - plate.width) / 2 + 8,
            top: (viewport.height - plate.height) / 2 + 8,
            child: _FaceChip(face: widget.faceLabel),
          ),
        ],
      ),
    );
  }

  /// The scale, relative to the fit view, at which the scan shows one image
  /// pixel per screen pixel. Below 1 when fit has already enlarged a small
  /// scan, so the readout stays truthful about the real size.
  double _realSizeScale(Size viewport) {
    final contentSize = _fittedContentSize(viewport);
    final logicalSize = _imageLogicalSize(context);
    if (contentSize.isEmpty || logicalSize.isEmpty) {
      return 1;
    }

    final widthScale = logicalSize.width / contentSize.width;
    final heightScale = logicalSize.height / contentSize.height;
    return math.max(widthScale, heightScale);
  }

  Offset _offsetForScale({
    required Offset focalPoint,
    required Size viewport,
    required Size contentSize,
    required double currentScale,
    required double nextScale,
    required Offset currentOffset,
  }) {
    if (currentScale == nextScale || viewport.isEmpty || contentSize.isEmpty) {
      return _clampOffset(
        offset: currentOffset,
        viewport: viewport,
        contentSize: contentSize,
        scale: nextScale,
      );
    }

    final centeredFocalPoint = focalPoint - viewport.center(Offset.zero);
    final ratio = nextScale / currentScale;
    final nextOffset =
        centeredFocalPoint - ((centeredFocalPoint - currentOffset) * ratio);
    return _clampOffset(
      offset: nextOffset,
      viewport: viewport,
      contentSize: contentSize,
      scale: nextScale,
    );
  }

  Offset _clampOffset({
    required Offset offset,
    required Size viewport,
    required Size contentSize,
    required double scale,
  }) {
    final scaledWidth = contentSize.width * scale;
    final scaledHeight = contentSize.height * scale;
    final maxDx = math.max(0.0, (scaledWidth - viewport.width) / 2);
    final maxDy = math.max(0.0, (scaledHeight - viewport.height) / 2);
    return Offset(
      offset.dx.clamp(-maxDx, maxDx),
      offset.dy.clamp(-maxDy, maxDy),
    );
  }

  void _handleDoubleTap(Size viewport) {
    final tapPosition = _lastDoubleTapPosition ?? viewport.center(Offset.zero);
    if (!_atFit) {
      _resetZoom();
      return;
    }

    zoomToActualSize(focalPoint: tapPosition);
  }

  /// The missing-file message, shown when the scan cannot be loaded either by
  /// this page's own stream or by the [Image] widget underneath it.
  Widget _missingImageMessage() {
    return const Padding(
      padding: EdgeInsets.all(32),
      child: Text(
        _kMissingFileNotice,
        style: TextStyle(color: ViewerPalette.roomMuted),
        textAlign: TextAlign.center,
      ),
    );
  }

  /// The one node for the note image: the page's words, the double-click hint
  /// and, on a failed load, the same sentence the mat shows. Its tap performs
  /// the page's double-click toggle for a reader who cannot double-click.
  Widget _pageSemantics(Widget child) {
    final canZoom = !_loadFailed;
    final aboveFit = !_atFit;
    return Semantics(
      container: true,
      image: canZoom,
      label: canZoom
          ? widget.semanticLabel
          : '${widget.semanticLabel}, $_kMissingFileNotice',
      hint: canZoom ? (aboveFit ? _kPageFitHint : _kPageZoomHint) : null,
      onTap: canZoom ? () => _handleDoubleTap(_viewport) : null,
      excludeSemantics: true,
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final viewport = constraints.biggest;
        final viewportChanged = viewport != _viewport;
        _viewport = viewport;
        if (viewportChanged) {
          // The header's percentage follows the fitted size, but notifying it
          // from build would rebuild a widget mid-layout, so wait a frame.
          widget.controller.requestPublish();
        }
        final contentSize = _fittedContentSize(viewport);
        if (_loadFailed) {
          return _pageSemantics(_onPlate(viewport, _missingImageMessage()));
        }
        final maxScale = math.max(_realSizeScale(viewport), _kMaxZoomCap);
        _isPannable =
            !_atFit &&
            (contentSize.width * _scale > viewport.width + 0.5 ||
                contentSize.height * _scale > viewport.height + 0.5);

        return _pageSemantics(
          _onPlate(
            viewport,
            Listener(
              onPointerDown: _handlePointerDown,
              onPointerMove: (event) =>
                  _handlePointerMove(event, viewport, maxScale),
              onPointerUp: _handlePointerEnd,
              onPointerCancel: _handlePointerEnd,
              onPointerSignal: _handlePointerSignal,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onDoubleTapDown: (details) {
                  _lastDoubleTapPosition = details.localPosition;
                },
                onDoubleTap: () => _handleDoubleTap(viewport),
                child: Center(
                  child: Transform.translate(
                    offset: _offset,
                    child: Transform.scale(
                      scale: _scale,
                      child: SizedBox(
                        width: contentSize.width,
                        height: contentSize.height,
                        child: Image(
                          image: createNoteImageProvider(widget.image),
                          fit: BoxFit.contain,
                          errorBuilder: (context, error, stackTrace) =>
                              _missingImageMessage(),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
