import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:note_harbor_viewer/features/slideshow/image_lightbox.dart';
import 'package:note_harbor_viewer/models/note_record.dart';

/// The Image popover's two absences and its in-between: a Note with no image
/// record, a scan that will not decode, and a scan that is still decoding. All
/// three share one mat notice, and only the failed scan offers a way out.
void main() {
  const missingPath = 'noteharbor-states-missing.png';
  const loadingPath = 'noteharbor-states-loading.png';

  NoteRecord stateNote({int id = 1, bool withFront = true, String? file}) {
    return NoteRecord.fromJson(<String, dynamic>{
      'id': id,
      'displayOrder': id,
      'denomination': 'Test',
      'issueDate': '',
      'catalogNumber': 'KB-$id',
      'gradingCompany': '',
      'grade': '',
      'watermark': '',
      'serial': '',
      'url': '',
      'notes': '',
      'scrapeStatus': 'done',
      'scrapeError': '',
      'tags': <dynamic>[],
      'images': <dynamic>[
        if (withFront)
          <String, dynamic>{
            'type': 'front',
            'variant': 'full',
            'filePath': file,
          },
      ],
      'scrapedData': null,
    });
  }

  List<ImageSequenceItem> itemsFor(NoteRecord note) => [
    ImageSequenceItem(note: note, image: note.fullFor('front'), face: 'front'),
  ];

  /// Holds [path]'s image load open so a test can fail or finish it after the
  /// page has subscribed.
  Completer<ImageInfo> holdImage(String path) {
    final completer = Completer<ImageInfo>();
    final provider = FileImage(File(path));
    PaintingBinding.instance.imageCache.putIfAbsent(
      provider,
      () => OneFrameImageStreamCompleter(completer.future),
    );
    addTearDown(() => PaintingBinding.instance.imageCache.evict(provider));
    return completer;
  }

  Future<void> pumpLightbox(
    WidgetTester tester, {
    required List<ImageSequenceItem> items,
    Size size = const Size(1200, 800),
    Future<bool> Function(String path)? revealFolder,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        home: _LightboxLauncher(items: items, revealFolder: revealFolder),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('a scan that will not decode shows the empty state and reveal', (
    WidgetTester tester,
  ) async {
    final held = holdImage(missingPath);
    final revealed = <String>[];
    await pumpLightbox(
      tester,
      items: itemsFor(stateNote(file: missingPath)),
      revealFolder: (path) async {
        revealed.add(path);
        return true;
      },
    );

    held.completeError(Exception('missing image'));
    await tester.pumpAndSettle();

    const notice = 'This image file is missing from the current collection.';
    expect(find.text('No image'), findsOneWidget);
    expect(find.text(notice), findsOneWidget);
    expect(find.text('Reveal in folder'), findsOneWidget);

    // The notice sits inside the mat, centred on it.
    final matRect = tester.getRect(find.byKey(const ValueKey('imageMat')));
    final titleRect = tester.getRect(find.text('No image'));
    expect(matRect.contains(titleRect.center), isTrue);
    expect(titleRect.center.dx, closeTo(matRect.center.dx, 1));

    await tester.tap(find.text('Reveal in folder'));
    await tester.pumpAndSettle();
    expect(revealed, [missingPath]);
  });

  testWidgets(
    'a note with no image shows the same empty state, without reveal',
    (WidgetTester tester) async {
      final note = stateNote(withFront: false);
      await pumpLightbox(tester, items: itemsFor(note));

      expect(find.text('No image'), findsOneWidget);
      expect(find.text('This note has no front image.'), findsOneWidget);
      expect(find.text('Reveal in folder'), findsNothing);

      // The page still names the state for a screen reader.
      expect(
        find.bySemanticsLabel('Test - KB-1, Front, Image 1 of 1, No image'),
        findsOneWidget,
      );
    },
  );

  testWidgets('an empty sequence shows one empty state and the exit', (
    WidgetTester tester,
  ) async {
    await pumpLightbox(tester, items: const []);

    expect(find.byType(PageView), findsNothing);
    expect(find.text('No image'), findsOneWidget);
    expect(find.text('There are no images to show.'), findsOneWidget);
    expect(find.text('Back to note'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('Back to note'));
    await tester.pumpAndSettle();
    expect(find.text('open'), findsOneWidget);
  });

  testWidgets('a decoding scan says so quietly on the mat', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    final held = holdImage(loadingPath);
    await pumpLightbox(tester, items: itemsFor(stateNote(file: loadingPath)));

    expect(find.text('Loading image'), findsOneWidget);
    expect(find.text('The scan is still decoding.'), findsOneWidget);
    // The page node names the wait instead of offering a zoom that has no
    // pixels to work on yet.
    expect(
      find.bySemanticsLabel('Test - KB-1, Front, Image 1 of 1, Loading image'),
      findsOneWidget,
    );

    final image = await tester.runAsync(() => _solidImage(1600, 1000));
    held.complete(ImageInfo(image: image!));
    await tester.pumpAndSettle();

    expect(find.text('Loading image'), findsNothing);
    expect(find.text('The scan is still decoding.'), findsNothing);
    expect(find.byType(Image), findsOneWidget);
    expect(
      find.bySemanticsLabel('Test - KB-1, Front, Image 1 of 1'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    handle.dispose();
  });

  testWidgets('the empty state is announced once, not twice', (
    WidgetTester tester,
  ) async {
    final handle = tester.ensureSemantics();
    final held = holdImage(missingPath);
    await pumpLightbox(tester, items: itemsFor(stateNote(file: missingPath)));

    held.completeError(Exception('missing image'));
    await tester.pumpAndSettle();

    const notice = 'This image file is missing from the current collection.';
    final page = find.byWidgetPredicate(
      (widget) =>
          widget is Semantics &&
          widget.properties.label ==
              'Test - KB-1, Front, Image 1 of 1, $notice',
    );
    expect(page, findsOneWidget);
    // The mat's words are paint; the page node owns them, and Reveal stays its
    // own reachable button rather than being swallowed by the page label.
    expect(find.bySemanticsLabel(notice), findsNothing);
    expect(find.bySemanticsLabel('Reveal in folder'), findsOneWidget);

    final data = tester.getSemantics(page).getSemanticsData();
    expect(data.flagsCollection.isImage, isFalse);
    expect(data.hasAction(SemanticsAction.tap), isFalse);
    handle.dispose();
  });
}

Future<ui.Image> _solidImage(int width, int height) async {
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  canvas.drawRect(
    ui.Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    ui.Paint()..color = const ui.Color(0xFF3366AA),
  );
  final picture = recorder.endRecording();
  return picture.toImage(width, height);
}

class _LightboxLauncher extends StatelessWidget {
  const _LightboxLauncher({required this.items, this.revealFolder});

  final List<ImageSequenceItem> items;
  final Future<bool> Function(String path)? revealFolder;

  Future<void> _open(BuildContext context) async {
    await Navigator.of(context).push<int>(
      MaterialPageRoute<int>(
        builder: (_) => ImageLightbox(
          items: items,
          initialIndex: 0,
          revealFolder: revealFolder ?? (_) async => true,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () => _open(context),
          child: const Text('open'),
        ),
      ),
    );
  }
}
