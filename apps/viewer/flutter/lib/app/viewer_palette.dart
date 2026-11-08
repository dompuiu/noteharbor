import 'package:flutter/material.dart';

/// Neutral ink-and-red palette shared by every Viewer screen.
///
/// Mirrors the Editor web theme tokens (`apps/editor/ui-react/src/styles.css`):
/// a white-to-grey surface ladder, warm charcoal ink, a single deep-red accent,
/// the Ochre tag family, and flat cards that only lift when they float.
/// All screens reference these values instead of hardcoding colors, so a
/// future palette tweak only touches this file.
abstract final class ViewerPalette {
  // ── Light surfaces ────────────────────────────────────────────────
  /// The application ground (`--bg` / `--surface-3`).
  static const Color pageBackground = Color(0xFFF2F2F2);
  static const Color surface = Color(0xFFFFFFFF);

  /// Secondary panel fill (`--surface-2`).
  static const Color surfaceMist = Color(0xFFF7F7F7);

  /// Deepest neutral step (`--surface-4`).
  static const Color surfaceStep = Color(0xFFE6E6E6);

  /// Legacy name for the quiet panel fill.
  static const Color surfaceContainer = surfaceMist;

  /// `rgba(37, 40, 43, 0.18)`.
  static const Color border = Color(0x2E25282B);

  /// `rgba(37, 40, 43, 0.10)`.
  static const Color borderSoft = Color(0x1A25282B);

  /// `rgba(37, 40, 43, 0.32)`.
  static const Color borderControl = Color(0x5225282B);

  /// Table header band: one quiet step inside the white card, so the
  /// column row reads as part of the table instead of floating on the page.
  static const Color tableHeaderBackground = surfaceMist;

  // ── Light text ────────────────────────────────────────────────────
  static const Color text = Color(0xFF25282B);
  static const Color textMuted = Color(0xFF5F6367);
  static const Color textFaint = Color(0xFF6E7276);

  // ── Brand ─────────────────────────────────────────────────────────
  /// Deep red at rest (`--accent-strong`).
  static const Color accent = Color(0xFFB80000);
  static const Color accentStrong = accent;

  /// The primary pill's state ramp.
  static const Color accentHover = Color(0xFFCC0000);
  static const Color accentActive = Color(0xFF990000);

  /// `rgba(184, 0, 0, 0.07)`.
  static const Color accentSoft = Color(0x12B80000);

  /// Text and icons on a filled red surface.
  static const Color onAccent = Color(0xFFFFFFFF);

  /// `rgba(184, 0, 0, 0.09)` for a selected row.
  static const Color rowSelected = Color(0x17B80000);

  /// `rgba(37, 40, 43, 0.035)` for the table's neutral zebra stripe.
  static const Color rowZebra = Color(0x0925282B);

  // ── Status ────────────────────────────────────────────────────────
  static const Color success = Color(0xFF157A3A);

  /// `rgba(49, 162, 76, 0.12)`.
  static const Color successSoft = Color(0x1F31A24C);
  static const Color danger = Color(0xFFA30000);

  /// `rgba(163, 0, 0, 0.08)`.
  static const Color dangerSoft = Color(0x14A30000);
  static const Color onDanger = surface;
  static const Color warning = Color(0xFF7A4F00);

  /// `rgba(247, 185, 40, 0.16)`.
  static const Color warningSoft = Color(0x29F7B928);
  static const Color info = Color(0xFF29597A);

  /// `rgba(41, 89, 122, 0.12)`.
  static const Color infoSoft = Color(0x1F29597A);

  /// `rgba(37, 40, 43, 0.12)`.
  static const Color shadow = Color(0x1F25282B);

  // ── Tag chips (Ochre family) ──────────────────────────────────────
  /// Opaque, because a chip sits over rows that repaint on hover/selection.
  static const Color tagBackground = Color(0xFFFDF3DA);
  static const Color tagBackgroundHover = Color(0xFFF6EAB0);
  static const Color tagBorder = Color(0xFFAF8134);
  static const Color tagBorderHover = Color(0xFF9C8418);
  static const Color tagText = Color(0xFF7A4F00);
  static const Color tagTextMuted = Color(0xFF8A6A2C);

  // ── Presentation room (Note slideshow + Image lightbox) ────────────
  /// Near-black scrim the room floats on.
  static const Color roomScrim = Color(0xE0000000);

  /// Canvas Soft: the room's ground and the slideshow panel.
  static const Color roomBackground = pageBackground;

  /// White slide card / image mat.
  static const Color roomSurface = surface;

  /// One step inside the white card (details, raw scrape).
  static const Color roomInset = surfaceMist;
  static const Color roomBorder = border;
  static const Color roomBorderControl = borderControl;
  static const Color roomText = text;
  static const Color roomMuted = textMuted;
  static const Color roomAccent = accentStrong;

  /// `rgba(37, 40, 43, 0.04)`.
  static const Color roomWash = Color(0x0A25282B);

  /// `rgba(37, 40, 43, 0.08)`.
  static const Color roomWashStrong = Color(0x1425282B);

  /// `rgba(184, 0, 0, 0.14)` for a selected value in the room.
  static const Color roomSelection = Color(0x24B80000);

  // ── Elevation ─────────────────────────────────────────────────────
  /// Cards are flat at rest: no shadow on panels, tables, or controls.
  static const List<BoxShadow> shadowLow = <BoxShadow>[];
  static const List<BoxShadow> shadowMid = <BoxShadow>[];

  /// Lifted chrome: menus, dialogs, popovers.
  static const List<BoxShadow> shadowHigh = [
    BoxShadow(blurRadius: 32, offset: Offset(0, 12), color: Color(0x2925282B)),
  ];

  /// The slideshow panel floats above the scrim on its own depth ladder.
  static const List<BoxShadow> shadowRoom = [
    BoxShadow(blurRadius: 80, offset: Offset(0, 30), color: Color(0x5C000000)),
  ];

  // ── Shape scale ───────────────────────────────────────────────────
  static const double radiusXs = 4;
  static const double radiusSm = 8;

  /// Cards, menus, and panels (the Editor's 6px step).
  static const double radiusMd = 6;
  static const double radiusLg = 6;
  static const double radiusXl = 6;

  /// Fields and selects.
  static const double radiusControl = 10;

  /// Tag and filter chips.
  static const double radiusChip = 7;

  /// Buttons, counters, segmented controls.
  static const double radiusPill = 100;

  // ── Spacing scale ─────────────────────────────────────────────────
  static const double spaceXs = 4;
  static const double spaceSm = 8;
  static const double spaceMd = 12;
  static const double spaceLg = 16;
  static const double spaceXl = 20;
  static const double spaceXxl = 28;
}
