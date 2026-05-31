import { StyleSheet, View } from 'react-native';

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
    backgroundColor: '#f1e4d4',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 24,
    padding: 24,
    backgroundColor: '#fffaf2',
    borderWidth: 1,
    borderColor: '#d5bea0',
    gap: 16,
  },
});
