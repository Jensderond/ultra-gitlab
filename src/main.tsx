import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { setupTauriEventListeners } from "./lib/tauriEvents";

// Self-hosted so the app's monospace font renders correctly offline (no CDN round-trip).
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/400-italic.css";

// Self-hosted default display font (headings) — offline-safe replacement for the
// previous Google Fonts-loaded Inter.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

// Self-hosted default diffs font — renders code diffs offline.
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource/geist-mono/400-italic.css";

// Forward frontend console.log/warn/error to the Rust log file
attachConsole().catch(() => {});

setupTauriEventListeners();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && <ReactQueryDevtools />}
    </QueryClientProvider>
  </React.StrictMode>,
);
