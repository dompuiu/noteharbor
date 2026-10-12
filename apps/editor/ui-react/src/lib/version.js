// The editor app version, baked in at build time from package.json via the
// `__APP_VERSION__` define in vite.config.js. Falls back to "dev" outside a
// Vite build (plain node imports).
/* global __APP_VERSION__ */
const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export { APP_VERSION };
