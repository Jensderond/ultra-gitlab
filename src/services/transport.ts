/**
 * Transport abstraction layer.
 *
 * Detects whether the app is running inside a Tauri webview (desktop or iOS).
 * The app only ever runs inside a Tauri webview — there is no browser-only mode.
 */

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * True when running inside a Tauri webview.
 */
export const isTauri: boolean = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ============================================================================
// Tauri event listener helper
// ============================================================================

type UnlistenFn = () => void;

/**
 * Listen for a Tauri event.
 */
export async function tauriListen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, handler);
}

// ============================================================================
// Open external URL helper
// ============================================================================

/**
 * Open a URL externally via Tauri's plugin-opener.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

// ============================================================================
// Unified invoke — the public API
// ============================================================================

/**
 * Invoke a backend command via Tauri IPC.
 */
export async function transportInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}
