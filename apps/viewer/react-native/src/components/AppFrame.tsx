import { StyleSheet, View } from 'react-native';
import { viewerLight } from '../theme/viewerTheme';

export function ScreenFrame({
  children,
  topInset,
  bottomInset,
  padding = 20,
}: {
  children: React.ReactNode;
  topInset: number;
  bottomInset: number;
  padding?: number;
}) {
  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: topInset + 24,
          paddingBottom: bottomInset + 24,
          paddingHorizontal: padding,
        },
      ]}>
      {children}
    </View>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: viewerLight.pageBackground,
  },
  card: {
    flex: 1,
    minHeight: 0,
    borderRadius: 24,
    padding: 24,
    backgroundColor: viewerLight.surface,
    borderWidth: 1,
    borderColor: viewerLight.borderControl,
    gap: 16,
    overflow: 'hidden',
  },
});
