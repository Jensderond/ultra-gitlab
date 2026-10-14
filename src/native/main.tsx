import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isMac, isTauri } from './api/client';
import { startEventBridge } from './api/events';
import { App } from './app/App';
import { CrashBoundary } from './app/CrashScreen';
import './ui/tokens.css';
import './ui/base.css';

// index.html is shared with the classic UI, which themes via this class.
document.body.classList.remove('dark-theme');

// Native vibrancy only exists in the real macOS window (see src-tauri lib.rs).
if (isTauri && isMac) document.documentElement.classList.add('vibrant');

if (isTauri) {
  import('@tauri-apps/plugin-log')
    .then(({ attachConsole, error }) => {
      void attachConsole();
      // Uncaught UI errors land in the app log next to the backend's, for diagnostics.
      window.addEventListener('error', (e) => void error(`[ui] ${e.message} @ ${e.filename}:${e.lineno}`));
      window.addEventListener('unhandledrejection', (e) => {
        const reason = e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason);
        void error(`[ui] unhandled rejection: ${reason}`);
      });
    })
    .catch(() => {});
}

startEventBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </StrictMode>,
);
