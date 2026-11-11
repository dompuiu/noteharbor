import 'dart:io';
import 'dart:ui' show Tristate;

import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/app/viewer_palette.dart';
import 'package:note_harbor_viewer/features/import/archive_drop_zone.dart';
import 'package:note_harbor_viewer/features/import/archive_staging.dart';

void main() {
  test('only a .zip name is accepted, in any letter case', () {
    expect(archiveDropProblem('coins.zip'), isNull);
    expect(archiveDropProblem('COINS.ZIP'), isNull);
    expect(
      archiveDropProblem('coins.rar'),
      '"coins.rar" is not a .zip archive. Drop a .zip archive to import.',
    );
  });

  test('staging copies a dropped file to a fresh path', () async {
    final sourceDir = await Directory.systemTemp.createTemp('t14-source-');
    addTearDown(() => sourceDir.delete(recursive: true));
    final source = File('${sourceDir.path}${Platform.pathSeparator}coins.zip');
    await source.writeAsString('archive bytes');

    final staged = await stageDroppedArchive(source.path, null);

    expect(staged, isNotNull);
    expect(staged, isNot(source.path));
    final stagedPath = staged!;
    expect(await File(stagedPath).readAsString(), 'archive bytes');
    await File(stagedPath).parent.delete(recursive: true);
  });

  Future<void> pumpZone(
    WidgetTester tester, {
    String? fileName,
    VoidCallback? onChoose,
    ArchiveDroppedCallback? onDropped,
    ValueChanged<String>? onDropRejected,
    ArchiveStager? stageArchive,
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
                stageArchive: stageArchive ?? (path, _) async => path,
              ),
            ),
          ),
        ),
      ),
    );
  }

  DropTarget dropTarget(WidgetTester tester) =>
      tester.widget<DropTarget>(find.byType(DropTarget));

  Future<void> drop(WidgetTester tester, List<DropItem> files) async {
    dropTarget(tester).onDragDone!(
      DropDoneDetails(
        files: files,
        localPosition: Offset.zero,
        globalPosition: Offset.zero,
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('reads as one button and chooses on click', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();

    var choices = 0;
    await pumpZone(tester, onChoose: () => choices++);

    expect(find.bySemanticsLabel('Choose a .zip archive'), findsOneWidget);
    final data = tester
        .getSemantics(find.bySemanticsLabel('Choose a .zip archive'))
        .getSemanticsData();
    expect(data.flagsCollection.isButton, isTrue);
    expect(data.hint, contains('Drop a .zip archive'));

    await tester.tap(find.byKey(const ValueKey('archiveDropZone')));
    await tester.pump();

    expect(choices, 1);
    handle.dispose();
  });

  testWidgets('Tab reaches the zone and Enter and Space choose', (
    WidgetTester tester,
  ) async {
    var choices = 0;
    await pumpZone(tester, onChoose: () => choices++);

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
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
        .getSemantics(find.bySemanticsLabel('Choose a .zip archive'))
        .getSemanticsData();
    expect(data.flagsCollection.isEnabled, Tristate.isFalse);
    handle.dispose();
  });

  testWidgets('names the picker while it is open', (WidgetTester tester) async {
    await pumpZone(tester, isPicking: true, onChoose: () {});
    expect(find.text('Choosing...'), findsOneWidget);
  });

  Color zoneFill(WidgetTester tester) {
    final container = tester.widget<Container>(
      find.descendant(
        of: find.byType(AnimatedContainer),
        matching: find.byType(Container),
      ),
    );
    return (container.decoration! as BoxDecoration).color!;
  }

  testWidgets('the drag-over fill fades between opaque colors', (
    WidgetTester tester,
  ) async {
    await pumpZone(tester, onChoose: () {});
    final details = DropEventDetails(
      localPosition: Offset.zero,
      globalPosition: Offset.zero,
    );

    dropTarget(tester).onDragEntered!(details);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 70));

    // A translucent target makes Color.lerp dip through a half-alpha red and
    // flash a saturated pink mid-fade. Both ends stay opaque instead.
    expect(zoneFill(tester).a, 1.0);

    await tester.pumpAndSettle();
    expect(
      zoneFill(tester),
      Color.alphaBlend(ViewerPalette.accentSoft, ViewerPalette.surface),
    );

    dropTarget(tester).onDragExited!(details);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 70));
    expect(zoneFill(tester).a, 1.0);
  });

  testWidgets('shows the drag-over state until the drag leaves', (
    WidgetTester tester,
  ) async {
    await pumpZone(tester, onChoose: () {});
    final details = DropEventDetails(
      localPosition: Offset.zero,
      globalPosition: Offset.zero,
    );

    dropTarget(tester).onDragEntered!(details);
    await tester.pump();
    expect(find.text('Drop to choose'), findsOneWidget);

    dropTarget(tester).onDragExited!(details);
    await tester.pump();
    expect(find.text('Drop or tap to choose'), findsOneWidget);
  });

  testWidgets('a dropped .zip becomes the selected archive', (
    WidgetTester tester,
  ) async {
    String? droppedPath;
    String? droppedName;
    await pumpZone(
      tester,
      onChoose: () {},
      onDropped: (path, name) {
        droppedPath = path;
        droppedName = name;
      },
    );

    await drop(tester, [DropItemFile('C:\\archives\\coins.zip')]);

    expect(droppedPath, 'C:\\archives\\coins.zip');
    expect(droppedName, 'coins.zip');
  });

  testWidgets('a non-zip drop reports in the banner path', (
    WidgetTester tester,
  ) async {
    String? rejection;
    await pumpZone(
      tester,
      onChoose: () {},
      onDropped: (_, _) {},
      onDropRejected: (message) => rejection = message,
    );

    await drop(tester, [DropItemFile('C:\\archives\\coins.rar')]);

    expect(
      rejection,
      '"coins.rar" is not a .zip archive. Drop a .zip archive to import.',
    );
  });

  testWidgets('a folder or several files is rejected', (
    WidgetTester tester,
  ) async {
    final rejections = <String>[];
    await pumpZone(
      tester,
      onChoose: () {},
      onDropped: (_, _) {},
      onDropRejected: rejections.add,
    );

    await drop(tester, [
      DropItemFile('C:\\archives\\coins.zip'),
      DropItemDirectory('C:\\archives', const []),
    ]);
    await drop(tester, [
      DropItemFile('C:\\archives\\one.zip'),
      DropItemFile('C:\\archives\\two.zip'),
    ]);

    expect(rejections, [
      'Drop a .zip archive file, not a folder.',
      'Drop one .zip archive at a time.',
    ]);
  });

  testWidgets('a failed copy is rejected instead of selected', (
    WidgetTester tester,
  ) async {
    String? rejection;
    await pumpZone(
      tester,
      onChoose: () {},
      onDropped: (_, _) {},
      onDropRejected: (message) => rejection = message,
      stageArchive: (_, _) async => null,
    );

    await drop(tester, [DropItemFile('C:\\archives\\coins.zip')]);

    expect(rejection, 'Could not read the dropped archive.');
  });
}
