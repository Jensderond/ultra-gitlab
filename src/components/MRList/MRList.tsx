/**
 * Merge request list container component.
 *
 * Displays a list of merge requests with filtering and selection.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMRListQuery } from '../../hooks/queries/useMRListQuery';
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
  /** Optional search query to filter MRs by title, author, project name */
  filterQuery?: string;
  /** Callback when filtered/total counts change */
  onFilteredCountChange?: (counts: { filtered: number; total: number }) => void;
  /** When true, show MRs the user has already approved (hidden by default) */
  showApproved?: boolean;
  /** Callback to toggle the showApproved filter */
  onToggleApproved?: () => void;
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
  filterQuery,
  onFilteredCountChange,
  showApproved = false,
  onToggleApproved,
}: MRListProps) {
  const query = useMRListQuery(instanceId);
  const queryClient = useQueryClient();

  // UI-only state
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [newMrIds, setNewMrIds] = useState<Set<number>>(new Set());

  // Apply showApproved filter to query data
  const mrs = useMemo(() => {
    const data = query.data ?? [];
    return showApproved ? data : data.filter(mr => !mr.userHasApproved);
  }, [query.data, showApproved]);

  const totalFetched = query.data?.length ?? 0;
  const approvedCount = totalFetched - mrs.length;

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

  // Notify parent when MRs change
  useEffect(() => {
    onMRsLoaded?.(mrs);
  }, [mrs, onMRsLoaded]);

  // Track previous query data to detect new MRs
  const previousDataRef = useRef<MergeRequest[]>([]);
  useEffect(() => {
    if (!query.data) return;
    const prev = previousDataRef.current;
    if (prev.length > 0) {
      const prevIds = new Set(prev.map(mr => mr.id));
      const newIds = new Set<number>();
      for (const mr of mrs) {
        if (!prevIds.has(mr.id)) newIds.add(mr.id);
      }
      if (newIds.size > 0) {
        setNewMrIds(newIds);
        setTimeout(() => setNewMrIds(new Set()), 5000);
      }
    }
    previousDataRef.current = query.data;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  // Sync syncStatus with isFetching transitions
  const prevFetchingRef = useRef(false);
  useEffect(() => {
    if (query.isFetching === prevFetchingRef.current) return;
    prevFetchingRef.current = query.isFetching;

    if (query.isFetching) {
      setSyncStatus('syncing');
    } else if (query.isError) {
      setSyncStatus('error');
    } else {
      setSyncStatus('success');
      setLastSyncedAt(Date.now());
      const t = setTimeout(() => setSyncStatus('idle'), 2000);
      return () => clearTimeout(t);
    }
  }, [query.isFetching, query.isError]);

  // Update displayed sync time every 10 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const tickInterval = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(tickInterval);
  }, []);

  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Auto-scroll to keep focused item visible
  useEffect(() => {
    const element = itemRefs.current.get(focusIndex);
    if (element) {
      element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusIndex]);

  // Handle MR selection
  const handleSelect = useCallback(
    (mr: MergeRequest, index: number) => {
      onFocusChange?.(index);
      onSelect?.(mr);
    },
    [onSelect, onFocusChange]
  );

  const error = query.error instanceof Error ? query.error.message : query.error ? 'Failed to load merge requests' : null;

  // Render loading state (foreground — first load with no data)
  if (query.isLoading && mrs.length === 0) {
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
        <button onClick={() => queryClient.invalidateQueries({ queryKey: ['mrList'] })}>Retry</button>
      </div>
    );
  }

  return (
    <div className="mr-list">
      <div className="mr-list-content">
        {mrs.length === 0 ? (
          <div className="mr-list-empty">
            <p>No open merge requests</p>
            <span className="mr-list-empty-hint">
              {!showApproved && totalFetched > 0
                ? `${totalFetched} approved — toggle the filter above to show them`
                : 'Sync with GitLab to fetch merge requests'}
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
        {!showApproved && approvedCount > 0 && mrs.length > 0 && (
          <button
            className="mr-list-approved-banner"
            onClick={onToggleApproved}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {approvedCount} approved {approvedCount === 1 ? 'MR' : 'MRs'} hidden
          </button>
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
