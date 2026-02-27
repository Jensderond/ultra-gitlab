/**
 * My MRs page component.
 *
 * Displays merge requests authored by the authenticated user.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tauriListen } from '../services/transport';
import { listInstances, type GitLabInstanceWithStatus } from '../services/gitlab';
import { listMyMergeRequests } from '../services/tauri';
import MRListItem from '../components/MRList/MRListItem';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useListSearch } from '../hooks/useListSearch';
import SearchBar from '../components/SearchBar/SearchBar';
import type { MergeRequest } from '../types';
import './MRListPage.css';
import './MyMRsPage.css';

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
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [mrs, setMrs] = useState<MergeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const mrsRef = useRef<MergeRequest[]>([]);

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

  // Load instances
  useEffect(() => {
    async function loadInstances() {
      try {
        const data = await listInstances();
        setInstances(data);
        if (data.length > 0 && !selectedInstanceId) {
          setSelectedInstanceId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to load instances:', error);
      }
    }
    loadInstances();
  }, [selectedInstanceId]);

  // Load authored MRs
  const loadMRs = useCallback(async () => {
    if (!selectedInstanceId) return;
    try {
      setLoading(true);
      const data = await listMyMergeRequests(selectedInstanceId);
      setMrs(data);
    } catch (error) {
      console.error('Failed to load my MRs:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedInstanceId]);

  useEffect(() => {
    loadMRs();
  }, [loadMRs]);

  // Re-fetch on mr-updated events
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | undefined;

    tauriListen<{ mr_id: number }>('mr-updated', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => loadMRs(), 500);
    }).then((fn) => { unlisten = fn; });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unlisten?.();
    };
  }, [loadMRs]);

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

  if (loading && instances.length === 0) {
    return (
      <div className="mr-list-page">
        <div className="mr-list-page-loading">Loading...</div>
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
            onClick={() => loadMRs()}
            aria-label="Refresh merge requests"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
        {instances.length > 1 && (
          <select
            value={selectedInstanceId ?? ''}
            onChange={(e) => setSelectedInstanceId(Number(e.target.value))}
            className="instance-selector"
          >
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name || instance.url}
              </option>
            ))}
          </select>
        )}
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
        <span className="keyboard-hint">
          {isSearchOpen ? (
            <>
              <kbd>&uarr;</kbd>/<kbd>&darr;</kbd> navigate &middot;{' '}
              <kbd>Enter</kbd> open &middot;{' '}
              <kbd>Esc</kbd> close search
            </>
          ) : (
            <>
              <kbd>j</kbd>/<kbd>k</kbd> navigate &middot;{' '}
              <kbd>Enter</kbd> open &middot;{' '}
              <kbd>⌘F</kbd> search &middot;{' '}
              <kbd>?</kbd> help
            </>
          )}
        </span>
      </footer>
    </div>
  );
}
