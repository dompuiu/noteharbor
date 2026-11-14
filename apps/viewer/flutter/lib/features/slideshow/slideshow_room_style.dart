import 'package:flutter/material.dart';

import '../../app/viewer_palette.dart';

/// Fixed height shared by the room's counter pill and exit control.
const double kRoomControlHeight = 40;

/// The room's one page-step duration, shared by the slideshow and the Image
/// popover so a reduced-motion reader gets the same instant step in both.
const Duration kRoomPageStepDuration = Duration(milliseconds: 220);

/// The room's inset and border only appear once the window can hold them. Both
/// presentation screens take this guard, so the slideshow and the Image popover
/// wear the room's chrome on the same windows.
const double kRoomMinWidth = 760;
const double kRoomMinHeight = 560;
const double kRoomInset = 16;

/// Whether a window this size wears the room: its inset, border and radius.
bool roomedFor(Size size) =>
    size.width >= kRoomMinWidth && size.height >= kRoomMinHeight;

/// DESIGN.md "Presentation room label": 600, 0.68rem, 0.12em.
///
/// The room's one label voice: the plate chips, the slide eyebrow and the
/// details field labels all take it. The Image popover's face chip does too.
const TextStyle kPlateLabelStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.roomMuted,
  fontSize: 10.88,
  fontWeight: FontWeight.w600,
  letterSpacing: 1.31,
);

/// DESIGN.md "Popover headline": 800, 1.2rem/1.3, -0.01em, uppercase.
///
/// The Image popover's note label, one step below the slideshow's 2.1rem
/// denomination so the bar stays lighter than a screen heading.
const TextStyle kPopoverHeadlineStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.roomText,
  fontSize: 19.2,
  fontWeight: FontWeight.w800,
  letterSpacing: -0.192,
  height: 1.3,
);

/// The room's counter: the slideshow's note position and the Image popover's
/// image position share one voice.
const TextStyle kRoomCounterStyle = TextStyle(
  fontFamily: 'Inter',
  color: ViewerPalette.roomText,
  fontWeight: FontWeight.w600,
  fontSize: 13,
  fontFeatures: [FontFeature.tabularFigures()],
);

/// The small white overlay a plate's chip, zoom cue and reveal action share.
/// The Image popover's face chip wears the same chip on its mat.
BoxDecoration plateOverlayDecoration({
  Color borderColor = ViewerPalette.borderSoft,
  Color? color,
}) {
  return BoxDecoration(
    color: color ?? ViewerPalette.roomSurface.withValues(alpha: 0.94),
    borderRadius: BorderRadius.circular(ViewerPalette.radiusSm),
    border: Border.all(color: borderColor),
  );
}
