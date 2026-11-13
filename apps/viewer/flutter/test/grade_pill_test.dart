import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/widgets/grade_pill.dart';

void main() {
  Future<void> pumpPill(WidgetTester tester, Widget pill) async {
    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: Center(child: pill),
      ),
    );
  }

  BoxDecoration pillDecoration(WidgetTester tester, String grade) {
    final pill = tester.widget<Container>(
      find.descendant(
        of: find.byType(GradePill),
        matching: find.byType(Container),
      ),
    );
    return pill.decoration! as BoxDecoration;
  }

  TextStyle pillText(WidgetTester tester, String grade) {
    return tester.renderObject<RenderParagraph>(find.text(grade)).text.style!;
  }

  testWidgets('the pill bands a grade by its catalogue tier', (
    WidgetTester tester,
  ) async {
    const bands = [
      ('66 EPQ', ViewerPalette.successSoft, ViewerPalette.success),
      ('65', ViewerPalette.successSoft, ViewerPalette.success),
      ('64.5', ViewerPalette.warningSoft, ViewerPalette.warning),
      ('50', ViewerPalette.warningSoft, ViewerPalette.warning),
      ('49', ViewerPalette.surfaceMist, ViewerPalette.textMuted),
      ('ungraded', ViewerPalette.surfaceMist, ViewerPalette.textMuted),
    ];

    for (final (grade, background, foreground) in bands) {
      await pumpPill(tester, GradePill(grade: grade));

      expect(pillDecoration(tester, grade).color, background, reason: grade);
      expect(pillText(tester, grade).color, foreground, reason: grade);
    }
  });

  testWidgets('the grade wears the pill type role', (
    WidgetTester tester,
  ) async {
    await pumpPill(tester, const GradePill(grade: '66'));

    final style = pillText(tester, '66');
    expect(style.fontSize, 13);
    expect(style.fontWeight, FontWeight.w600);
    expect(
      pillDecoration(tester, '66').borderRadius,
      BorderRadius.circular(ViewerPalette.radiusPill),
    );
  });

  testWidgets('a blank grade shows the placeholder it is given', (
    WidgetTester tester,
  ) async {
    await pumpPill(
      tester,
      const GradePill(grade: '  ', emptyPlaceholder: Text('-')),
    );

    expect(find.text('-'), findsOneWidget);
    expect(find.byType(Container), findsNothing);
  });

  testWidgets('a blank grade renders nothing without a placeholder', (
    WidgetTester tester,
  ) async {
    await pumpPill(tester, const GradePill(grade: ''));

    expect(find.byType(Text), findsNothing);
    expect(find.byType(Container), findsNothing);
  });

  testWidgets('a grade is shown without its surrounding whitespace', (
    WidgetTester tester,
  ) async {
    await pumpPill(tester, const GradePill(grade: ' 66 PPQ '));

    expect(find.text('66 PPQ'), findsOneWidget);
  });
}
