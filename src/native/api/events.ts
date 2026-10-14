/**
 * Backend → UI events. The backend syncs GitLab in the background and emits
 * these when cached data changes; we translate them into cache invalidations.
 */

import { invalidate } from '../data/query';
import { isTauri } from './client';
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

let started = false;

export function startEventBridge() {
  if (started) return;
  started = true;

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
    syncListeners.forEach((l) => l(p));
    // `failed` still means a (partial) sync ran — e.g. one instance errored.
    if (p.type === 'completed' || p.type === 'error') {
      void invalidate(['mrs']);
      void invalidate(['pipelines']);
    }
  });
}
