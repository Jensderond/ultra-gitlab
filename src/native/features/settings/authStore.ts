/** Which instance (if any) needs a fresh token — set by `auth-expired`, shown by `AppServicesHost`. */

import { useSyncExternalStore } from 'react';

export interface AuthExpired {
  instanceId: number;
  instanceUrl: string;
  message: string;
}

let current: AuthExpired | null = null;
const listeners = new Set<() => void>();
/** instanceId → when the user chose "Later"; don't nag again for a while. */
const snoozed = new Map<number, number>();
const SNOOZE_MS = 15 * 60_000;

export function reportAuthExpired(e: AuthExpired) {
  if (current?.instanceId === e.instanceId) return;
  const until = snoozed.get(e.instanceId);
  if (until && Date.now() < until) return;
  current = e;
  listeners.forEach((l) => l());
}

export function dismissAuthExpired(later: boolean) {
  if (current) {
    if (later) snoozed.set(current.instanceId, Date.now() + SNOOZE_MS);
    else snoozed.delete(current.instanceId);
  }
  current = null;
  listeners.forEach((l) => l());
}

export function useAuthExpired(): AuthExpired | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
