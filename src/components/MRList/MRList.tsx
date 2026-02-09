/**
 * Merge request list container component.
 *
 * Displays a list of merge requests with filtering and selection.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { listMergeRequests } from '../../services/gitlab';
import type { MergeRequest } from '../../types';
import MRListItem from './MRListItem';
import './MRList.css';

/** Auto-refresh interval in milliseconds */
const AUTO_REFRESH_INTERVAL = 30000;

/**
 * Format a timestamp as relative time string.
 */
function formatSyncTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

interface MRListProps {
  /** GitLab instance ID to load MRs from */
  instanceId: number;
  /** Currently selected MR ID */
  selectedMrId?: number;
  /** Callback when an MR is selected */
  onSelect?: (mr: MergeRequest) => void;
  /** Index to use for keyboard navigation */
  focusIndex?: number;
  /** Callback when focus index changes */
  onFocusChange?: (index: number) => void;
  /** Callback when MRs are loaded/refreshed (for parent state sync) */
  onMRsLoaded?: (mrs: MergeRequest[]) => void;
}

/**
 * Merge request list component with filtering.
 */
export default function MRList({
  instanceId,
  selectedMrId,
  onSelect,
  focusIndex = 0,
  onFocusChange,
  onMRsLoaded,
}: MRListProps) {
  const [mrs, setMrs] = useState<MergeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [newMrIds, setNewMrIds] = useState<Set<number>>(new Set());
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const previousMrIdsRef = useRef<Set<number>>(new Set());

  // Performance target: <200ms for list load (per spec)
  const PERF_TARGET_MS = 200;

  // Auto-scroll to keep focused item visible
  useEffect(() => {
    const element = itemRefs.current.get(focusIndex);
    if (element) {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusIndex]);

  // Load merge requests
  const loadMRs = useCallback(async (isBackgroundRefresh = false) => {
    const startTime = performance.now();

    try {
      if (!isBackgroundRefresh) {
        setLoading(true);
      }
      setSyncStatus('syncing');
      setError(null);

      const data = await listMergeRequests(instanceId, { state: 'opened' });
      // Filter out MRs the user has already approved
      const filteredData = data.filter(mr => !mr.userHasApproved);

      // Track newly added MRs (only on background refresh)
      if (isBackgroundRefresh && previousMrIdsRef.current.size > 0) {
        const currentIds = new Set(filteredData.map(mr => mr.id));
        const newIds = new Set<number>();
        for (const id of currentIds) {
          if (!previousMrIdsRef.current.has(id)) {
            newIds.add(id);
          }
        }
        if (newIds.size > 0) {
          setNewMrIds(newIds);
          // Clear the "new" indicator after 5 seconds
          setTimeout(() => setNewMrIds(new Set()), 5000);
        }
      }

      // Update previous MR IDs ref
      previousMrIdsRef.current = new Set(filteredData.map(mr => mr.id));

      setMrs(filteredData);
      onMRsLoaded?.(filteredData);
      setLastSyncedAt(Date.now());
      setSyncStatus('success');

      // Reset success status after a brief moment
      setTimeout(() => setSyncStatus('idle'), 2000);

      // Log performance
      const duration = performance.now() - startTime;
      const isWithinTarget = duration < PERF_TARGET_MS;
      console.log(
        `[Performance] MR list load: ${duration.toFixed(1)}ms (${filteredData.length} items, ${data.length - filteredData.length} approved hidden) ${
          isWithinTarget ? '✓' : `⚠ exceeds ${PERF_TARGET_MS}ms target`
        }`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load merge requests');
      setSyncStatus('error');

      // Log performance even on error
      const duration = performance.now() - startTime;
      console.log(`[Performance] MR list load failed: ${duration.toFixed(1)}ms`);
    } finally {
      setLoading(false);
    }
  }, [instanceId, onMRsLoaded]);

  // Initial load
  useEffect(() => {
    loadMRs(false);
  }, [loadMRs]);

  // Auto-refresh on interval
  useEffect(() => {
    const intervalId = setInterval(() => {
      loadMRs(true);
    }, AUTO_REFRESH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [loadMRs]);

  // Re-fetch on mr-updated events (debounced at 500ms to handle bursts)
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: UnlistenFn | undefined;

    listen<{ mr_id: number; update_type: string; instance_id: number; iid: number }>(
      'mr-updated',
      () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          loadMRs(true);
        }, 500);
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unlisten?.();
    };
  }, [loadMRs]);

  // Update displayed sync time every 10 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const tickInterval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(tickInterval);
  }, []);

  // Handle MR selection
  const handleSelect = useCallback(
    (mr: MergeRequest, index: number) => {
      onFocusChange?.(index);
      onSelect?.(mr);
    },
    [onSelect, onFocusChange]
  );

  // Render loading state
  if (loading && mrs.length === 0) {
    return (
      <div className="mr-list-loading">
        <span>Loading merge requests...</span>
      </div>
    );
  }

  // Render error state
  if (error && mrs.length === 0) {
    return (
      <div className="mr-list-error">
        <span>{error}</span>
        <button onClick={() => loadMRs(false)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="mr-list">
      <div className="mr-list-content">
        {mrs.length === 0 ? (
          <div className="mr-list-empty">
            <p>No merge requests found</p>
            <span className="mr-list-empty-hint">
              Sync with GitLab to fetch merge requests
            </span>
          </div>
        ) : (
          mrs.map((mr, index) => (
            <MRListItem
              key={mr.id}
              ref={(el) => {
                if (el) itemRefs.current.set(index, el);
                else itemRefs.current.delete(index);
              }}
              mr={mr}
              selected={mr.id === selectedMrId || index === focusIndex}
              isNew={newMrIds.has(mr.id)}
              onClick={() => handleSelect(mr, index)}
            />
          ))
        )}
      </div>

      <div className="mr-list-footer">
        <span className="mr-count">{mrs.length} merge requests</span>
        <span className={`mr-sync-status mr-sync-status--${syncStatus}`}>
          {syncStatus === 'syncing' && (
            <>
              <span className="sync-spinner" />
              Syncing...
            </>
          )}
          {syncStatus === 'success' && (
            <>
              <span className="sync-check">✓</span>
              Updated
            </>
          )}
          {syncStatus === 'idle' && lastSyncedAt && (
            <>Synced {formatSyncTime(lastSyncedAt)}</>
          )}
          {syncStatus === 'error' && (
            <>
              <span className="sync-error">!</span>
              Sync failed
            </>
          )}
        </span>
      </div>
    </div>
  );
}
