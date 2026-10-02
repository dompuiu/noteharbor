import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/viewer_palette.dart';
import '../../models/note_image.dart';
import '../../models/note_record.dart';
import '../../widgets/mouse_drag_scroll_behavior.dart';
import '../../widgets/note_image_provider.dart';
import 'image_zoom_levels.dart';

/// The virtual page the first image is pinned to. The popover pages an
/// unbounded [PageView] so that a swipe past either end wraps with no visible
/// seam; this leaves enough room behind the first image that a backwards wrap
/// never runs out of pages.
const int _kVirtualPageOrigin = 1 << 20;

class ImageSequenceItem {
  const ImageSequenceItem({
    required this.note,
    required this.image,
  });

  final NoteRecord note;
  final NoteImage? image;

  String get label => note.title;
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

  /// Moves one image back. An adjacent step animates; the wrap from the first
  /// image to the last lands instantly instead of blurring through the rest.
  void _goPrevious() {
    if (widget.items.length < 2) return;
    final target = _virtualIndex - 1;
    if (_atFirstPage) {
      _jumpToPage(target);
    } else {
      _animateToPage(target);
    }
  }

  /// Moves one image forward. An adjacent step animates; the wrap from the last
  /// image to the first lands instantly instead of blurring through the rest.
  void _goNext() {
    if (widget.items.length < 2) return;
    final target = _virtualIndex + 1;
    if (_atLastPage) {
      _jumpToPage(target);
    } else {
      _animateToPage(target);
    }
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

  @override
  Widget build(BuildContext context) {
    final item = widget.items[_currentIndex];

    return Shortcuts(
      shortcuts: _kImageLightboxShortcuts,
      child: Actions(
        actions: <Type, Action<Intent>>{
          DismissIntent: CallbackAction<DismissIntent>(
            onInvoke: (intent) {
              if (_zoomController.resetZoom()) {
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
              backgroundColor: ViewerPalette.darkBackground,
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
                  minimum: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                        // Stretch the row so the index pill matches the Back
                        // button height instead of sizing to its own text.
                        child: IntrinsicHeight(
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Expanded(
                                child: Align(
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    item.label,
                                    style: const TextStyle(
                                      fontFamily: 'Inter',
                                      color: ViewerPalette.darkText,
                                      fontSize: 17,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: -0.2,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Container(
                                alignment: Alignment.center,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 8),
                                decoration: BoxDecoration(
                                  color: ViewerPalette.darkScrim,
                                  borderRadius: BorderRadius.circular(18),
                                  border: Border.all(
                                      color: ViewerPalette.darkBorder),
                                ),
                                child: Text(
                                  '${_currentIndex + 1} / ${widget.items.length}',
                                  style: const TextStyle(
                                    fontFamily: 'Inter',
                                    color: ViewerPalette.darkText,
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
                                  backgroundColor: ViewerPalette.darkScrim,
                                  foregroundColor: ViewerPalette.darkText,
                                  side: const BorderSide(
                                      color: ViewerPalette.darkBorder),
                                ),
                                onPressed: _closeWithCurrentNote,
                                child: const Text('Back'),
                              ),
                            ],
                          ),
                        ),
                      ),
                      Expanded(
                        child: ScrollConfiguration(
                          // A mouse drag pages the sequence at fit scale; while
                          // zoomed the physics below are disabled so the drag
                          // pans the image instead.
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
                              final imageItem = widget.items[
                                  (index - _kVirtualPageOrigin) %
                                      widget.items.length];
                              return Padding(
                                padding:
                                    const EdgeInsets.fromLTRB(12, 4, 12, 0),
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: ViewerPalette.darkSurface,
                                    borderRadius: BorderRadius.circular(20),
                                    border: Border.all(
                                      color: ViewerPalette.darkBorder,
                                    ),
                                    boxShadow: const [
                                      BoxShadow(
                                        blurRadius: 32,
                                        offset: Offset(0, 16),
                                        color: Color(0x66000000),
                                      ),
                                    ],
                                  ),
                                  clipBehavior: Clip.antiAlias,
                                  child: Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: imageItem.image == null
                                        ? const Center(
                                            child: Text(
                                              'No image',
                                              style: TextStyle(
                                                fontFamily: 'Inter',
                                                color: ViewerPalette.darkMuted,
                                                fontSize: 16,
                                              ),
                                            ),
                                          )
                                        : _ZoomableImagePage(
                                            key: ValueKey(
                                              '${imageItem.image!.cacheKey}-$index-$_pageGeneration',
                                            ),
                                            image: imageItem.image!,
                                            controller: _zoomController,
                                            onPageScrollEnabledChanged:
                                                _setPageScrollEnabled,
                                          ),
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
          ),
        ),
      ),
    );
  }
}

class _PreviousImageIntent extends Intent {
  const _PreviousImageIntent();
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
    const SingleActivator(LogicalKeyboardKey.escape): const DismissIntent(),
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

/// Routes zoom/pan intents from the lightbox (which owns keyboard focus) to the
/// currently visible [_ZoomableImagePage].
class _ImageZoomController {
  _ZoomableImagePageState? _active;

  void attach(_ZoomableImagePageState page) {
    _active = page;
  }

  void detach(_ZoomableImagePageState page) {
    if (identical(_active, page)) {
      _active = null;
    }
  }

  void zoomIn() => _active?.zoomIn();

  void zoomOut() => _active?.zoomOut();

  /// Pans the active page. Returns whether the image is pannable; when it is
  /// not, the caller falls back to paging on the horizontal axis.
  bool pan(double dx, double dy) => _active?.pan(dx, dy) ?? false;

  /// Resets the zoom if zoomed. Returns whether a reset was performed.
  bool resetZoom() => _active?.resetZoom() ?? false;
}

class _ZoomableImagePage extends StatefulWidget {
  const _ZoomableImagePage({
    required this.image,
    required this.controller,
    required this.onPageScrollEnabledChanged,
    super.key,
  });

  final NoteImage image;
  final _ImageZoomController controller;
  final ValueChanged<bool> onPageScrollEnabledChanged;

  @override
  State<_ZoomableImagePage> createState() => _ZoomableImagePageState();
}

class _ZoomableImagePageState extends State<_ZoomableImagePage> {
  static const double _kMaxZoomCap = 12;
  static const double _kMinSpan = 1;
  static const double _kZoomEpsilon = 1e-3;
  static const double _kPanOverflowFraction = 0.05;

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
      _lastDoubleTapPosition = null;
      _scale = 1;
      _offset = Offset.zero;
      _lastFocalPoint = null;
      _lastSpan = null;
      _cancelDrag();
      _isPannable = false;
      _resolveImage();
      _syncPageScroll();
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

  void zoomIn() => _changeZoom(1);

  void zoomOut() => _changeZoom(-1);

  /// Pans by [dx]/[dy] steps of 5% of the overflow. Returns whether the image
  /// is pannable; when it is not (i.e. in fit view) the caller falls back to
  /// paging.
  bool pan(double dx, double dy) {
    if (!_isPannable || _viewport.isEmpty) {
      return false;
    }

    final contentSize = _fittedContentSize(_viewport);
    final overflowX =
        math.max(0.0, contentSize.width * _scale - _viewport.width);
    final overflowY =
        math.max(0.0, contentSize.height * _scale - _viewport.height);
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

  /// Resets the zoom if zoomed. Returns whether a reset was performed.
  bool resetZoom() {
    if (_scale <= 1 + _kZoomEpsilon) {
      return false;
    }

    _resetZoom();
    return true;
  }

  void _resetZoom() {
    setState(() {
      _scale = 1;
      _offset = Offset.zero;
    });
    _syncPageScroll();
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
  }

  double get _maxScale => math.max(
        _viewport.isEmpty ? 1 : _realSizeScale(_viewport),
        _kMaxZoomCap,
      );

  void _syncPageScroll() {
    final enabled = _activePointers.length < 2 && _scale <= 1 + _kZoomEpsilon;
    widget.onPageScrollEnabledChanged(enabled);
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
    _imageStreamListener = ImageStreamListener((imageInfo, _) {
      if (!mounted) {
        return;
      }

      setState(() {
        _intrinsicSize = Size(
          imageInfo.image.width.toDouble(),
          imageInfo.image.height.toDouble(),
        );
      });
    });
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
      PointerMoveEvent event, Size viewport, double maxScale) {
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
      _offset = _clampOffset(
        offset: nextOffset,
        viewport: viewport,
        contentSize: _fittedContentSize(viewport),
        scale: _scale,
      );
    });

    _lastFocalPoint = focalPoint;
    _lastSpan = math.max(span, _kMinSpan);
    _syncPageScroll();
  }

  void _handlePointerEnd(PointerEvent event) {
    _activePointers.remove(event.pointer);
    if (_dragPointer == event.pointer) {
      _cancelDrag();
    }
    if (_activePointers.length < 2) {
      _lastFocalPoint = null;
      _lastSpan = null;
    }
    _syncPageScroll();
  }

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
    final sum =
        positions.fold<Offset>(Offset.zero, (total, value) => total + value);
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

    final devicePixelRatio = MediaQuery.devicePixelRatioOf(context);
    final logicalSize = Size(
      intrinsicSize.width / devicePixelRatio,
      intrinsicSize.height / devicePixelRatio,
    );
    final fitScale = math.min(
      viewport.width / logicalSize.width,
      viewport.height / logicalSize.height,
    );
    return Size(
      logicalSize.width * fitScale,
      logicalSize.height * fitScale,
    );
  }

  double _realSizeScale(Size viewport) {
    final contentSize = _fittedContentSize(viewport);
    final logicalSize = _imageLogicalSize(context);
    if (contentSize.isEmpty || logicalSize.isEmpty) {
      return 1;
    }

    final widthScale = logicalSize.width / contentSize.width;
    final heightScale = logicalSize.height / contentSize.height;
    return math.max(1.0, math.max(widthScale, heightScale));
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

  void _handleDoubleTap(Size viewport, double maxScale) {
    final tapPosition = _lastDoubleTapPosition ?? viewport.center(Offset.zero);
    final contentSize = _fittedContentSize(viewport);
    if (_scale > 1 + _kZoomEpsilon) {
      _resetZoom();
      return;
    }

    final targetScale = _realSizeScale(viewport).clamp(1.0, maxScale);
    final targetOffset = _offsetForScale(
      focalPoint: tapPosition,
      viewport: viewport,
      contentSize: contentSize,
      currentScale: 1,
      nextScale: targetScale,
      currentOffset: Offset.zero,
    );

    setState(() {
      _scale = targetScale;
      _offset = targetOffset;
    });
    _syncPageScroll();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final viewport = constraints.biggest;
        _viewport = viewport;
        final contentSize = _fittedContentSize(viewport);
        final maxScale = math.max(_realSizeScale(viewport), _kMaxZoomCap);
        _isPannable = _scale > 1 + _kZoomEpsilon &&
            (contentSize.width * _scale > viewport.width + 0.5 ||
                contentSize.height * _scale > viewport.height + 0.5);

        return Listener(
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
            onDoubleTap: () => _handleDoubleTap(viewport, maxScale),
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
                      errorBuilder: (context, error, stackTrace) {
                        return const Padding(
                          padding: EdgeInsets.all(32),
                          child: Text(
                            'This image file is missing from the current dataset.',
                            style: TextStyle(color: ViewerPalette.darkMuted),
                            textAlign: TextAlign.center,
                          ),
                        );
                      },
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
