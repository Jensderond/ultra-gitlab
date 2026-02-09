/**
 * Hook for tracking sync status and pending actions.
 *
 * Provides real-time sync status information including
 * pending and failed action counts. Subscribes to Tauri events
 * for reactive updates.
 */

import { useState, useEffect, useCallback } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '../services/tauri';

/** Sync status state */
interface SyncStatus {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Number of pending actions */
  pendingCount: number;
  /** Number of failed actions */
  failedCount: number;
  /** Last sync timestamp (Unix seconds) */
  lastSyncTime: number | null;
  /** Number of MRs synced in last run */
  lastSyncMrCount: number;
  /** Error message if any */
  error: string | null;
}

/** Sync log entry from backend */
export interface SyncLogEntry {
  id: number;
  operation: string;
  status: string;
  mr_id: number | null;
  message: string | null;
  duration_ms: number | null;
  timestamp: number;
}

/** Payload for sync-progress events */
interface SyncProgressPayload {
  phase: string;
  message: string;
  processed: number | null;
  total: number | null;
  is_error: boolean;
}

/** Payload for action-synced events */
interface ActionSyncedPayload {
  action_id: number;
  action_type: string;
  success: boolean;
  error: string | null;
  mr_id: number;
  local_reference_id: number | null;
}

/** Payload for mr-updated events */
interface MrUpdatedPayload {
  mr_id: number;
  update_type: string;
  instance_id: number;
  iid: number;
}

/**
 * Hook for tracking sync status.
 */
export default function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    lastSyncTime: null,
    lastSyncMrCount: 0,
    error: null,
  });

  const [recentLogs, setRecentLogs] = useState<SyncLogEntry[]>([]);
  const [newMrsCount, setNewMrsCount] = useState(0);

  // Fetch sync status from backend
  const fetchStatus = useCallback(async () => {
    try {
      // Get full sync status
      const result = await invoke<{
        is_syncing: boolean;
        last_sync_time: number | null;
        last_error: string | null;
        pending_actions: number;
        failed_actions: number;
        last_sync_mr_count: number;
        recent_logs: SyncLogEntry[];
      }>('get_sync_status');

      setStatus((prev) => ({
        ...prev,
        isSyncing: result.is_syncing,
        pendingCount: result.pending_actions,
        failedCount: result.failed_actions,
        lastSyncTime: result.last_sync_time,
        lastSyncMrCount: result.last_sync_mr_count,
        error: result.last_error,
      }));

      setRecentLogs(result.recent_logs);
    } catch (err) {
      // Fall back to just getting action counts
      try {
        const counts = await invoke<{ pending: number; failed: number }>('get_action_counts');
        setStatus((prev) => ({
          ...prev,
          pendingCount: counts.pending,
          failedCount: counts.failed,
        }));
      } catch {
        // Silently ignore - commands may not exist yet
        console.debug('Sync status fetch failed:', err);
      }
    }
  }, []);

  // Trigger a manual sync
  const triggerSync = useCallback(async () => {
    try {
      setStatus((prev) => ({ ...prev, isSyncing: true, error: null }));
      await invoke('trigger_sync');
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncTime: Date.now() / 1000,
      }));
      // Reset new MRs count after manual sync
      setNewMrsCount(0);
      await fetchStatus();
    } catch (err) {
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        error: err instanceof Error ? err.message : 'Sync failed',
      }));
    }
  }, [fetchStatus]);

  // Retry all failed actions
  const retryAllActions = useCallback(async () => {
    try {
      await invoke('retry_failed_actions');
      await fetchStatus();
    } catch (err) {
      console.error('Retry all failed:', err);
    }
  }, [fetchStatus]);

  // Discard a failed action
  const discardAction = useCallback(async (actionId: number) => {
    try {
      await invoke('discard_failed_action', { actionId });
      await fetchStatus();
    } catch (err) {
      console.error('Discard failed:', err);
    }
  }, [fetchStatus]);

  // Clear new MRs notification
  const clearNewMrsNotification = useCallback(() => {
    setNewMrsCount(0);
  }, []);

  // Subscribe to Tauri events
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    // Listen for sync-progress events
    listen<SyncProgressPayload>('sync-progress', (event) => {
      const payload = event.payload;

      // Update syncing status based on phase
      if (payload.phase === 'starting') {
        setStatus((prev) => ({ ...prev, isSyncing: true, error: null }));
      } else if (payload.phase === 'complete') {
        setStatus((prev) => ({
          ...prev,
          isSyncing: false,
          lastSyncTime: Date.now() / 1000,
          lastSyncMrCount: payload.processed ?? prev.lastSyncMrCount,
        }));
        fetchStatus();
      } else if (payload.phase === 'failed' || payload.is_error) {
        setStatus((prev) => ({
          ...prev,
          isSyncing: false,
          error: payload.message,
        }));
      }
    }).then((fn) => unlisteners.push(fn));

    // Listen for action-synced events
    listen<ActionSyncedPayload>('action-synced', () => {
      // Refresh status when actions are synced
      fetchStatus();
    }).then((fn) => unlisteners.push(fn));

    // Listen for mr-updated events
    listen<MrUpdatedPayload>('mr-updated', (event) => {
      // Track new MRs
      if (event.payload.update_type === 'created') {
        setNewMrsCount((prev) => prev + 1);
      }
    }).then((fn) => unlisteners.push(fn));

    // Cleanup listeners on unmount
    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [fetchStatus]);

  // Fetch initial status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    ...status,
    recentLogs,
    newMrsCount,
    refresh: fetchStatus,
    triggerSync,
    retryAllActions,
    discardAction,
    clearNewMrsNotification,
  };
}
