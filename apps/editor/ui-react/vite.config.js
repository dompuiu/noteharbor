import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const { version: appVersion } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

const apiPort = process.env.NOTE_HARBOR_API_PORT || process.env.PORT || 3002;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
  build: {
    // Tauri serves dist from disk, so splitting node_modules into separate
    // chunks only silences the >500 kB warning and improves caching. Vite
    // injects all chunks into index.html automatically; no lazy() or
    // Suspense changes, so runtime behavior is identical.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "router",
              test: /node_modules[\\/]react-router/,
              priority: 15,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    pool: "vmThreads",
  },
});
