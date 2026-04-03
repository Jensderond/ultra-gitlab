import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { setupTauriEventListeners } from "./lib/tauriEvents";

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
