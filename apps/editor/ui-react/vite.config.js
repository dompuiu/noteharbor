import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const { version: appVersion } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
);

const apiPort = process.env.NOTE_HARBOR_API_PORT || process.env.PORT || 3001;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react()],
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
