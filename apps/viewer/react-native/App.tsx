import {
  describeViewerCore,
  viewerCoreVersion,
} from './src/shared/viewer-core';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Platform, StatusBar, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { Card, ScreenFrame } from './src/components/AppFrame';
import { DesktopViewerShell } from './src/components/DesktopViewerShell';
import { ManagePanel } from './src/components/ManagePanel';
import { MobileViewerShell } from './src/components/MobileViewerShell';
import { ViewerFilter } from './src/components/ViewerFilter';
import { ViewerHeader } from './src/components/ViewerHeader';
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
  const { width } = useWindowDimensions();
  const controller = useViewerController();
  const isDesktopLike = Platform.OS === 'macos' || Platform.OS === 'windows' || width >= 900;

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
        <ViewerHeader sourceLabel={controller.sourceLabel} />
        <ManagePanel controller={controller} />
        <ViewerFilter query={controller.query} setQuery={controller.setQuery} />
        {isDesktopLike ? (
          <DesktopViewerShell controller={controller} />
        ) : (
          <MobileViewerShell controller={controller} />
        )}
        <Text style={styles.meta}>{describeViewerCore()}</Text>
        <Text style={styles.meta}>viewer-core {viewerCoreVersion}</Text>
      </Card>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  meta: {
    color: '#7a6247',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default App;
