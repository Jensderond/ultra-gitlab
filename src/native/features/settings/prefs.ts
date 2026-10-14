/**
 * Front-end-only preferences (the backend has no field for these).
 * Stored in localStorage; components subscribe with the hooks below.
 *
 *   const [mode, setMode] = useDiffViewMode();   // 'unified' | 'split'
 */

import { useSyncExternalStore } from 'react';
import type { DiffViewMode } from '../../api/types';

const DIFF_MODE_KEY = 'ug.diffViewMode';
const listeners = new Set<() => void>();

export function getDiffViewMode(): DiffViewMode {
  try {
    return localStorage.getItem(DIFF_MODE_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

export function setDiffViewMode(mode: DiffViewMode) {
  try {
    localStorage.setItem(DIFF_MODE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

/** The default diff layout chosen in Settings → Review. */
export function useDiffViewMode(): [DiffViewMode, (mode: DiffViewMode) => void] {
  const mode = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getDiffViewMode,
  );
  return [mode, setDiffViewMode];
}

if (typeof window !== 'undefined') {
  // Another window changed it.
  window.addEventListener('storage', (e) => {
    if (e.key === DIFF_MODE_KEY) listeners.forEach((l) => l());
  });
}
