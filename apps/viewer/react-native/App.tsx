import type { NoteRecord } from './src/shared/viewer-core';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Pressable, StatusBar, StyleSheet, Text } from 'react-native';
import { useCallback, useState } from 'react';
import { viewerLight } from './src/theme/viewerTheme';

import { Card, ScreenFrame } from './src/components/AppFrame';
import { ImagePopover } from './src/components/ImagePopover';
import { ImportBlockingOverlay } from './src/components/ImportBlockingOverlay';
import { ImportScreen } from './src/components/ImportScreen';
import { NotesTableScreen, type OpenSlideshow, type SlideshowReturn } from './src/components/NotesTableScreen';
import { NoteSlideshow, type OpenImagePopover } from './src/components/NoteSlideshow';
import { useViewerController } from './src/state/useViewerController';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <AppShell />
    </SafeAreaProvider>
  );
}

function AppShell() {
  const insets = useSafeAreaInsets();
  const controller = useViewerController();
  const [showImport, setShowImport] = useState(false);
  const [slideshow, setSlideshow] = useState<{
    notes: NoteRecord[];
    initialIndex: number;
    resolve: (result: SlideshowReturn | null) => void;
  } | null>(null);
  const [popover, setPopover] = useState<{
    notes: NoteRecord[];
    noteId: number;
    face: 'front' | 'back';
    resolve: (noteId: number | null) => void;
  } | null>(null);

  const openSlideshow: OpenSlideshow = useCallback(
    (notes: NoteRecord[], initialIndex: number) =>
      new Promise<SlideshowReturn | null>((resolve) => {
        setSlideshow({ notes, initialIndex, resolve });
      }),
    [],
  );

  const closeSlideshow = useCallback(
    (result: SlideshowReturn | null) => {
      slideshow?.resolve(result);
      setSlideshow(null);
    },
    [slideshow],
  );

  // Slideshow image-tap handoff: the popover pages the slideshow's filtered
  // notes and returns the current Note identity, which the slideshow jumps
  // to (its own openPopover already syncs; resolve here only unblocks it).
  const openPopover: OpenImagePopover = useCallback(
    (note: NoteRecord, face: 'front' | 'back') =>
      new Promise<number | null>((resolve) => {
        setPopover({
          notes: slideshow?.notes ?? [note],
          noteId: note.id,
          face,
          resolve,
        });
      }),
    [slideshow],
  );

  const closePopover = useCallback(
    (noteId: number | null) => {
      popover?.resolve(noteId);
      setPopover(null);
    },
    [popover],
  );

  if (controller.isLoading) {
    return (
      <ScreenFrame topInset={insets.top} bottomInset={insets.bottom}>
        <Card>
          <Text style={styles.eyebrow}>Note Harbor</Text>
          <Text style={styles.title}>Loading viewer dataset...</Text>
          <Text style={styles.body}>Initializing the shared controller and loading notes.</Text>
        </Card>
      </ScreenFrame>
    );
  }

  if (controller.error) {
    return (
      <ScreenFrame topInset={insets.top} bottomInset={insets.bottom}>
        <Card>
          <Text style={styles.eyebrow}>Note Harbor</Text>
          <Text style={styles.title}>Unable to load data</Text>
          <Text style={styles.body}>{controller.error}</Text>
          <Pressable
            testID="dismiss-error"
            accessibilityLabel="Dismiss error"
            onPress={controller.clearError}
            style={styles.dismissButton}>
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </Pressable>
        </Card>
      </ScreenFrame>
    );
  }

  const needsImport =
    controller.dataset == null ||
    controller.dataset.collections.length === 0;

  if (needsImport) {
    // The ImportScreen renders its own blocking overlay (with the archive
    // name); no app-level overlay here so the import never shows twice.
    return (
      <ScreenFrame topInset={insets.top} bottomInset={insets.bottom}>
        <ImportScreen controller={controller} isFirstRun />
      </ScreenFrame>
    );
  }

  // The Table screen sits directly on the page background like Flutter
  // (no outer Card); slideshow, popover, and import share the Card window.
  // Modals open a separate native window on Windows/macOS that fills the
  // screen.
  const showTable = !slideshow && !showImport;
  return (
    <ScreenFrame
      topInset={insets.top}
      bottomInset={insets.bottom}
      padding={showTable ? 12 : 20}>
      {showTable ? (
        <NotesTableScreen
          controller={controller}
          onOpenSlideshow={openSlideshow}
          onOpenImport={() => setShowImport(true)}
        />
      ) : (
        <Card>
          {slideshow && popover ? (
            <ImagePopover
              notes={popover.notes}
              initialNoteId={popover.noteId}
              initialFace={popover.face}
              onClose={closePopover}
            />
          ) : slideshow ? (
            <NoteSlideshow
              notes={slideshow.notes}
              initialIndex={slideshow.initialIndex}
              onClose={closeSlideshow}
              onOpenPopover={openPopover}
            />
          ) : (
            <ImportScreen
              controller={controller}
              isFirstRun={false}
              onClose={() => {
                if (!controller.isMutating) {
                  setShowImport(false);
                }
              }}
            />
          )}
        </Card>
      )}
      {/* Hidden while the Import screen is open: it renders its own overlay
          so a mutation never shows two blocking indicators at once. */}
      <ImportBlockingOverlay visible={controller.isMutating && !showImport} />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: viewerLight.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: viewerLight.text,
    fontSize: 30,
    fontWeight: '800',
  },
  body: {
    color: viewerLight.text,
    fontSize: 16,
    lineHeight: 24,
  },
  dismissButton: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: viewerLight.surfaceContainer,
  },
  dismissButtonText: {
    color: viewerLight.text,
    fontSize: 14,
    fontWeight: '700',
  },
});

export default App;
