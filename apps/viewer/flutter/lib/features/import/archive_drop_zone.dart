import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/viewer_palette.dart';

/// Called with the local path and file name of a dropped archive.
typedef ArchiveDroppedCallback = void Function(String path, String name);

/// The banner message for a dropped file that is not a .zip archive, or null
/// when the drop can be selected.
String? archiveDropProblem(String name) {
  final fileName = name.trim();
  if (fileName.toLowerCase().endsWith('.zip')) {
    return null;
  }
  return '"$fileName" is not a .zip archive. Drop a .zip archive to import.';
}

/// The one picker on the import screen: click or tap to choose an archive, or
/// drop one from the OS. It takes focus and opens the picker on Enter or Space.
class ArchiveDropZone extends StatefulWidget {
  const ArchiveDropZone({
    super.key,
    required this.fileName,
    required this.onChoose,
    required this.onDropped,
    this.onDropRejected,
    this.isPicking = false,
  });

  /// The selected archive's file name, or null before one is chosen.
  final String? fileName;

  /// The picker action. Null while the screen is busy, which disables the zone.
  final VoidCallback? onChoose;

  /// Receives the path and file name of a single dropped file.
  final ArchiveDroppedCallback? onDropped;

  /// Reports a drop this zone cannot use, so the screen can show its banner.
  final ValueChanged<String>? onDropRejected;

  /// True while the file picker is open.
  final bool isPicking;

  @override
  State<ArchiveDropZone> createState() => _ArchiveDropZoneState();
}

class _ArchiveDropZoneState extends State<ArchiveDropZone> {
  final FocusNode _focusNode = FocusNode(debugLabel: 'archiveDropZone');
  bool _hovered = false;
  bool _focused = false;
  bool _dragging = false;

  bool get _interactive => widget.onChoose != null;

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  void _choose() {
    final onChoose = widget.onChoose;
    if (onChoose == null) {
      return;
    }
    _focusNode.requestFocus();
    onChoose();
  }

  void _handleDrop(DropDoneDetails details) {
    setState(() => _dragging = false);

    final files = details.files.whereType<DropItemFile>().toList(
      growable: false,
    );
    if (files.isEmpty) {
      widget.onDropRejected?.call('Drop a .zip archive file.');
      return;
    }
    if (files.length > 1) {
      widget.onDropRejected?.call('Drop one .zip archive at a time.');
      return;
    }

    final file = files.single;
    final problem = archiveDropProblem(file.name);
    if (problem != null) {
      widget.onDropRejected?.call(problem);
      return;
    }

    if (file.path.isEmpty) {
      widget.onDropRejected?.call('Could not read the dropped archive.');
      return;
    }

    widget.onDropped?.call(file.path, file.name);
  }

