module.exports = {
  haste: {
    defaultPlatform: 'ios',
    platforms: ['android', 'ios', 'native'],
  },
  resolver: require.resolve('react-native/jest/resolver.js'),
  setupFiles: ['<rootDir>/jest.setup.js'],
  testEnvironment: require.resolve('react-native/jest/react-native-env.js'),
  transform: {
    '^.+\\.(js|ts|tsx)$': 'babel-jest',
    '^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp)$': require.resolve(
      'react-native/jest/assetFileTransformer.js',
    ),
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-safe-area-context|react-native-fs|fflate|base-64)/)',
    'node_modules/.pnpm/(?!(react-native|@react-native\\+|react-native-safe-area-context|react-native-fs|fflate|base-64)@)',
  ],
};
