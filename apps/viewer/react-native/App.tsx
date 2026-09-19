import {
  describeViewerCore,
  viewerCoreVersion,
  type NoteRecord,
} from './src/shared/viewer-core';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { StatusBar, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
  const { height: windowHeight } = useWindowDimensions();
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
        </Card>
      </ScreenFrame>
    );
  }

  const needsImport =
    controller.dataset == null ||
    controller.dataset.collections.length === 0;

  if (needsImport) {
    return (
      <ScreenFrame topInset={insets.top} bottomInset={insets.bottom}>
        <ImportScreen controller={controller} isFirstRun />
        <ImportBlockingOverlay visible={controller.isMutating} />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame topInset={insets.top} bottomInset={insets.bottom}>
      <Card>
        <NotesTableScreen
          controller={controller}
          onOpenSlideshow={openSlideshow}
          onOpenImport={() => setShowImport(true)}
        />
        <Text style={styles.meta}>{describeViewerCore()}</Text>
        <Text style={styles.meta}>viewer-core {viewerCoreVersion}</Text>
      </Card>
      {slideshow ? (
        <NoteSlideshow
          notes={slideshow.notes}
          initialIndex={slideshow.initialIndex}
          onClose={closeSlideshow}
          onOpenPopover={openPopover}
        />
      ) : null}
      {slideshow && popover ? (
        <ImagePopover
          notes={popover.notes}
          initialNoteId={popover.noteId}
          initialFace={popover.face}
          onClose={closePopover}
        />
      ) : null}
      <Modal
        visible={showImport}
        animationType="slide"
        onRequestClose={() => {
          // Block back while mutating (Flutter PopScope canPop:!_isImporting).
          if (!controller.isMutating) {
            setShowImport(false);
          }
        }}>
        {/* Bounded height so the Modal can't size to its content on Windows
            and grow past the screen. */}
        <View style={[styles.importModalWrap, { height: windowHeight }]}>
          <ImportScreen
            controller={controller}
            isFirstRun={false}
            onClose={() => setShowImport(false)}
          />
        </View>
      </Modal>
      <ImportBlockingOverlay visible={controller.isMutating} />
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
  meta: {
    color: '#7a6247',
    fontSize: 13,
    fontWeight: '600',
  },
  importModalWrap: {
    backgroundColor: viewerLight.pageBackground,
  },
});

export default App;
