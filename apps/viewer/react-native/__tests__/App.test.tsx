/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('react-native', () => ({
  Platform: {OS: 'ios'},
  Pressable: 'Pressable',
  StatusBar: 'StatusBar',
  Text: 'Text',
  TextInput: 'TextInput',
  useWindowDimensions: () => ({width: 390, height: 844, scale: 3, fontScale: 1}),
  View: 'View',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({children}: {children: React.ReactNode}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });

  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
});
