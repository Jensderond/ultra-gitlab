import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";
import { readdirSync, unlinkSync } from "fs";
import { join } from "path";

// Handle CommonJS default export
const monacoEditorPlugin = (monacoEditorPluginModule as { default: typeof monacoEditorPluginModule }).default || monacoEditorPluginModule;

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Vite bundles all Monaco worker entry points it discovers via `new Worker(new URL(...))`.
// The vite-plugin-monaco-editor plugin overrides getWorkerUrl at runtime so only the
// workers listed in `languageWorkers` are actually loaded. This plugin deletes the
// dead worker bundles (json, css, html) from the build output.
const unusedWorkers = ["json.worker", "css.worker", "html.worker"];
function removeUnusedMonacoWorkers(): Plugin {
  return {
    name: "remove-unused-monaco-workers",
    apply: "build",
    closeBundle() {
      const assetsDir = join("dist", "assets");
      try {
        for (const file of readdirSync(assetsDir)) {
          if (unusedWorkers.some((w) => file.startsWith(w))) {
            unlinkSync(join(assetsDir, file));
          }
        }
      } catch {
        // dist/assets may not exist in some build configs
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    monacoEditorPlugin({
      // Only editor + typescript workers are needed for diff viewing
      languageWorkers: ["editorWorkerService", "typescript"],
    }),
    removeUnusedMonacoWorkers(),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
