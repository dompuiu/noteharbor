import {
  describeViewerCore,
  viewerCoreVersion,
  type NoteRecord,
} from './src/shared/viewer-core';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { StatusBar, StyleSheet, Text } from 'react-native';
import { useCallback, useState } from 'react';
import { viewerLight } from './src/theme/viewerTheme';

import { Card, ScreenFrame } from './src/components/AppFrame';
import { ImportBlockingOverlay } from './src/components/ImportBlockingOverlay';
import { ManagePanel } from './src/components/ManagePanel';
import { NotesTableScreen, type OpenSlideshow, type SlideshowReturn } from './src/components/NotesTableScreen';
import { NoteSlideshow } from './src/components/NoteSlideshow';
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
  const [slideshow, setSlideshow] = useState<{
    notes: NoteRecord[];
    initialIndex: number;
    resolve: (result: SlideshowReturn | null) => void;
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

  return (
    <ScreenFrame topInset={insets.top} bottomInset={insets.bottom}>
      <Card>
        <NotesTableScreen controller={controller} onOpenSlideshow={openSlideshow} />
        <ManagePanel controller={controller} />
        <Text style={styles.meta}>{describeViewerCore()}</Text>
        <Text style={styles.meta}>viewer-core {viewerCoreVersion}</Text>
      </Card>
      {slideshow ? (
        <NoteSlideshow
          notes={slideshow.notes}
          initialIndex={slideshow.initialIndex}
          onClose={closeSlideshow}
        />
      ) : null}
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
});

// ponytail: NotesTableScreen renders without onOpenImport until ticket 12
// (import screen) provides that target.
export default App;
