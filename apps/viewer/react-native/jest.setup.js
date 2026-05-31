global.IS_REACT_ACT_ENVIRONMENT = true;
global.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  TemporaryDirectoryPath: '/mock/tmp',
  exists: jest.fn(() => Promise.resolve(false)),
  mkdir: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  readFile: jest.fn(() => Promise.resolve('')),
  unlink: jest.fn(() => Promise.resolve()),
  writeFile: jest.fn(() => Promise.resolve()),
}));

Object.defineProperties(global, {
  __DEV__: {
    configurable: true,
    enumerable: true,
    value: true,
    writable: true,
  },
  cancelAnimationFrame: {
    configurable: true,
    enumerable: true,
    value(id) {
      return clearTimeout(id);
    },
    writable: true,
  },
  nativeFabricUIManager: {
    configurable: true,
    enumerable: true,
    value: {},
    writable: true,
  },
  performance: {
    configurable: true,
    enumerable: true,
    value: {
      now: jest.fn(Date.now),
    },
    writable: true,
  },
  regeneratorRuntime: {
    configurable: true,
    enumerable: true,
    value: jest.requireActual('regenerator-runtime/runtime'),
    writable: true,
  },
  requestAnimationFrame: {
    configurable: true,
    enumerable: true,
    value(callback) {
      return setTimeout(() => callback(jest.now()), 0);
    },
    writable: true,
  },
  window: {
    configurable: true,
    enumerable: true,
    value: global,
    writable: true,
  },
});
