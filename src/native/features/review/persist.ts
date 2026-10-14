/**
 * Tiny localStorage-backed store with subscriptions, so every component
 * reading a key (the review screen, the inbox preview) updates together —
 * also across windows via the `storage` event.
 */

import { useCallback, useSyncExternalStore } from 'react';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const memo = new Map<string, { raw: string | null; value: unknown }>();

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    memo.delete(e.key);
    notify(e.key);
  });
}

/** Read a JSON value; the same object is returned until the stored value changes. */
export function readJSON<T>(key: string): T | undefined {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const hit = memo.get(key);
  if (hit && hit.raw === raw) return hit.value as T | undefined;
  let value: T | undefined;
  try {
    value = raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    value = undefined;
  }
  memo.set(key, { raw, value });
  return value;
}

export function writeJSON<T>(key: string, value: T | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — keep going in memory */
  }
  memo.delete(key);
  notify(key);
}

export function updateJSON<T>(key: string, update: (prev: T | undefined) => T | undefined) {
  writeJSON(key, update(readJSON<T>(key)));
}

/** Subscribe to a stored JSON value. Pass `null` to skip. */
export function usePersisted<T>(key: string | null): T | undefined {
  const subscribe = useCallback(
    (l: Listener) => {
      if (!key) return () => {};
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(l);
      return () => void set!.delete(l);
    },
    [key],
  );
  const get = useCallback(() => (key ? readJSON<T>(key) : undefined), [key]);
  return useSyncExternalStore(subscribe, get);
}
