/**
 * Merge request list container component.
 *
 * Displays a list of merge requests with filtering and selection.
 */

import { useState, useEffect, useCallback, useRef, useMemo, useImperativeHandle } from 'react';
import type { ReactNode, Ref } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMRListQuery } from '../../hooks/queries/useMRListQuery';
import { useSnoozeMRMutation } from '../../hooks/queries/useSnoozeMRMutation';
import { isSnoozed } from '../../lib/snooze';
import type { MergeRequest } from '../../types';
import MRListItem from './MRListItem';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import { useManualRefreshHandler } from '../../hooks/useManualRefreshHandler';
import { useSearchReveal } from '../../hooks/useSearchReveal';
import { PullToRefreshIndicator } from '../PullToRefresh';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { CheckCircleIcon } from '../icons';
import './MRList.css';

const SYNCING_INDICATOR_DELAY_MS = 350;
const UPDATED_INDICATOR_DURATION_MS = 2000;

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
  /** When true, show snoozed MRs (hidden by default) */
  showSnoozed?: boolean;
  /** Callback to toggle the showSnoozed filter */
  onToggleSnoozed?: () => void;
  /** MR id whose snooze preset menu is open (controlled by the page for the `z` shortcut) */
  snoozeMenuMrId?: number | null;
  /** Open (id) or close (null) the snooze preset menu */
  onSnoozeMenuChange?: (mrId: number | null) => void;
  /** Render rows in the compact single-line layout */
  condensed?: boolean;
  /** Called when the user pulls to refresh (touch). Awaited to keep the spinner visible until done. */
  onRefresh?: () => Promise<void> | void;
  /** Mirrors the pull-to-refresh in-flight state up, so the parent can render a page-level sync indicator. */
  onRefreshingChange?: (refreshing: boolean) => void;
  /** Search bar rendered inside the scroll container, collapsed above the fold
      until the user pulls down (small screens). */
  searchSlot?: ReactNode;
  /** Imperative handle for revealing/collapsing the searchSlot bar. */
  ref?: Ref<MRListHandle>;
}

