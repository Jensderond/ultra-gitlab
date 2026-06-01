/**
 * My MRs page component.
 *
 * Displays merge requests authored by the authenticated user.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useHotkey, parseHotkey } from '@tanstack/react-hotkeys';
import MRListItem from '../components/MRList/MRListItem';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useListSearch } from '../hooks/useListSearch';
import { useCondensedModeAnnouncement } from '../hooks/useCondensedModeAnnouncement';
import SearchBar from '../components/SearchBar/SearchBar';
import type { MergeRequest } from '../types';
import { useInstancesQuery } from '../hooks/queries/useInstancesQuery';
import { useSettingsQuery } from '../hooks/queries/useSettingsQuery';
import { InstanceSwitcher } from '../components/InstanceSwitcher';
import { useMyMRListQuery } from '../hooks/queries/useMyMRListQuery';
import { queryKeys } from '../lib/queryKeys';
import { updateShowRecentlyMergedMrs, updateShowDraftMrs } from '../services';
import { useShortcuts } from '../components/ShortcutsProvider';
import { ShortcutBar } from '../components/ShortcutBar';
import type { ShortcutDef } from '../components/ShortcutBar';
import { PageHeader } from '../components/PageHeader';
import './MRListPage.css';
import './MyMRsPage.css';

const defaultShortcuts: ShortcutDef[] = [
  { key: 'j/k', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: 'm', label: 'recently merged' },
  { key: 'd', label: 'drafts' },
  { key: '\u2318F', label: 'search' },
  { key: '?', label: 'help' },
];

const searchShortcuts: ShortcutDef[] = [
  { key: '\u2191/\u2193', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: 'Esc', label: 'close search' },
];

/**
 * Format approval summary (e.g. "2/3 approved").
 */
function approvalSummary(mr: MergeRequest): string {
  const count = mr.approvalsCount ?? 0;
  const required = mr.approvalsRequired ?? 0;
  if (required === 0) return '';
  return `${count}/${required}`;
}

/**
 * Check if an MR is a draft/WIP.
 */
function isDraft(mr: MergeRequest): boolean {
  return mr.title.startsWith('Draft:') || mr.title.startsWith('WIP:');
}

/**
 * Check if an MR has enough approvals.
 */
function isFullyApproved(mr: MergeRequest): boolean {
  return mr.approvalStatus === 'approved';
}

