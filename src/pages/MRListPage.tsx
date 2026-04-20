/**
 * MR List page component.
 *
 * Main page for viewing the list of merge requests.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MRList } from '../components/MRList';
import type { MergeRequest } from '../types';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useListSearch } from '../hooks/useListSearch';
import SearchBar from '../components/SearchBar/SearchBar';
import { useInstancesQuery } from '../hooks/queries/useInstancesQuery';
import { InstanceSwitcher } from '../components/InstanceSwitcher';
import { queryKeys } from '../lib/queryKeys';
import { ShortcutBar } from '../components/ShortcutBar';
import type { ShortcutDef } from '../components/ShortcutBar';
import { PageHeader } from '../components/PageHeader';
import './MRListPage.css';

const defaultShortcuts: ShortcutDef[] = [
  { key: 'j/k', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: '⌘F', label: 'search' },
  { key: '?', label: 'help' },
];

const searchShortcuts: ShortcutDef[] = [
  { key: '↑/↓', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: 'Esc', label: 'close search' },
];

/**
 * Page for displaying the merge request list.
 */
export default function MRListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];
  const loading = instancesQuery.isLoading;
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [mrs, setMrs] = useState<MergeRequest[]>([]);
  const [showApproved, setShowApproved] = useState(false);

  // Shift+H toggles approved MR visibility
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (e.shiftKey && e.key === 'H') {
        e.preventDefault();
        setShowApproved(v => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
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

  // Auto-select first instance when instances load
  useEffect(() => {
    if (instances.length > 0 && !selectedInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

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
      <PageHeader
        title="Merge Requests"
        onRefresh={() => selectedInstanceId != null && queryClient.invalidateQueries({ queryKey: queryKeys.mrList(String(selectedInstanceId)) })}
        refreshAriaLabel="Refresh merge requests"
        actions={
          <>
            <InstanceSwitcher
              instances={instances}
              selectedId={selectedInstanceId}
              onSelect={setSelectedInstanceId}
            />
            <div className="approved-toggle-wrapper">
              <button
                className={`approved-toggle-button${showApproved ? ' approved-toggle-button--active' : ''}`}
                onClick={() => setShowApproved(v => !v)}
                aria-label={showApproved ? 'Hide approved merge requests' : 'Show approved merge requests'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span className="approved-toggle-popover">
                  <span className="approved-toggle-popover-shortcut"><kbd>Shift</kbd>+<kbd>H</kbd></span>
                  <span>{showApproved ? 'Hide approved' : 'Show approved'}</span>
                </span>
              </button>
            </div>
          </>
        }
      />

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
            filterQuery={isSearchOpen ? query : undefined}
            onFilteredCountChange={handleFilteredCountChange}
            showApproved={showApproved}
            onToggleApproved={() => setShowApproved(v => !v)}
          />
        ) : null}
      </main>

      <footer className="mr-list-page-footer">
        <ShortcutBar shortcuts={isSearchOpen ? searchShortcuts : defaultShortcuts} variant="list" />
      </footer>
    </div>
  );
}
