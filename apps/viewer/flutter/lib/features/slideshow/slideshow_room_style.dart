import 'package:flutter/material.dart';

import '../../app/viewer_palette.dart';

/// Fixed height shared by the room's counter pill and exit control.
const double kRoomControlHeight = 40;

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
