/**
 * MR List page component.
 *
 * Main page for viewing the list of merge requests.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MRList } from '../components/MRList';
import { listInstances, type GitLabInstanceWithStatus } from '../services/gitlab';
import type { MergeRequest } from '../types';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useListSearch } from '../hooks/useListSearch';
import SearchBar from '../components/SearchBar/SearchBar';
import './MRListPage.css';

/**
 * Page for displaying the merge request list.
 */
export default function MRListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [mrs, setMrs] = useState<MergeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const mrsRef = useRef<MergeRequest[]>([]);
  const [filteredCounts, setFilteredCounts] = useState({ filtered: 0, total: 0 });

  // Keep ref in sync with state for keyboard handler
  mrsRef.current = mrs;

  // Search/filter state (items=[] because MRList filters internally)
  const {
    query,
    isSearchOpen,
    setQuery,
    closeSearch,
  } = useListSearch({ items: [] as MergeRequest[], getSearchableText: () => [] });

  // Track filtered counts from MRList
  const handleFilteredCountChange = useCallback((counts: { filtered: number; total: number }) => {
    setFilteredCounts(counts);
  }, []);

  // Load instances on mount
  useEffect(() => {
    async function loadInstances() {
      try {
        const data = await listInstances();
        setInstances(data);

        // Auto-select first instance if available
        if (data.length > 0 && !selectedInstanceId) {
          setSelectedInstanceId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to load instances:', error);
      } finally {
        setLoading(false);
      }
    }
    loadInstances();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync MRs from MRList component (for keyboard navigation)
  const handleMRsLoaded = useCallback((loadedMrs: MergeRequest[]) => {
    setMrs(loadedMrs);
  }, []);

  // Compute filtered MRs in parent for correct selection during search
  const filteredMrs = useMemo(() => {
    if (!isSearchOpen || !query?.trim()) return mrs;
    const q = query.toLowerCase();
    return mrs.filter((mr) => {
      const title = mr.title?.toLowerCase() ?? '';
      const author = mr.authorUsername?.toLowerCase() ?? '';
      const project = mr.projectName?.toLowerCase() ?? '';
      return title.includes(q) || author.includes(q) || project.includes(q);
    });
  }, [mrs, query, isSearchOpen]);

  const filteredMrsRef = useRef(filteredMrs);
  filteredMrsRef.current = filteredMrs;

  // Handle Enter to open selected MR
  const handleSelectByIndex = useCallback(
    (index: number) => {
      const list = filteredMrsRef.current;
      const mr = list[index];
      if (mr) {
        navigate(`/mrs/${mr.id}`);
      }
    },
    [navigate]
  );

  // Use filtered count for keyboard nav when search is active
  const navItemCount = isSearchOpen && query ? filteredMrs.length : mrs.length;

  // Keyboard navigation hook
  const { focusIndex, setFocusIndex, moveNext, movePrev, selectFocused } = useKeyboardNav({
    itemCount: navItemCount,
    onSelect: handleSelectByIndex,
    enabled: !loading && navItemCount > 0,
  });

  // Reset focus to first item when query changes
  useEffect(() => {
    if (isSearchOpen) {
      setFocusIndex(0);
    }
  }, [query, isSearchOpen, setFocusIndex]);

  // Reset focus to first item when returning from MR detail with Escape
  useEffect(() => {
    if ((location.state as { focusLatest?: boolean })?.focusLatest) {
      setFocusIndex(0);
      // Clear state to prevent re-triggering
      window.history.replaceState({}, '');
    }
  }, [location.state, setFocusIndex]);

  // Handle MR click from list
  const handleSelectMR = useCallback(
    (mr: MergeRequest) => {
      navigate(`/mrs/${mr.id}`);
    },
    [navigate]
  );

  // Loading state
  if (loading) {
    return (
      <div className="mr-list-page">
        <div className="mr-list-page-loading">Loading...</div>
      </div>
    );
  }

  // No instances configured
  if (instances.length === 0) {
    return (
      <div className="mr-list-page">
        <div className="mr-list-page-empty">
          <h2>No GitLab Instances Configured</h2>
          <p>Add a GitLab instance in Settings to start viewing merge requests.</p>
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
          <h1>Merge Requests</h1>
          <button
            className="refresh-button"
            onClick={() => setRefreshTrigger(t => t + 1)}
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
            filteredCount={filteredCounts.filtered}
            totalCount={filteredCounts.total}
            onArrowDown={moveNext}
            onArrowUp={movePrev}
            onSubmit={selectFocused}
          />
        )}
        {selectedInstanceId != null ? (
          <MRList
            instanceId={selectedInstanceId}
            onSelect={handleSelectMR}
            focusIndex={focusIndex}
            onFocusChange={setFocusIndex}
            onMRsLoaded={handleMRsLoaded}
            refreshTrigger={refreshTrigger}
            filterQuery={isSearchOpen ? query : undefined}
            onFilteredCountChange={handleFilteredCountChange}
          />
        ) : null}
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
