/**
 * Which UI this launch boots: the classic UI or the native UI beta.
 *
 * Both ship in the same build. In the app, the backend reads the stored choice
 * at startup (it also decides how the window is built) and injects it as
 * `window.__ULTRA_UI__` before any script runs. In a plain browser (`bun run
 * dev`), `?ui=native` / `?ui=classic` picks one and is remembered.
 *
 * Shared by both UIs, so keep it free of either one's imports.
 */

export type UiVariant = 'classic' | 'native';

declare global {
  interface Window {
    __ULTRA_UI__?: string;
  }
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const DEV_KEY = 'ug.ui';

function parse(value: string | null | undefined): UiVariant | null {
  return value === 'native' || value === 'classic' ? value : null;
}

function read(): UiVariant {
  const injected = parse(window.__ULTRA_UI__);
  if (injected) return injected;
  if (isTauri) return 'classic'; // mobile: the backend injects nothing

  const fromQuery = parse(new URLSearchParams(window.location.search).get('ui'));
  try {
    if (fromQuery) localStorage.setItem(DEV_KEY, fromQuery);
    return fromQuery ?? parse(localStorage.getItem(DEV_KEY)) ?? 'classic';
  } catch {
    return fromQuery ?? 'classic';
  }
}

export const uiVariant: UiVariant = read();

/** Store the choice and restart into the other UI. */
export async function switchUiVariant(variant: UiVariant): Promise<void> {
  if (!isTauri) {
    try {
      localStorage.setItem(DEV_KEY, variant);
    } catch {
      /* storage unavailable */
    }
    window.location.replace(`/?ui=${variant}`);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_ui_variant', { variant });
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
