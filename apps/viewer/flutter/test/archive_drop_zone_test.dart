import 'dart:ui' show Tristate;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/import/archive_drop_zone.dart';

void main() {
  test('only a .zip name is accepted, in any letter case', () {
    expect(archiveDropProblem('coins.zip'), isNull);
    expect(archiveDropProblem('COINS.ZIP'), isNull);
    expect(
      archiveDropProblem('coins.rar'),
      '"coins.rar" is not a .zip archive. Drop a .zip archive to import.',
    );
  });

  Future<void> pumpZone(
    WidgetTester tester, {
    String? fileName,
    VoidCallback? onChoose,
    ArchiveDroppedCallback? onDropped,
    ValueChanged<String>? onDropRejected,
    bool isPicking = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 360,
              child: ArchiveDropZone(
                fileName: fileName,
                isPicking: isPicking,
                onChoose: onChoose,
                onDropped: onDropped,
                onDropRejected: onDropRejected,
              ),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('reads as one button and chooses on click', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();

    var choices = 0;
    await pumpZone(tester, onChoose: () => choices++);

    expect(find.bySemanticsLabel('Archive drop zone'), findsOneWidget);
    final data = tester
        .getSemantics(find.bySemanticsLabel('Archive drop zone'))
        .getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.hint, contains('Drop a .zip archive'));

    await tester.tap(find.byKey(const ValueKey('archiveDropZone')));
    await tester.pump();

    expect(choices, 1);
    handle.dispose();
  });

  testWidgets('Enter and Space choose the archive when focused', (
    WidgetTester tester,
  ) async {
    var choices = 0;
    await pumpZone(tester, onChoose: () => choices++);

    final focus = tester.widget<Focus>(
      find.byKey(const ValueKey('archiveDropZoneFocus')),
    );
    focus.focusNode!.requestFocus();
    await tester.pump();

    final paint = tester.widget<CustomPaint>(
      find.byKey(const ValueKey('archiveDropZonePaint')),
    );
    expect(paint.foregroundPainter, isNotNull);

    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(choices, 1);

    await tester.sendKeyEvent(LogicalKeyboardKey.space);
    await tester.pump();
    expect(choices, 2);
  });

  testWidgets('shows the selected archive and its ready hint', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();

    await pumpZone(
      tester,
      fileName: 'notes.zip',
      onChoose: () {},
      onDropped: (_, _) {},
    );

    expect(find.text('notes.zip'), findsOneWidget);
    expect(find.text('Ready to import'), findsOneWidget);
    expect(find.bySemanticsLabel('Selected archive notes.zip'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('desktop names the click action and mobile names the tap', (
    WidgetTester tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    try {
      await pumpZone(tester, onChoose: () {});
      expect(find.text('Drop archive or click to choose'), findsOneWidget);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }

    // desktop_drop has no iOS target, so the phone hint only promises the tap.
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      await pumpZone(tester, onChoose: () {});
      expect(find.text('Tap to choose'), findsOneWidget);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }

    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    try {
      await pumpZone(tester, onChoose: () {});
      expect(find.text('Drop or tap to choose'), findsOneWidget);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('is inert while the screen is busy', (WidgetTester tester) async {
    final handle = tester.ensureSemantics();

    await pumpZone(tester, onChoose: null);

    expect(
      tester
          .widget<Focus>(find.byKey(const ValueKey('archiveDropZoneFocus')))
          .canRequestFocus,
      isFalse,
    );
    final data = tester
        .getSemantics(find.bySemanticsLabel('Archive drop zone'))
        .getSemanticsData();
    expect(data.flagsCollection.isEnabled, Tristate.isFalse);
    handle.dispose();
  });

  testWidgets('names the picker while it is open', (WidgetTester tester) async {
    await pumpZone(tester, isPicking: true, onChoose: () {});
    expect(find.text('Choosing...'), findsOneWidget);
  });
}
