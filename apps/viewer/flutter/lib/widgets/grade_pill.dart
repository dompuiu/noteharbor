import 'package:flutter/material.dart';

import '../app/viewer_palette.dart';

/// The catalogue grade bands: uncirculated (65+), choice (50-64), and
/// circulated below that. An unreadable grade reads as the neutral band, not
/// as a second accent.
enum _GradeTier { uncirculated, choice, circulated, none }

_GradeTier _gradeTier(String value) {
  final match = RegExp(r'\d+(?:\.\d+)?').firstMatch(value);
  final numeric = match == null ? null : double.tryParse(match.group(0)!);
  if (numeric == null) {
    return _GradeTier.none;
  }
  if (numeric >= 65) {
    return _GradeTier.uncirculated;
  }
  return numeric >= 50 ? _GradeTier.choice : _GradeTier.circulated;
}

/// A note's grade as a pill tinted by its catalogue band, so the Table and the
/// Note slideshow can read a grade the same way.
///
/// A blank grade renders [emptyPlaceholder] when one is given, so a table cell
/// keeps its dash. Callers that space their children, such as the slideshow,
/// should leave the pill out instead of passing a placeholder that would leave
/// a gap.
class GradePill extends StatelessWidget {
  const GradePill({super.key, required this.grade, this.emptyPlaceholder});

  /// The grade as recorded, such as `66 EPQ`; surrounding whitespace is ignored.
  final String grade;

  /// Shown in place of the pill when [grade] is blank.
  final Widget? emptyPlaceholder;

  @override
  Widget build(BuildContext context) {
    final text = grade.trim();
    if (text.isEmpty) {
      return emptyPlaceholder ?? const SizedBox.shrink();
    }

    final (background, foreground, border) = switch (_gradeTier(text)) {
      _GradeTier.uncirculated => (
        ViewerPalette.successSoft,
        ViewerPalette.success,
        const Color(0x3D31A24C),
      ),
      _GradeTier.choice => (
        ViewerPalette.warningSoft,
        ViewerPalette.warning,
        const Color(0x4DF7B928),
      ),
      _GradeTier.circulated || _GradeTier.none => (
        ViewerPalette.surfaceMist,
        ViewerPalette.textMuted,
        ViewerPalette.borderSoft,
      ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(ViewerPalette.radiusPill),
        border: Border.all(color: border),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontFamily: 'Inter',
          color: foreground,
          fontSize: 13,
          fontWeight: FontWeight.w600,
          height: 1.2,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}
