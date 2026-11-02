import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// electron-vite auto-detects the conventional entries: src/main/index.ts,
// src/preload/index.ts, and src/renderer/index.html. externalizeDepsPlugin keeps
// node dependencies (the engine and its transitive deps) out of the main/preload
// bundles so they load from node_modules at runtime — which is also what lets
// electron-builder package them later (M5.11).
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    // A sandboxed preload runs as CommonJS and can only require('electron') —
    // it cannot require node_modules. So emit CJS and BUNDLE deps (zod) into it
    // rather than externalizing them.
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      },
    },
  },
});
