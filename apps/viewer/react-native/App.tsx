import {
  describeViewerCore,
  viewerCoreVersion,
} from './src/shared/viewer-core';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { StatusBar, StyleSheet, Text } from 'react-native';
import { viewerLight } from './src/theme/viewerTheme';

import { Card, ScreenFrame } from './src/components/AppFrame';
import { ImportBlockingOverlay } from './src/components/ImportBlockingOverlay';
import { ManagePanel } from './src/components/ManagePanel';
import { NotesTableScreen } from './src/components/NotesTableScreen';
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
        <NotesTableScreen controller={controller} />
        <ManagePanel controller={controller} />
        <Text style={styles.meta}>{describeViewerCore()}</Text>
        <Text style={styles.meta}>viewer-core {viewerCoreVersion}</Text>
      </Card>
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

// ponytail: NotesTableScreen renders without onOpenSlideshow/onOpenImport
// until tickets 10 (slideshow) and 12 (import screen) provide those targets.
export default App;
