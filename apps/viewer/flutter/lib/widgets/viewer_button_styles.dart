import 'package:flutter/material.dart';

import '../app/viewer_palette.dart';

/// Button styles the app theme cannot express on its own.
///
/// The theme paints every filled button in the accent red, so the soft-red
/// destructive actions ("Delete collection", "Delete imported data") declare
/// their own full state ramp here instead of repeating it at each call site.
abstract final class ViewerButtonStyles {
  /// Quiet destructive action: soft red wash, red ink, red hairline edge.
  ///
  /// Disabled falls back to the neutral disabled control so an unavailable
  /// destructive action never reads as a dimmed red button.
  static ButtonStyle dangerTonal() {
    final base = FilledButton.styleFrom(
      backgroundColor: ViewerPalette.dangerSoft,
      foregroundColor: ViewerPalette.danger,
      side: BorderSide(color: ViewerPalette.danger.withValues(alpha: 0.3)),
    );

    return base.copyWith(
      backgroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return ViewerPalette.controlDisabled;
        }
        if (states.contains(WidgetState.pressed)) {
          return ViewerPalette.danger.withValues(alpha: 0.18);
        }
        if (states.contains(WidgetState.hovered)) {
          return ViewerPalette.danger.withValues(alpha: 0.13);
        }
        return ViewerPalette.dangerSoft;
      }),
      foregroundColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return ViewerPalette.controlDisabledText;
        }
        return ViewerPalette.danger;
      }),
      side: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) {
          return const BorderSide(color: ViewerPalette.controlDisabledBorder);
        }
        final active =
            states.contains(WidgetState.hovered) ||
            states.contains(WidgetState.focused) ||
            states.contains(WidgetState.pressed);
        return BorderSide(
          color: ViewerPalette.danger.withValues(alpha: active ? 0.55 : 0.3),
        );
      }),
      overlayColor: WidgetStateProperty.all(Colors.transparent),
    );
  }
}
