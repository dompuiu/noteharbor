import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/import/import_archive_dialog.dart';
import 'package:note_harbor_viewer/models/archive_preview.dart';
import 'package:note_harbor_viewer/models/viewer_collection.dart';

void main() {
  const romania = ViewerCollection(id: 1, name: 'Romania', noteCount: 12);
  const bulgaria = ViewerCollection(id: 2, name: 'Bulgaria', noteCount: 0);
  const greece = ViewerCollection(id: 3, name: 'Greece', noteCount: 7);

  ArchivePreview previewOf(List<ViewerCollection> collections) {
    return ArchivePreview(
      generatedAt: '2026-03-28T12:00:00Z',
      collections: collections,
    );
  }

  Future<ValueNotifier<bool?>> openDialog(
    WidgetTester tester, {
    required Future<ArchivePreview?> Function() peekArchive,
    List<ViewerCollection> installedCollections = const [],
    String fileName = 'roman-harbor.zip',
    bool settle = true,
  }) async {
    final result = ValueNotifier<bool?>(true);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: FilledButton(
                onPressed: () async {
                  result.value = await showDialog<bool>(
                    context: context,
                    builder: (context) => ImportArchiveDialog(
                      fileName: fileName,
                      peekArchive: peekArchive,
                      installedCollections: installedCollections,
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pump();
    if (settle) {
      await tester.pumpAndSettle();
    } else {
      // The loading spinner never settles, so let the route transition finish
      // without waiting for animations to stop.
      await tester.pump(const Duration(milliseconds: 400));
    }
    return result;
  }

  testWidgets('names the archive and tags each collection as new or replaced', (
    WidgetTester tester,
  ) async {
    await openDialog(
      tester,
      peekArchive: () async => previewOf([romania, bulgaria, greece]),
      installedCollections: const [romania, greece],
    );

    expect(find.text('Import "roman-harbor.zip"?'), findsOneWidget);
    expect(find.text('This archive contains 3 collections.'), findsOneWidget);
    expect(find.text('Romania'), findsOneWidget);
    expect(find.text('Bulgaria'), findsOneWidget);
    expect(find.text('Greece'), findsOneWidget);
    expect(find.text('12 notes'), findsOneWidget);
    expect(find.text('0 notes'), findsOneWidget);
    expect(find.text('7 notes'), findsOneWidget);
    expect(find.text('Replaces'), findsNWidgets(2));
    expect(find.text('New'), findsOneWidget);
    expect(
      find.text(
        'The collections marked "Replaces" are already on this device and will be replaced. Collections not in this archive stay as they are.',
      ),
      findsOneWidget,
    );
    // A mix imports every collection in the archive.
    expect(
      find.widgetWithText(FilledButton, 'Import 3 collections'),
      findsOneWidget,
    );
  });

  testWidgets('confirms with Replace when every collection is installed', (
    WidgetTester tester,
  ) async {
    await openDialog(
      tester,
      peekArchive: () async => previewOf([romania, greece]),
      installedCollections: const [romania, greece],
    );

    expect(find.text('Replaces'), findsNWidgets(2));
    expect(find.text('New'), findsNothing);
    expect(
      find.widgetWithText(FilledButton, 'Replace 2 collections'),
      findsOneWidget,
    );
  });

  testWidgets('confirms with Add when no collection is installed', (
    WidgetTester tester,
  ) async {
    await openDialog(
      tester,
      peekArchive: () async => previewOf([bulgaria]),
    );

    expect(find.text('New'), findsOneWidget);
    expect(
      find.text(
        'Nothing on this device is replaced. These collections are new.',
      ),
      findsOneWidget,
    );
    expect(
      find.widgetWithText(FilledButton, 'Add 1 collection'),
      findsOneWidget,
    );
  });

  testWidgets('matches installed names as case-insensitively as the import', (
    WidgetTester tester,
  ) async {
    const spacedInstalled = ViewerCollection(
      id: 1,
      name: '  ROMANIA ',
      noteCount: 2,
    );
    await openDialog(
      tester,
      peekArchive: () async => previewOf([romania]),
      installedCollections: const [spacedInstalled],
    );

    expect(find.text('Replaces'), findsOneWidget);
    expect(
      find.widgetWithText(FilledButton, 'Replace 1 collection'),
      findsOneWidget,
    );
  });

  testWidgets('does not claim a replace when only non-ASCII case differs', (
    WidgetTester tester,
  ) async {
    // The import matches names with SQLite lower(), which folds ASCII only.
    // The dialog must not promise a replace the import will not perform.
    const installed = ViewerCollection(id: 1, name: 'ÄGYPTEN', noteCount: 2);
    const archived = ViewerCollection(id: 2, name: 'ägypten', noteCount: 2);
    await openDialog(
      tester,
      peekArchive: () async => previewOf([archived]),
      installedCollections: const [installed],
    );

    expect(find.text('New'), findsOneWidget);
    expect(
      find.widgetWithText(FilledButton, 'Add 1 collection'),
      findsOneWidget,
    );
  });

  testWidgets('shows a loading state until the archive preview resolves', (
    WidgetTester tester,
  ) async {
    final preview = Completer<ArchivePreview?>();
    await openDialog(
      tester,
      peekArchive: () => preview.future,
      settle: false,
    );

    expect(find.text('Import "roman-harbor.zip"?'), findsOneWidget);
    expect(find.text('Reading the archive…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    final loadingButton = tester.widget<FilledButton>(
      find.byKey(const ValueKey('importArchiveConfirm')),
    );
    expect(loadingButton.onPressed, isNull);

    preview.complete(previewOf([romania]));
    await tester.pumpAndSettle();

    expect(find.text('Reading the archive…'), findsNothing);
    expect(find.text('Romania'), findsOneWidget);
    expect(
      find.widgetWithText(FilledButton, 'Add 1 collection'),
      findsOneWidget,
    );
  });

  testWidgets('falls back to the by-name sentence when the preview fails', (
    WidgetTester tester,
  ) async {
    await openDialog(
      tester,
      peekArchive: () async => null,
      fileName: 'unknown.zip',
    );

    expect(find.text('Import "unknown.zip"?'), findsOneWidget);
    expect(
      find.text(
        'Importing replaces any collection on this device with the same name as a collection in the archive. Collections not in the archive stay as they are.',
      ),
      findsOneWidget,
    );
    expect(find.text('Replaces'), findsNothing);
    expect(find.text('New'), findsNothing);
    expect(find.widgetWithText(FilledButton, 'Import'), findsOneWidget);
  });

  testWidgets('a read error also falls back instead of failing the dialog', (
    WidgetTester tester,
  ) async {
    await openDialog(
      tester,
      peekArchive: () async =>
          throw StateError('The selected archive file no longer exists.'),
    );

    expect(find.text('Import "roman-harbor.zip"?'), findsOneWidget);
    expect(
      find.textContaining('Importing replaces any collection'),
      findsOneWidget,
    );
    expect(find.widgetWithText(FilledButton, 'Import'), findsOneWidget);
  });

  testWidgets('Cancel closes without importing', (WidgetTester tester) async {
    final result = await openDialog(
      tester,
      peekArchive: () async => previewOf([romania]),
    );

    await tester.tap(find.byKey(const ValueKey('importArchiveCancel')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('importArchiveDialog')), findsNothing);
    expect(result.value, isFalse);
  });

  testWidgets('Escape closes without importing', (WidgetTester tester) async {
    final result = await openDialog(
      tester,
      peekArchive: () async => previewOf([romania]),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('importArchiveDialog')), findsNothing);
    expect(result.value, isNull);
  });
}
