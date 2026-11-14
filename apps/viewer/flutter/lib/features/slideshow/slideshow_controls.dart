import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/viewer_palette.dart';
import '../../utils/reveal_in_folder.dart';
import 'slideshow_room_style.dart';

/// Enter, numpad Enter and Space activate a custom button like a real one; a
/// held key must not fire again on every repeat.
KeyEventResult activateOnEnterOrSpace(KeyEvent event, VoidCallback onActivate) {
  if (event is! KeyDownEvent) return KeyEventResult.ignored;
  final key = event.logicalKey;
  if (key == LogicalKeyboardKey.enter ||
      key == LogicalKeyboardKey.numpadEnter ||
      key == LogicalKeyboardKey.space) {
    onActivate();
    return KeyEventResult.handled;
  }
  return KeyEventResult.ignored;
}

/// Opens [path] with [revealFolder] and reports a refusal instead of leaving
/// the tap doing nothing.
void revealInFolderWithFeedback(
  BuildContext context,
  RevealFolder revealFolder,
  String path,
) {
  revealFolder(path).then((revealed) {
    if (!revealed && context.mounted) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(content: Text('Could not open the image folder.')),
      );
    }
  });
}

/// The failed plate's and the Image popover's one action. It is its own focus
/// stop and button so Tab reaches it and Enter or Space work even though it
/// sits over a mat.
class RevealInFolderButton extends StatefulWidget {
  const RevealInFolderButton({required this.onPressed, super.key});

  final VoidCallback onPressed;

  @override
  State<RevealInFolderButton> createState() => _RevealInFolderButtonState();
}

class _RevealInFolderButtonState extends State<RevealInFolderButton> {
  final FocusNode _focusNode = FocusNode(debugLabel: 'revealInFolder');
  bool _hovered = false;

  KeyEventResult _handleKey(FocusNode _, KeyEvent event) =>
      activateOnEnterOrSpace(event, widget.onPressed);

  void _activate() {
    _focusNode.requestFocus();
    widget.onPressed();
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final focused = _focusNode.hasPrimaryFocus;
    // Hover and focus share one state: the action wears the red wash and edge
    // so it reads as a button rather than a static chip.
    final highlighted = _hovered || focused;
    return Semantics(
      container: true,
      button: true,
      label: 'Reveal in folder',
      onTap: widget.onPressed,
      excludeSemantics: true,
      child: Focus(
        focusNode: _focusNode,
        onFocusChange: (_) {
          if (mounted) setState(() {});
        },
        onKeyEvent: _handleKey,
        child: MouseRegion(
          cursor: SystemMouseCursors.click,
          onEnter: (_) => setState(() => _hovered = true),
          onExit: (_) => setState(() => _hovered = false),
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _activate,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  curve: Curves.easeOut,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: plateOverlayDecoration(
                    borderColor: highlighted
                        ? ViewerPalette.accent
                        : ViewerPalette.borderSoft,
                    color: highlighted
                        ? Color.alphaBlend(
                            ViewerPalette.accentSoft,
                            ViewerPalette.roomSurface.withValues(alpha: 0.94),
                          )
                        : null,
                  ),
                  child: const Text(
                    'Reveal in folder',
                    style: TextStyle(
                      fontFamily: 'Inter',
                      color: ViewerPalette.roomAccent,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (focused)
                  const AccentFocusRing(
                    key: ValueKey('revealFocusRing'),
                    radius: ViewerPalette.radiusSm,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A 2px accent ring sitting 4px outside a control; paint only, so focusing
/// never changes the control's size.
class AccentFocusRing extends StatelessWidget {
  const AccentFocusRing({required this.radius, super.key});

  final double radius;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      left: -4,
      top: -4,
      right: -4,
      bottom: -4,
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(radius + 4),
            border: Border.all(color: ViewerPalette.accent, width: 2),
          ),
        ),
      ),
    );
  }
}