export interface MRListHandle {
  /** Smooth-scroll the collapsed search bar into view. Does not focus it. */
  revealSearch: () => void;
  /** Collapse the search bar back above the fold. */
  hideSearch: () => void;
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
  showSnoozed = false,
  onToggleSnoozed,
  snoozeMenuMrId = null,
  onSnoozeMenuChange,
  condensed = false,
  onRefresh,
  onRefreshingChange,
  searchSlot,
  ref,
}: MRListProps) {
  const query = useMRListQuery(instanceId);
  const queryClient = useQueryClient();
  const isSmallScreen = useSmallScreen();

  const { containerRef: pullRef, pullDistance, refreshing, triggerRefresh } = usePullToRefresh<HTMLDivElement>({
    onRefresh: onRefresh ?? (() => {}),
    disabled: !onRefresh,
  });
  useManualRefreshHandler(triggerRefresh, !!onRefresh);

  const {
    containerRef: revealRef,
    searchWrapRef,
    revealSearch,
    hideSearch,
  } = useSearchReveal<HTMLDivElement>(searchSlot != null);

  useImperativeHandle(ref, () => ({ revealSearch, hideSearch }), [revealSearch, hideSearch]);

  // Both hooks observe the same scroll container: reveal watches native
  // scrolling for the collapsed search bar, pull owns the overscroll gesture.
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      const cleanupPull = pullRef(node);
      const cleanupReveal = revealRef(node);
      return () => {
        cleanupPull?.();
        cleanupReveal?.();
      };
    },
    [pullRef, revealRef],
  );

  useEffect(() => {
    onRefreshingChange?.(refreshing);
  }, [refreshing, onRefreshingChange]);

  const { snooze, unsnooze } = useSnoozeMRMutation();

  // UI-only state
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [newMrIds, setNewMrIds] = useState<Set<number>>(new Set());
  const syncingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply showApproved, then showSnoozed filters to query data
  const afterApproved = useMemo(() => {
    const data = query.data ?? [];
    return showApproved ? data : data.filter(mr => !mr.userHasApproved);
  }, [query.data, showApproved]);

  const mrs = useMemo(
    () => (showSnoozed ? afterApproved : afterApproved.filter(mr => !isSnoozed(mr))),
    [afterApproved, showSnoozed]
  );

  const totalFetched = query.data?.length ?? 0;
  const approvedCount = totalFetched - afterApproved.length;
  const snoozedCount = afterApproved.length - mrs.length;

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
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }

      if (syncingTimerRef.current) {
        clearTimeout(syncingTimerRef.current);
      }

      syncingTimerRef.current = setTimeout(() => {
        setSyncStatus('syncing');
        syncingTimerRef.current = null;
      }, SYNCING_INDICATOR_DELAY_MS);

      return;
    }

    if (syncingTimerRef.current) {
      clearTimeout(syncingTimerRef.current);
      syncingTimerRef.current = null;
    }

    if (query.isError) {
      setSyncStatus('error');
    } else {
      setSyncStatus('success');
      setLastSyncedAt(Date.now());

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      idleTimerRef.current = setTimeout(() => {
        setSyncStatus('idle');
        idleTimerRef.current = null;
      }, UPDATED_INDICATOR_DURATION_MS);
    }
  }, [query.isFetching, query.isError]);

  useEffect(() => () => {
    if (syncingTimerRef.current) {
      clearTimeout(syncingTimerRef.current);
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
  }, []);

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
      <div ref={contentRef} className={`mr-list-content${condensed ? ' mr-list-content--condensed' : ''}`}>
        {searchSlot != null && (
          <div className="mr-list-search-slot" ref={searchWrapRef}>
            {searchSlot}
          </div>
        )}
        <PullToRefreshIndicator pullDistance={pullDistance} refreshing={refreshing} />
        <div className={`mr-list-rows${searchSlot != null ? ' mr-list-rows--fill' : ''}`}>
          {mrs.length === 0 ? (
            <div className="mr-list-empty">
              <p>
                {(!showApproved && approvedCount > 0) || (!showSnoozed && snoozedCount > 0)
                  ? "You're all caught up"
                  : 'No open merge requests'}
              </p>
              <span className="mr-list-empty-hint">
                {(!showApproved && approvedCount > 0) || (!showSnoozed && snoozedCount > 0)
                  ? 'There are no merge requests waiting for your review.'
                  : isSmallScreen
                  ? 'Pull down to refresh'
                  : 'Sync with GitLab to fetch merge requests'}
              </span>
              {!showApproved && approvedCount > 0 && (
                <button className="mr-list-approved-banner" onClick={onToggleApproved}>
                  <CheckCircleIcon size={14} />
                  View {approvedCount} approved {approvedCount === 1 ? 'MR' : 'MRs'}
                </button>
              )}
              {!showSnoozed && snoozedCount > 0 && (
                <button className="mr-list-approved-banner" onClick={onToggleSnoozed}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  View {snoozedCount} snoozed {snoozedCount === 1 ? 'MR' : 'MRs'}
                </button>
              )}
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
                condensed={condensed}
                snoozeMenuOpen={snoozeMenuMrId === mr.id}
                onSnoozeMenuOpenChange={(open) => onSnoozeMenuChange?.(open ? mr.id : null)}
                onSnooze={(until) => snooze.mutate({ mrId: mr.id, until })}
                onUnsnooze={() => unsnooze.mutate({ mrId: mr.id })}
              />
            ))
          )}
          {!showApproved && approvedCount > 0 && mrs.length > 0 && (
            <button
              className="mr-list-approved-banner"
              onClick={onToggleApproved}
            >
              <CheckCircleIcon size={14} />
              {approvedCount} approved {approvedCount === 1 ? 'MR' : 'MRs'} hidden
            </button>
          )}
          {!showSnoozed && snoozedCount > 0 && mrs.length > 0 && (
            <button
              className="mr-list-approved-banner"
              onClick={onToggleSnoozed}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {snoozedCount} snoozed {snoozedCount === 1 ? 'MR' : 'MRs'} hidden
            </button>
          )}
        </div>
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
