/**
 * App updates: we want everyone on the latest build (releases often cut load
 * on the GitLab server), so updating is as close to automatic as it gets
 * without restarting under someone's feet.
 *
 *  - Checks at launch, every hour, and when the window regains focus after
 *    15+ minutes away.
 *  - A found update downloads in the background straight away (the sidebar
 *    button shows it in blue with progress).
 *  - Once downloaded, the button turns green; one click installs and
 *    relaunches.
 *
 * Failures stay quiet and retry on the next check. iOS can't self-update
 * (App Store / TestFlight only), and the classic UI keeps its own checker.
 * The dev server (`bun run dev`) skips the automatic checks; "Check for
 * updates" in Settings still works there.
 */

import { useSyncExternalStore } from 'react';
import { isTauri } from '../../api/client';

const CHECK_EVERY_MS = 60 * 60 * 1000;
const FOCUS_RECHECK_MS = 15 * 60 * 1000;

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';

export interface UpdateState {
  phase: UpdatePhase;
  /** Version of the update being downloaded / ready to install. */
  version: string | null;
  /** Release notes of that version. */
  notes: string | null;
  /** Download progress 0–1, or null while the size is unknown. */
  progress: number | null;
  error: string | null;
  lastChecked: number | null;
}

// Narrow view of the updater plugin's `Update`, so this file doesn't need its types at load.
interface PendingUpdate {
  version: string;
  body?: string;
  download(onEvent: (e: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
}
type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

let state: UpdateState = { phase: 'idle', version: null, notes: null, progress: null, error: null, lastChecked: null };
let pending: PendingUpdate | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getUpdateState = () => state;

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const busy = () => state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing';

/**
 * Look for an update and, if there is one, download it. Resolves to the
 * version found (also when it was already downloaded), or null when up to date.
 * `manual` surfaces a failed check as an error instead of swallowing it.
 */
export async function checkForUpdate({ manual = false } = {}): Promise<string | null> {
  if (!isTauri || busy()) return state.version;
  // Already downloaded: nothing to do until it's installed.
  if (state.phase === 'ready') return state.version;

  set({ phase: 'checking', error: null });
  let update: PendingUpdate | null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    update = (await check()) as PendingUpdate | null;
  } catch (e) {
    set({ phase: manual ? 'error' : 'idle', error: manual ? message(e) : null, lastChecked: Date.now() });
    return null;
  }
  set({ lastChecked: Date.now() });
  if (!update) {
    set({ phase: 'idle' });
    return null;
  }

  pending = update;
  set({ phase: 'downloading', version: update.version, notes: update.body ?? null, progress: null });
  let total = 0;
  let received = 0;
  try {
    await update.download((e) => {
      if (e.event === 'Started') {
        total = e.data.contentLength ?? 0;
        set({ progress: total ? 0 : null });
      } else if (e.event === 'Progress') {
        received += e.data.chunkLength;
        if (total) set({ progress: Math.min(1, received / total) });
      } else {
        set({ progress: 1 });
      }
    });
    set({ phase: 'ready', progress: 1 });
  } catch (e) {
    pending = null;
    set({ phase: 'error', error: `Couldn't download ${update.version}: ${message(e)}`, progress: null });
  }
  return update.version;
}

/** Install the downloaded update and relaunch into it. */
export async function installUpdate(): Promise<void> {
  if (!pending || state.phase !== 'ready') return;
  set({ phase: 'installing', error: null });
  try {
    await pending.install();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    // The downloaded bytes are consumed by a failed install; start over on retry.
    pending = null;
    set({ phase: 'error', error: `Couldn't install ${state.version}: ${message(e)}` });
  }
}

/** Retry after an error: re-check and re-download. */
export function retryUpdate() {
  set({ phase: 'idle', error: null });
  void checkForUpdate({ manual: true });
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

let started = false;

/** Start the automatic checks. Safe to call more than once. */
export function startUpdater() {
  if (started || !isTauri || import.meta.env.DEV) return;
  started = true;
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  window.addEventListener('focus', () => {
    if (!state.lastChecked || Date.now() - state.lastChecked > FOCUS_RECHECK_MS) void checkForUpdate();
  });
}