/**
 * Format a Unix timestamp as a short relative time (e.g. "2h ago").
 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() / 1000 - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function MyMRsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];
  const settingsQuery = useSettingsQuery();
  const condensed = settingsQuery.data?.mrListCondensed ?? false;
  const showRecentlyMerged = settingsQuery.data?.showRecentlyMergedMrs ?? false;
  const showDrafts = settingsQuery.data?.showDraftMrs ?? true;
  useCondensedModeAnnouncement();
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const mrsRef = useRef<MergeRequest[]>([]);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const handleToggleRecentlyMerged = useCallback(async () => {
    const next = !showRecentlyMerged;
    await updateShowRecentlyMergedMrs(next);
    queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
  }, [showRecentlyMerged, queryClient]);

  const handleToggleDrafts = useCallback(async () => {
    const next = !showDrafts;
    await updateShowDraftMrs(next);
    queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
  }, [showDrafts, queryClient]);

  const { getKey } = useShortcuts();
  useHotkey(parseHotkey(getKey('toggle-recently-merged') ?? 'm'), () => {
    handleToggleRecentlyMerged();
  });
  useHotkey(parseHotkey(getKey('toggle-drafts') ?? 'd'), () => {
    handleToggleDrafts();
  });

  // Auto-select default or first instance when instances load
  useEffect(() => {
    if (instances.length > 0 && !selectedInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  const myMRsQuery = useMyMRListQuery(selectedInstanceId ?? undefined, showRecentlyMerged, showDrafts);
  const mrs = myMRsQuery.data ?? [];
  const loading = myMRsQuery.isLoading;

  // Search/filter state — filters mrs at the page level
  const {
    query,
    isSearchOpen,
    setQuery,
    closeSearch,
    filteredItems,
    filteredCount,
    totalCount,
  } = useListSearch({
    items: mrs,
    getSearchableText: (mr: MergeRequest) => [mr.title, mr.authorUsername, mr.projectName],
  });

  mrsRef.current = filteredItems;

  // Handle Enter to open selected MR
  const handleSelectByIndex = useCallback(
    (index: number) => {
      const mr = mrsRef.current[index];
      if (mr) navigate(`/my-mrs/${mr.id}`);
    },
    [navigate]
  );

  const { focusIndex, setFocusIndex, moveNext, movePrev, selectFocused } = useKeyboardNav({
    itemCount: filteredItems.length,
    onSelect: handleSelectByIndex,
    enabled: !loading && filteredItems.length > 0,
  });

  // Reset focus to first item when query changes
  useEffect(() => {
    if (isSearchOpen) {
      setFocusIndex(0);
    }
  }, [query, isSearchOpen, setFocusIndex]);

  // Keep the focused row visible when navigating with j/k.
  useEffect(() => {
    const el = itemRefs.current.get(focusIndex);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  const handleSelectMR = useCallback(
    (mr: MergeRequest, index: number) => {
      setFocusIndex(index);
      navigate(`/my-mrs/${mr.id}`);
    },
    [navigate, setFocusIndex]
  );

  if (instancesQuery.isLoading && instances.length === 0) {
    return (
      <div className="mr-list-page">
        <div className="mr-list-page-loading">Loading...</div>
      </div>
    );
  }

  if (myMRsQuery.isError && mrs.length === 0) {
    const errMsg = myMRsQuery.error instanceof Error ? myMRsQuery.error.message : 'Failed to load merge requests';
    return (
      <div className="mr-list-page">
        <div className="mr-list-page-empty">
          <h2>Failed to Load</h2>
          <p>{errMsg}</p>
          <button onClick={() => myMRsQuery.refetch()} className="primary-button">Retry</button>
        </div>
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="mr-list-page">
        <div className="mr-list-page-empty">
          <h2>No GitLab Instances Configured</h2>
          <p>Add a GitLab instance in Settings to see your MRs.</p>
          <button onClick={() => navigate('/settings')} className="primary-button">
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-list-page">
      <PageHeader
        title="My Merge Requests"
        onRefresh={() => selectedInstanceId != null && queryClient.invalidateQueries({ queryKey: queryKeys.myMRList(String(selectedInstanceId)) })}
        refreshAriaLabel="Refresh merge requests"
        actions={
          <>
            <button
              type="button"
              className={`recently-merged-toggle ${showDrafts ? 'is-on' : ''}`}
              onClick={handleToggleDrafts}
              role="switch"
              aria-checked={showDrafts}
              title={showDrafts ? 'Hide your draft MRs' : 'Show your draft MRs'}
            >
              <span className="recently-merged-toggle-dot" aria-hidden="true" />
              <span className="recently-merged-toggle-label">Drafts</span>
            </button>
            <button
              type="button"
              className={`recently-merged-toggle ${showRecentlyMerged ? 'is-on' : ''}`}
              onClick={handleToggleRecentlyMerged}
              role="switch"
              aria-checked={showRecentlyMerged}
              title={showRecentlyMerged ? 'Hide recently merged MRs' : 'Show MRs merged in the last 24h'}
            >
              <span className="recently-merged-toggle-dot" aria-hidden="true" />
              <span className="recently-merged-toggle-label">Recently merged</span>
            </button>
            <InstanceSwitcher
              instances={instances}
              selectedId={selectedInstanceId}
              onSelect={setSelectedInstanceId}
            />
          </>
        }
      />

      <main className="mr-list-page-content">
        {isSearchOpen && (
          <SearchBar
            query={query}
            onQueryChange={setQuery}
            onClose={closeSearch}
            filteredCount={filteredCount}
            totalCount={totalCount}
            onArrowDown={moveNext}
            onArrowUp={movePrev}
            onSubmit={selectFocused}
          />
        )}
        {loading ? (
          <div className="mr-list-loading">Loading your merge requests...</div>
        ) : mrs.length === 0 ? (
          <div className="mr-list-page-empty">
            <h2>No Authored MRs</h2>
            <p>You don't have any open merge requests at the moment.</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="mr-list-page-empty">
            <p>No merge requests match your search</p>
          </div>
        ) : (
          <div className="mr-list">
            <div className={`mr-list-content${condensed ? ' mr-list-content--condensed' : ''}`}>
              {filteredItems.map((mr, index) => {
                const merged = mr.state === 'merged';
                return (
                  <div
                    key={mr.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(index, el);
                      else itemRefs.current.delete(index);
                    }}
                    className={['my-mr-item-wrapper', condensed && 'my-mr-item-wrapper--condensed', isDraft(mr) && 'is-draft', isFullyApproved(mr) && 'is-approved', merged && 'is-merged'].filter(Boolean).join(' ')}
                  >
                    <MRListItem
                      mr={mr}
                      selected={index === focusIndex}
                      onClick={() => handleSelectMR(mr, index)}
                      highlightQuery={isSearchOpen ? query : undefined}
                      condensed={condensed}
                    />
                    {merged ? (
                      <span className="my-mr-merged-badge" title={mr.mergedAt ? `Merged ${formatRelativeTime(mr.mergedAt)}` : 'Merged'}>
                        Merged{mr.mergedAt ? ` ${formatRelativeTime(mr.mergedAt)}` : ''}
                      </span>
                    ) : (
                      (mr.approvalsRequired ?? 0) > 0 && (
                        <span className="my-mr-approval-badge">
                          {approvalSummary(mr)}
                        </span>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mr-list-footer">
              <span className="mr-count">{mrs.length} merge requests</span>
            </div>
          </div>
        )}
      </main>

      <footer className="mr-list-page-footer">
        <ShortcutBar shortcuts={isSearchOpen ? searchShortcuts : defaultShortcuts} variant="list" />
      </footer>
    </div>
  );
}
