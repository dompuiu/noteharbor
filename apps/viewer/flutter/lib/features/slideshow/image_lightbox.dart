import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../models/note_image.dart';
import '../../models/note_record.dart';
import '../../widgets/note_image_provider.dart';

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
  late final PageController _controller;
  late int _currentIndex;
  bool _pageScrollEnabled = true;
  int _pageGeneration = 0;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _controller = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _jump(int nextIndex) {
    _controller.animateToPage(
      nextIndex,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  void _goPrevious() {
    if (widget.items.isEmpty) {
      return;
    }

    _jump((_currentIndex - 1 + widget.items.length) % widget.items.length);
  }

  void _goNext() {
    if (widget.items.isEmpty) {
      return;
    }

    _jump((_currentIndex + 1) % widget.items.length);
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
      shortcuts: const <ShortcutActivator, Intent>{
        SingleActivator(LogicalKeyboardKey.escape): DismissIntent(),
        SingleActivator(LogicalKeyboardKey.arrowLeft): _PreviousImageIntent(),
        SingleActivator(LogicalKeyboardKey.arrowRight): _NextImageIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          DismissIntent: CallbackAction<DismissIntent>(
            onInvoke: (intent) {
              Navigator.of(context).maybePop();
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
        },
        child: Focus(
          autofocus: true,
          child: Scaffold(
            backgroundColor: const Color(0xFF1F160F),
            body: SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.label,
                            style: const TextStyle(
                              color: Color(0xFFFFF5E9),
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(18),
                          ),
                          child: Text(
                            '${_currentIndex + 1} / ${widget.items.length}',
                            style: const TextStyle(
                              color: Color(0xFFFFF5E9),
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
                      controller: _controller,
                      physics: _pageScrollEnabled
                          ? const PageScrollPhysics()
                          : const NeverScrollableScrollPhysics(),
                      itemCount: widget.items.length,
                      onPageChanged: (value) => setState(() {
                        _currentIndex = value;
                        _pageGeneration += 1;
                        _pageScrollEnabled = true;
                      }),
                      itemBuilder: (context, index) {
                        final imageItem = widget.items[index];
                        return Padding(
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 0),
                          child: Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFF160E08),
                              borderRadius: BorderRadius.circular(20),
                              border:
                                  Border.all(color: const Color(0x44FFEBD4)),
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: imageItem.image == null
                                  ? const Center(
                                      child: Text(
                                        'No image',
                                        style: TextStyle(
                                          color: Colors.white54,
                                          fontSize: 16,
                                        ),
                                      ),
                                    )
                                  : _ZoomableImagePage(
                                      key: ValueKey(
                                        '${imageItem.image!.cacheKey}-$index-$_pageGeneration',
                                      ),
                                      image: imageItem.image!,
                                      onInteractionStateChanged: (isMultiTouch) {
                                        _setPageScrollEnabled(!isMultiTouch);
                                      },
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
    );
  }
}

class _PreviousImageIntent extends Intent {
  const _PreviousImageIntent();
}

class _NextImageIntent extends Intent {
  const _NextImageIntent();
}

class _ZoomableImagePage extends StatefulWidget {
  const _ZoomableImagePage({
    required this.image,
    required this.onInteractionStateChanged,
    super.key,
  });

  final NoteImage image;
  final ValueChanged<bool> onInteractionStateChanged;

  @override
  State<_ZoomableImagePage> createState() => _ZoomableImagePageState();
}

class _ZoomableImagePageState extends State<_ZoomableImagePage> {
  static const double _kMaxZoomCap = 12;
  static const double _kMinSpan = 1;

  final Map<int, Offset> _activePointers = <int, Offset>{};
  ImageStream? _imageStream;
  ImageStreamListener? _imageStreamListener;

  Size? _intrinsicSize;
  Offset? _lastDoubleTapPosition;
  double _scale = 1;
  Offset _offset = Offset.zero;
  Offset? _lastFocalPoint;
  double? _lastSpan;
  bool _isMultiTouch = false;

  @override
  void initState() {
    super.initState();
    _resolveImage();
  }

  @override
  void didUpdateWidget(covariant _ZoomableImagePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.image.cacheKey != widget.image.cacheKey) {
      _removeImageListener();
      _activePointers.clear();
      _intrinsicSize = null;
      _lastDoubleTapPosition = null;
      _scale = 1;
      _offset = Offset.zero;
      _lastFocalPoint = null;
      _lastSpan = null;
      _setMultiTouch(false);
      _resolveImage();
    }
  }

  @override
  void dispose() {
    _removeImageListener();
    widget.onInteractionStateChanged(false);
    super.dispose();
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

  void _setMultiTouch(bool value) {
    if (_isMultiTouch == value) {
      return;
    }

    _isMultiTouch = value;
    widget.onInteractionStateChanged(value);
  }

  void _handlePointerDown(PointerDownEvent event) {
    _activePointers[event.pointer] = event.localPosition;
    if (_activePointers.length >= 2) {
      _setMultiTouch(true);
      _lastFocalPoint = _currentFocalPoint();
      _lastSpan = _currentSpan();
    }
  }

  void _handlePointerMove(
      PointerMoveEvent event, Size viewport, double maxScale) {
    if (!_activePointers.containsKey(event.pointer)) {
      return;
    }

    _activePointers[event.pointer] = event.localPosition;
    if (_activePointers.length < 2) {
      return;
    }

    _setMultiTouch(true);

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
  }

  void _handlePointerEnd(PointerEvent event) {
    _activePointers.remove(event.pointer);
    if (_activePointers.length < 2) {
      _lastFocalPoint = null;
      _lastSpan = null;
      _setMultiTouch(false);
    }
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
    if (_scale > 1.01) {
      setState(() {
        _scale = 1;
        _offset = Offset.zero;
      });
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
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final viewport = constraints.biggest;
        final contentSize = _fittedContentSize(viewport);
        final maxScale = math.max(_realSizeScale(viewport), _kMaxZoomCap);

        return Listener(
          onPointerDown: _handlePointerDown,
          onPointerMove: (event) =>
              _handlePointerMove(event, viewport, maxScale),
          onPointerUp: _handlePointerEnd,
          onPointerCancel: _handlePointerEnd,
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
                            style: TextStyle(color: Colors.white70),
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