  KeyEventResult _handleKeyEvent(FocusNode node, KeyEvent event) {
    if (!_interactive || (event is! KeyDownEvent && event is! KeyRepeatEvent)) {
      return KeyEventResult.ignored;
    }

    final key = event.logicalKey;
    if (key != LogicalKeyboardKey.enter &&
        key != LogicalKeyboardKey.numpadEnter &&
        key != LogicalKeyboardKey.space) {
      return KeyEventResult.ignored;
    }

    if (event is KeyDownEvent) {
      _choose();
    }
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final fileName = widget.fileName;
    final selected = fileName != null;
    final interactive = _interactive;
    final hovered = interactive && _hovered;
    final dragging = interactive && _dragging;
    final platform = Theme.of(context).platform;
    final mobile =
        platform == TargetPlatform.iOS || platform == TargetPlatform.android;
    // desktop_drop ships a native drop target for desktop, Android, and web.
    // iOS keeps the picker but has no drop target in this app.
    final acceptsDrop = platform != TargetPlatform.iOS;
    final String idleHint;
    if (!acceptsDrop) {
      idleHint = 'Tap to choose';
    } else if (mobile) {
      idleHint = 'Drop or tap to choose';
    } else {
      idleHint = 'Drop archive or click to choose';
    }

    final String semanticsHint;
    if (selected) {
      semanticsHint = 'Choose a different .zip archive';
    } else if (!acceptsDrop) {
      semanticsHint = 'Tap to choose a .zip archive';
    } else if (mobile) {
      semanticsHint = 'Drop a .zip archive here or tap to choose one';
    } else {
      semanticsHint = 'Drop a .zip archive here or click to choose one';
    }

    final borderColor = dragging || selected
        ? ViewerPalette.accent
        : hovered
        ? ViewerPalette.accent.withValues(alpha: 0.55)
        : ViewerPalette.borderControl;
    final fillColor = dragging || selected
        ? ViewerPalette.accentSoft
        : hovered
        ? ViewerPalette.surfaceStep
        : ViewerPalette.surfaceMist;
    final hint = widget.isPicking
        ? 'Choosing...'
        : dragging
        ? 'Drop to choose'
        : selected
        ? 'Ready to import'
        : idleHint;

    final zone = Focus(
      key: const ValueKey('archiveDropZoneFocus'),
      focusNode: _focusNode,
      canRequestFocus: interactive,
      onKeyEvent: _handleKeyEvent,
      onFocusChange: (focused) => setState(() => _focused = focused),
      child: MouseRegion(
        cursor: interactive ? SystemMouseCursors.click : MouseCursor.defer,
        onEnter: (_) => setState(() => _hovered = true),
        onExit: (_) => setState(() => _hovered = false),
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: interactive ? _choose : null,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            curve: Curves.easeOut,
            decoration: BoxDecoration(
              color: fillColor,
              borderRadius: BorderRadius.circular(ViewerPalette.radiusControl),
            ),
            child: CustomPaint(
              key: const ValueKey('archiveDropZonePaint'),
              painter: _DashedBorderPainter(
                color: borderColor,
                radius: ViewerPalette.radiusControl,
              ),
              foregroundPainter: _focused && interactive
                  ? const _FocusRingPainter(
                      color: ViewerPalette.accent,
                      radius: ViewerPalette.radiusControl,
                    )
                  : null,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: ViewerPalette.surface,
                        borderRadius: BorderRadius.circular(
                          ViewerPalette.radiusSm,
                        ),
                        border: Border.all(color: ViewerPalette.border),
                      ),
                      child: const Padding(
                        padding: EdgeInsets.all(10),
                        child: Icon(
                          Icons.archive_outlined,
                          color: ViewerPalette.accent,
                          size: 22,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            fileName ?? 'No archive selected',
                            style: TextStyle(
                              fontFamily: 'Inter',
                              fontWeight: FontWeight.w700,
                              color: selected
                                  ? ViewerPalette.text
                                  : ViewerPalette.textMuted,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            hint,
                            style: const TextStyle(
                              fontFamily: 'Inter',
                              fontSize: 12,
                              color: ViewerPalette.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: selected
                            ? ViewerPalette.accentStrong
                            : ViewerPalette.surface,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: selected
                              ? ViewerPalette.accentStrong
                              : ViewerPalette.border,
                        ),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        child: Text(
                          'ZIP',
                          style: TextStyle(
                            fontFamily: 'Inter',
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 1.0,
                            color: selected
                                ? ViewerPalette.onAccent
                                : ViewerPalette.textMuted,
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
    );

    return Semantics(
      key: const ValueKey('archiveDropZone'),
      button: true,
      enabled: interactive,
      label: selected ? 'Selected archive $fileName' : 'Archive drop zone',
      hint: semanticsHint,
      onTap: interactive ? _choose : null,
      excludeSemantics: true,
      child: DropTarget(
        enable: interactive && acceptsDrop,
        onDragEntered: (_) => setState(() => _dragging = true),
        onDragExited: (_) => setState(() => _dragging = false),
        onDragDone: _handleDrop,
        child: zone,
      ),
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  const _DashedBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(rect, Radius.circular(radius));
    const dashWidth = 7.0;
    const dashGap = 5.0;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;
    final path = Path()..addRRect(rrect);
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        final end = (distance + dashWidth).clamp(0.0, metric.length);
        canvas.drawPath(metric.extractPath(distance, end), paint);
        distance += dashWidth + dashGap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DashedBorderPainter oldDelegate) {
    return oldDelegate.color != color || oldDelegate.radius != radius;
  }
}

class _FocusRingPainter extends CustomPainter {
  const _FocusRingPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(
      (Offset.zero & size).deflate(1),
      Radius.circular(radius - 1),
    );
    canvas.drawRRect(
      rrect,
      Paint()
        ..color = color
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke,
    );
  }

  @override
  bool shouldRepaint(covariant _FocusRingPainter oldDelegate) {
    return oldDelegate.color != color || oldDelegate.radius != radius;
  }
}
