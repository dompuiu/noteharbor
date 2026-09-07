import 'package:flutter/material.dart';

/// Warm professional palette shared by every Viewer screen.
///
/// Mirrors the Editor web theme tokens (`apps/editor/web/src/styles.css`):
/// flat warm surfaces, warm charcoal text, and a single honey-bronze
/// accent. All screens reference these values instead of hardcoding
/// colors, so a future palette tweak only touches this file.
abstract final class ViewerPalette {
  // ── Light surfaces ────────────────────────────────────────────────
  static const Color pageBackground = Color(0xFFF3ECDF);
  static const Color surface = Color(0xFFFFFAF1);
  static const Color surfaceContainer = Color(0xFFEFE5D2);

  /// `rgba(120, 86, 50, 0.20)` pre-blended onto [surface].
  static const Color border = Color(0xFFE4D9CB);

  /// `rgba(120, 86, 50, 0.12)` pre-blended onto [surface].
  static const Color borderSoft = Color(0xFFEFE6DA);

  /// `rgba(120, 86, 50, 0.32)` pre-blended onto [surface].
  static const Color borderControl = Color(0xFFD4C6B4);

  // ── Light text ────────────────────────────────────────────────────
  static const Color text = Color(0xFF2E2318);
  static const Color textMuted = Color(0xFF8A755A);
  static const Color textFaint = Color(0xFFB5A488);

  // ── Brand ─────────────────────────────────────────────────────────
  static const Color accent = Color(0xFF96622F);
  static const Color accentStrong = Color(0xFF71461F);

  /// `rgba(150, 98, 47, 0.12)` (opaque form).
  static const Color accentSoft = Color(0x1F96622F);

  // ── Status ────────────────────────────────────────────────────────
  static const Color success = Color(0xFF2F6B3C);
  static const Color danger = Color(0xFFA02A22);

  /// `rgba(160, 42, 34, 0.10)` pre-blended onto [surface].
  static const Color dangerSoft = Color(0xFFF6E5DC);
  static const Color onDanger = Color(0xFFFFFAF1);
  static const Color warning = Color(0xFF8A5A00);
  static const Color info = Color(0xFF40667C);

  /// `rgba(62, 44, 20, 0.12)` (opaque form).
  static const Color shadow = Color(0x1F3E2C14);

  // ── Tag chips (light chips, used on light and dark screens) ───────
  static const Color tagBackground = surfaceContainer;
  static const Color tagBorder = border;
  static const Color tagText = text;

  // ── Dark (Note slideshow + Image lightbox, always dark) ───────────
  static const Color darkBackground = Color(0xFF201913);
  static const Color darkSurface = Color(0xFF2A2118);
  static const Color darkRaised = Color(0xFF352A1E);

  /// Warm-white at 16% (opaque form).
  static const Color darkBorder = Color(0x29F5F0E8);
  static const Color darkText = Color(0xFFF7ECDC);

  /// Warm-white at 66% (opaque form).
  static const Color darkMuted = Color(0xA8F5F0E8);
  static const Color darkAccent = Color(0xFFE0AA62);

  /// Warm-white at 8% (opaque form), for pills and buttons on dark.
  static const Color darkScrim = Color(0x14F7ECDC);
}
