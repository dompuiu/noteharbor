import { StyleSheet, View } from 'react-native';
import { viewerLight } from '../theme/viewerTheme';

export function ScreenFrame({
  children,
  topInset,
  bottomInset,
}: {
  children: React.ReactNode;
  topInset: number;
  bottomInset: number;
}) {
  return (
    <View
      style={[
        styles.screen,
        { paddingTop: topInset + 24, paddingBottom: bottomInset + 24 },
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
    justifyContent: 'center',
  },
  card: {
    borderRadius: 24,
    padding: 24,
    backgroundColor: viewerLight.surface,
    borderWidth: 1,
    borderColor: viewerLight.borderControl,
    gap: 16,
  },
});
