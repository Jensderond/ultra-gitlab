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
import { projectSearchText } from '../../lib/projectName';
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

/** The three mutually-exclusive status views a merge request can fall into. */
export type MrTab = 'needs-review' | 'approved' | 'snoozed';

export interface MrTabCounts {
  needsReview: number;
  approved: number;
  snoozed: number;
}

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
  /** Which status tab is active — selects which category of MRs to display. */
  activeTab?: MrTab;
  /** Switch the active status tab (used by the empty-state shortcut buttons). */
  onSelectTab?: (tab: MrTab) => void;
  /** Reports the per-category counts so the page can render the tab badges. */
  onCountsChange?: (counts: MrTabCounts) => void;
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
  activeTab = 'needs-review',
  onSelectTab,
  onCountsChange,
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

  // Partition the fetched MRs into the three mutually-exclusive status
  // categories. Approval wins over snooze: an approved MR is never counted
  // as snoozed (snoozing is hidden on approved MRs anyway).
  const categories = useMemo(() => {
    const data = query.data ?? [];
    const needsReview: MergeRequest[] = [];
    const approved: MergeRequest[] = [];
    const snoozed: MergeRequest[] = [];
    for (const mr of data) {
      if (mr.userHasApproved) approved.push(mr);
      else if (isSnoozed(mr)) snoozed.push(mr);
      else needsReview.push(mr);
    }
    return { needsReview, approved, snoozed };
  }, [query.data]);

  const mrs =
    activeTab === 'approved'
      ? categories.approved
      : activeTab === 'snoozed'
        ? categories.snoozed
        : categories.needsReview;

  const approvedCount = categories.approved.length;
  const snoozedCount = categories.snoozed.length;

  const q = filterQuery?.trim().toLowerCase() ?? '';
  const filtering = q.length > 0;

  const matchesQuery = useCallback(
    (mr: MergeRequest) => {
      if (!q) return true;
      const title = mr.title?.toLowerCase() ?? '';
      const author = mr.authorUsername?.toLowerCase() ?? '';
      const project = projectSearchText(mr.projectName).toLowerCase();
      return title.includes(q) || author.includes(q) || project.includes(q);
    },
    [q],
  );

  // Filtering suspends the tab selection and searches every status at once —
  // a match sitting one tab over is exactly what the filter is meant to
  // surface, not hide. Order stays needs review → approved → snoozed.
  const scope = useMemo(
    () =>
      filtering
        ? [...categories.needsReview, ...categories.approved, ...categories.snoozed]
        : mrs,
    [filtering, categories, mrs],
  );

  const filteredMrs = useMemo(() => scope.filter(matchesQuery), [scope, matchesQuery]);

  // Surface the counts the status tabs are labelled with. While filtering they
  // become per-tab match counts, so the tabs read as a breakdown of where the
  // results live rather than as a filter that's being ignored.
  const tabCounts = useMemo(
    () => ({
      needsReview: filtering
        ? categories.needsReview.filter(matchesQuery).length
        : categories.needsReview.length,
      approved: filtering
        ? categories.approved.filter(matchesQuery).length
        : categories.approved.length,
      snoozed: filtering
        ? categories.snoozed.filter(matchesQuery).length
        : categories.snoozed.length,
    }),
    [filtering, categories, matchesQuery],
  );

  useEffect(() => {
    onCountsChange?.(tabCounts);
  }, [tabCounts, onCountsChange]);

  // Report filtered counts to parent
  useEffect(() => {
    onFilteredCountChange?.({ filtered: filteredMrs.length, total: scope.length });
  }, [filteredMrs.length, scope.length, onFilteredCountChange]);

  // Notify parent when MRs change. Sends the search scope, not the tab, so the
  // page's keyboard navigation walks the same rows the list renders.
  useEffect(() => {
    onMRsLoaded?.(scope);
  }, [scope, onMRsLoaded]);

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
  if (query.isLoading && scope.length === 0) {
    return (
      <div className="mr-list-loading">
        <span>Loading merge requests...</span>
      </div>
    );
  }

  // Render error state
  if (error && scope.length === 0) {
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
          {scope.length === 0 ? (
            <EmptyState
              activeTab={activeTab}
              approvedCount={approvedCount}
              snoozedCount={snoozedCount}
              isSmallScreen={isSmallScreen}
              onSelectTab={onSelectTab}
            />
          ) : filteredMrs.length === 0 ? (
            <div className="mr-list-empty">
              <p>No merge requests match “{filterQuery}”</p>
              <p className="mr-list-empty-hint">
                Searched needs review, approved, and snoozed.
              </p>
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

interface EmptyStateProps {
  activeTab: MrTab;
  approvedCount: number;
  snoozedCount: number;
  isSmallScreen: boolean;
  onSelectTab?: (tab: MrTab) => void;
}

/**
 * The list's empty state, phrased per active tab. On "Needs review" it becomes
 * a caught-up message with shortcuts into whichever other tabs still hold work.
 */
function EmptyState({ activeTab, approvedCount, snoozedCount, isSmallScreen, onSelectTab }: EmptyStateProps) {
  if (activeTab === 'approved') {
    return (
      <div className="mr-list-empty">
        <p>No approved merge requests</p>
        <span className="mr-list-empty-hint">Merge requests you've approved will show up here.</span>
      </div>
    );
  }

  if (activeTab === 'snoozed') {
    return (
      <div className="mr-list-empty">
        <p>Nothing snoozed</p>
        <span className="mr-list-empty-hint">Snooze a merge request to set it aside and check back later.</span>
      </div>
    );
  }

  const hasElsewhere = approvedCount > 0 || snoozedCount > 0;

  if (!hasElsewhere) {
    return (
      <div className="mr-list-empty">
        <p>No open merge requests</p>
        <span className="mr-list-empty-hint">
          {isSmallScreen ? 'Pull down to refresh' : 'Sync with GitLab to fetch merge requests'}
        </span>
      </div>
    );
  }

  return (
    <div className="mr-list-empty">
      <span className="mr-list-empty-icon">
        <CheckCircleIcon size={40} />
      </span>
      <p>You're all caught up</p>
      <span className="mr-list-empty-hint">No merge requests currently need your review.</span>
      <div className="mr-list-empty-actions">
        {approvedCount > 0 && (
          <button className="mr-list-empty-button" onClick={() => onSelectTab?.('approved')}>
            View approved
          </button>
        )}
        {snoozedCount > 0 && (
          <button className="mr-list-empty-button" onClick={() => onSelectTab?.('snoozed')}>
            Review snoozed
          </button>
        )}
      </div>
    </div>
  );
}
