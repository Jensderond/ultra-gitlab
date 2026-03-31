/**
 * My MRs page component.
 *
 * Displays merge requests authored by the authenticated user.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import MRListItem from '../components/MRList/MRListItem';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useListSearch } from '../hooks/useListSearch';
import SearchBar from '../components/SearchBar/SearchBar';
import type { MergeRequest } from '../types';
import { useInstancesQuery } from '../hooks/queries/useInstancesQuery';
import { InstanceSwitcher } from '../components/InstanceSwitcher';
import { useMyMRListQuery } from '../hooks/queries/useMyMRListQuery';
import { queryKeys } from '../lib/queryKeys';
import { ShortcutBar } from '../components/ShortcutBar';
import type { ShortcutDef } from '../components/ShortcutBar';
import './MRListPage.css';
import './MyMRsPage.css';

const defaultShortcuts: ShortcutDef[] = [
  { key: 'j/k', label: 'navigate' },
  { key: 'Enter', label: 'open' },
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

export default function MyMRsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const mrsRef = useRef<MergeRequest[]>([]);

  // Auto-select default or first instance when instances load
  useEffect(() => {
    if (instances.length > 0 && !selectedInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  const myMRsQuery = useMyMRListQuery(selectedInstanceId ?? undefined);
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
      <header className="mr-list-page-header">
        <div className="header-title-group">
          <h1>My Merge Requests</h1>
          <button
            className="refresh-button"
            onClick={() => selectedInstanceId != null && queryClient.invalidateQueries({ queryKey: queryKeys.myMRList(String(selectedInstanceId)) })}
            aria-label="Refresh merge requests"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
        <InstanceSwitcher
          instances={instances}
          selectedId={selectedInstanceId}
          onSelect={setSelectedInstanceId}
        />
      </header>

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
            <div className="mr-list-content">
              {filteredItems.map((mr, index) => (
                <div
                  key={mr.id}
                  className={['my-mr-item-wrapper', isDraft(mr) && 'is-draft', isFullyApproved(mr) && 'is-approved'].filter(Boolean).join(' ')}
                >
                  <MRListItem
                    mr={mr}
                    selected={index === focusIndex}
                    onClick={() => handleSelectMR(mr, index)}
                    highlightQuery={isSearchOpen ? query : undefined}
                  />
                  {(mr.approvalsRequired ?? 0) > 0 && (
                    <span className="my-mr-approval-badge">
                      {approvalSummary(mr)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mr-list-footer">
              <span className="mr-count">{mrs.length} merge requests</span>
            </div>
          </div>
        )}
      </main>

      <footer className="mr-list-page-footer">
        <ShortcutBar shortcuts={isSearchOpen ? searchShortcuts : defaultShortcuts} />
      </footer>
    </div>
  );
}
