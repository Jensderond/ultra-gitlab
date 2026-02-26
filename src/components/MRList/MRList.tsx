/**
 * Merge request list container component.
 *
 * Displays a list of merge requests with filtering and selection.
 */

import { useState, useReducer, useEffect, useCallback, useRef, useMemo } from 'react';
import { tauriListen } from '../../services/transport';
import { listMergeRequests } from '../../services/gitlab';
import type { MergeRequest } from '../../types';
import MRListItem from './MRListItem';
import './MRList.css';

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
  /** Increment to trigger a manual refresh from parent */
  refreshTrigger?: number;
  /** Optional search query to filter MRs by title, author, project name */
  filterQuery?: string;
  /** Callback when filtered/total counts change */
  onFilteredCountChange?: (counts: { filtered: number; total: number }) => void;
}

interface MRListState {
  mrs: MergeRequest[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  newMrIds: Set<number>;
  syncStatus: 'idle' | 'syncing' | 'success' | 'error';
}

type MRListAction =
  | { type: 'FETCH_START'; isBackground: boolean }
  | { type: 'FETCH_SUCCESS'; mrs: MergeRequest[]; newMrIds: Set<number>; timestamp: number }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'LOAD_END' }
  | { type: 'SYNC_IDLE' }
  | { type: 'CLEAR_NEW_MRS' };

function mrListReducer(state: MRListState, action: MRListAction): MRListState {
  switch (action.type) {
    case 'FETCH_START':
      return {
        ...state,
        loading: action.isBackground ? state.loading : true,
        syncStatus: 'syncing',
        error: null,
      };
    case 'FETCH_SUCCESS':
      return {
        ...state,
        mrs: action.mrs,
        loading: false,
        lastSyncedAt: action.timestamp,
        syncStatus: 'success',
        newMrIds: action.newMrIds.size > 0 ? action.newMrIds : state.newMrIds,
      };
    case 'FETCH_ERROR':
      return { ...state, error: action.error, loading: false, syncStatus: 'error' };
    case 'LOAD_END':
      return { ...state, loading: false };
    case 'SYNC_IDLE':
      return { ...state, syncStatus: 'idle' };
    case 'CLEAR_NEW_MRS':
      return { ...state, newMrIds: new Set() };
  }
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
  refreshTrigger = 0,
  filterQuery,
  onFilteredCountChange,
}: MRListProps) {
  const [state, dispatch] = useReducer(mrListReducer, {
    mrs: [],
    loading: true,
    error: null,
    lastSyncedAt: null,
    newMrIds: new Set<number>(),
    syncStatus: 'idle',
  });

  const { mrs, loading, error, lastSyncedAt, newMrIds, syncStatus } = state;

  // Filter MRs by search query
  const filteredMrs = useMemo(() => {
    if (!filterQuery?.trim()) return mrs;
    const q = filterQuery.toLowerCase();
    return mrs.filter((mr) => {
      const title = mr.title?.toLowerCase() ?? '';
      const author = mr.authorUsername?.toLowerCase() ?? '';
      const project = mr.projectName?.toLowerCase() ?? '';
      return title.includes(q) || author.includes(q) || project.includes(q);
    });
  }, [mrs, filterQuery]);

  // Report filtered counts to parent
  useEffect(() => {
    onFilteredCountChange?.({ filtered: filteredMrs.length, total: mrs.length });
  }, [filteredMrs.length, mrs.length, onFilteredCountChange]);

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
      dispatch({ type: 'FETCH_START', isBackground: isBackgroundRefresh });

      const data = await listMergeRequests(instanceId, { state: 'opened' });
      // Filter out MRs the user has already approved
      const filteredData = data.filter(mr => !mr.userHasApproved);

      // Track newly added MRs (only on background refresh)
      let detectedNewIds = new Set<number>();
      if (isBackgroundRefresh && previousMrIdsRef.current.size > 0) {
        const currentIds = new Set(filteredData.map(mr => mr.id));
        for (const id of currentIds) {
          if (!previousMrIdsRef.current.has(id)) {
            detectedNewIds.add(id);
          }
        }
        if (detectedNewIds.size > 0) {
          // Clear the "new" indicator after 5 seconds
          setTimeout(() => dispatch({ type: 'CLEAR_NEW_MRS' }), 5000);
        }
      }

      // Update previous MR IDs ref
      previousMrIdsRef.current = new Set(filteredData.map(mr => mr.id));

      dispatch({ type: 'FETCH_SUCCESS', mrs: filteredData, newMrIds: detectedNewIds, timestamp: Date.now() });
      onMRsLoaded?.(filteredData);

      // Reset success status after a brief moment
      setTimeout(() => dispatch({ type: 'SYNC_IDLE' }), 2000);

      // Log performance
      const duration = performance.now() - startTime;
      const isWithinTarget = duration < PERF_TARGET_MS;
      console.log(
        `[Performance] MR list load: ${duration.toFixed(1)}ms (${filteredData.length} items, ${data.length - filteredData.length} approved hidden) ${
          isWithinTarget ? '✓' : `⚠ exceeds ${PERF_TARGET_MS}ms target`
        }`
      );
    } catch (err) {
      dispatch({ type: 'FETCH_ERROR', error: err instanceof Error ? err.message : 'Failed to load merge requests' });

      // Log performance even on error
      const duration = performance.now() - startTime;
      console.log(`[Performance] MR list load failed: ${duration.toFixed(1)}ms`);
    }
  }, [instanceId, onMRsLoaded]);

  // Initial load
  useEffect(() => {
    loadMRs(false);
  }, [loadMRs]);

  // Manual refresh from parent
  const initialTrigger = useRef(refreshTrigger);
  useEffect(() => {
    if (refreshTrigger !== initialTrigger.current) {
      loadMRs(false);
    }
  }, [refreshTrigger, loadMRs]);

  // Re-fetch on mr-updated events (debounced at 500ms to handle bursts)
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | undefined;

    tauriListen<{ mr_id: number; update_type: string; instance_id: number; iid: number }>(
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
        ) : filteredMrs.length === 0 ? (
          <div className="mr-list-empty">
            <p>No merge requests match your search</p>
          </div>
        ) : (
          filteredMrs.map((mr, index) => (
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
              highlightQuery={filterQuery}
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
