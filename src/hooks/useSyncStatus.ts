/**
 * Hook for tracking sync status and pending actions.
 *
 * Provides real-time sync status information including
 * pending and failed action counts.
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '../services/tauri';

interface SyncStatus {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Number of pending actions */
  pendingCount: number;
  /** Number of failed actions */
  failedCount: number;
  /** Last sync timestamp */
  lastSyncTime: number | null;
  /** Error message if any */
  error: string | null;
}

interface UseSyncStatusOptions {
  /** Poll interval in milliseconds (default: 5000) */
  pollInterval?: number;
  /** Whether to automatically poll (default: true) */
  autoPoll?: boolean;
}

/**
 * Hook for tracking sync status.
 */
export default function useSyncStatus(options: UseSyncStatusOptions = {}) {
  const { pollInterval = 5000, autoPoll = true } = options;

  const [status, setStatus] = useState<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    lastSyncTime: null,
    error: null,
  });

  // Fetch sync status from backend
  const fetchStatus = useCallback(async () => {
    try {
      // Get action counts from sync queue
      const result = await invoke<{ pending: number; failed: number }>('get_action_counts');

      setStatus((prev) => ({
        ...prev,
        pendingCount: result.pending,
        failedCount: result.failed,
        error: null,
      }));
    } catch (err) {
      // Silently ignore errors for now - the command may not exist yet
      // This allows the hook to work even before sync commands are implemented
      console.debug('Sync status fetch failed:', err);
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
      await fetchStatus();
    } catch (err) {
      setStatus((prev) => ({
        ...prev,
        isSyncing: false,
        error: err instanceof Error ? err.message : 'Sync failed',
      }));
    }
  }, [fetchStatus]);

  // Retry a failed action
  const retryAction = useCallback(async (actionId: number) => {
    try {
      await invoke('retry_failed_action', { actionId });
      await fetchStatus();
    } catch (err) {
      console.error('Retry failed:', err);
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

  // Poll for status updates
  useEffect(() => {
    // Initial fetch
    fetchStatus();

    if (!autoPoll) return;

    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval, autoPoll]);

  return {
    ...status,
    refresh: fetchStatus,
    triggerSync,
    retryAction,
    discardAction,
  };
}
