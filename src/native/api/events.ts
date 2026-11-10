/**
 * Backend → UI events. The backend syncs GitLab in the background and emits
 * these when cached data changes; we translate them into cache invalidations.
 */

import { invalidate, matches, refetchStale, setSyncGate, type QueryKey } from '../data/query';
import { api, isTauri } from './client';
import type { AutoRunUpdatedPayload } from './types';

type Unlisten = () => void;

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!isTauri) return () => {};
  const { listen: tauriListen } = await import('@tauri-apps/api/event');
  return tauriListen<T>(event, (e) => handler(e.payload));
}

export interface SyncProgress {
  type: 'started' | 'progress' | 'completed' | 'error';
  operation?: string;
  message?: string;
}

const syncListeners = new Set<(p: SyncProgress) => void>();

/** Observe background sync progress (for the toolbar's refresh indicator). */
export function onSyncProgress(listener: (p: SyncProgress) => void): Unlisten {
  syncListeners.add(listener);
  return () => void syncListeners.delete(listener);
}

/**
 * What a finished sync refreshes through the listeners below (`mr-updated`
 * covers each synced MR's ['mr', id, ...]). Everything else — ['live', ...],
 * pipeline jobs and traces, settings — is left to its own staleTime/polling.
 */
const SYNC_FED: QueryKey[] = [
  ['mrs'],
  ['mr'],
  ['pipelines', 'statuses'],
  ['pipelines', 'history'],
  ['pipelines', 'projects'],
];
const syncFed = (key: QueryKey) => SYNC_FED.some((p) => matches(key, p));

let syncing = false;

/** Resolves true on the next sync start/end, false after `ms` without one. */
function nextSync(edge: 'start' | 'end', ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(false), ms);
    const off = onSyncProgress((p) => {
      const ended = p.type === 'completed' || p.type === 'error';
      if (edge === 'end' ? ended : !ended) done(true);
    });
    function done(seen: boolean) {
      clearTimeout(timer);
      off();
      resolve(seen);
    }
  });
}

/** Long enough for a slow sync; past it we stop waiting and read the cache directly. */
const SYNC_TIMEOUT = 60_000;

/**
 * Manual refresh (⌘R, Sync now): trigger a sync and resolve once it finished.
 * Cached data refreshes through the sync's own events rather than right away
 * and again afterwards; other reads (live GitLab ones included) only refetch
 * if past their own staleTime. The backend may skip a sync that just ran but
 * still reports completion, so this never waits on a sync actually running.
 */
export async function syncAndRefresh(): Promise<void> {
  refetchStale((key) => !syncFed(key));
  const ended = isTauri ? nextSync('end', SYNC_TIMEOUT) : Promise.resolve(false);
  const refreshCached = () => SYNC_FED.forEach((p) => void invalidate(p));
  try {
    await api.triggerSync(false);
  } catch (e) {
    refreshCached();
    throw e;
  }
  // No completion event seen (plain browser, or it never came): read the cache ourselves.
  if (!(await ended)) refreshCached();
}

let started = false;

export function startEventBridge() {
  if (started) return;
  started = true;

  setSyncGate({
    covers: syncFed,
    // The backend starts a catch-up sync right after focus if its data is old.
    settled: async () => {
      if (!syncing && !(await nextSync('start', 1500))) return;
      if (syncing) await nextSync('end', SYNC_TIMEOUT);
      // Let the coalesced mr-updated invalidations (400ms) land first.
      await new Promise((r) => setTimeout(r, 500));
    },
  });

  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  void listen<{ mr_id: number; update_type: string }>('mr-updated', ({ mr_id }) => {
    // Sync emits bursts per MR; coalesce them.
    clearTimeout(timers.get(mr_id));
    timers.set(
      mr_id,
      setTimeout(() => {
        timers.delete(mr_id);
        void invalidate(['mr', mr_id]);
        void invalidate(['mrs']);
      }, 400),
    );
  });

  void listen<{ mr_id: number }>('action-synced', ({ mr_id }) => {
    void invalidate(['mr', mr_id]);
    void invalidate(['mrs']);
  });

  void listen<{ mrId: number }>('auto-merge-updated', ({ mrId }) => {
    void invalidate(['mr', mrId]);
    void invalidate(['mrs']);
  });

  void listen<AutoRunUpdatedPayload>('auto-run-updated', ({ instanceId, projectId, pipelineId }) => {
    // Claim changed (and, when played, the job's status): refresh that pipeline only.
    void invalidate(['pipelines', 'autorun', instanceId, projectId, pipelineId]);
    void invalidate(['pipelines', 'jobs', instanceId, projectId, pipelineId]);
  });

  // The backend sends `{ phase, message, is_error }` (phase: starting,
  // fetching_mrs, …, complete, failed); translate it to SyncProgress.
  void listen<{ phase: string; message?: string; is_error?: boolean }>('sync-progress', (raw) => {
    const p: SyncProgress = {
      type:
        raw.phase === 'complete'
          ? 'completed'
          : raw.phase === 'failed'
            ? 'error'
            : raw.phase === 'starting'
              ? 'started'
              : 'progress',
      operation: raw.phase,
      message: raw.message,
    };
    syncing = p.type === 'started' || p.type === 'progress';
    syncListeners.forEach((l) => l(p));
    // `failed` still means a (partial) sync ran — e.g. one instance errored.
    if (p.type === 'completed' || p.type === 'error') {
      void invalidate(['mrs']);
      // Pipeline overviews may have moved on. Jobs and traces are left alone:
      // each is a live GitLab read, finished ones never change, and screens
      // showing a running pipeline poll them on their own.
      void invalidate(['pipelines', 'statuses']);
      void invalidate(['pipelines', 'history']);
      void invalidate(['pipelines', 'projects']);
    }
  });
}
