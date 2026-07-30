/**
 * MR List page component.
 *
 * Main page for viewing the list of merge requests.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useHotkey, parseHotkey } from '@tanstack/react-hotkeys';
import { MRList } from '../components/MRList';
import type { MRListHandle, MrTab, MrTabCounts } from '../components/MRList';
import type { MergeRequest } from '../types';
import { useSmallScreen } from '../hooks/useSmallScreen';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
import { useShortcuts } from '../components/ShortcutsProvider';
import { projectSearchText } from '../lib/projectName';
import { useListSearch } from '../hooks/useListSearch';
import { useCondensedModeAnnouncement } from '../hooks/useCondensedModeAnnouncement';
import SearchBar from '../components/SearchBar/SearchBar';
import { useInstancesQuery } from '../hooks/queries/useInstancesQuery';
import { useSettingsQuery } from '../hooks/queries/useSettingsQuery';
import { InstanceSwitcher } from '../components/InstanceSwitcher';
import { manualSyncAndWait } from '../services/storage';
import { ShortcutBar } from '../components/ShortcutBar';
import type { ShortcutDef } from '../components/ShortcutBar';
import { PageHeader } from '../components/PageHeader';
import { SearchIcon } from '../components/icons';
import './MRListPage.css';

const defaultShortcuts: ShortcutDef[] = [
  { key: 'j/k', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: '⌃⌥←/→', label: 'tabs' },
  { key: '⌘F', label: 'search' },
  { key: '?', label: 'help' },
];

const searchShortcuts: ShortcutDef[] = [
  { key: '↑/↓', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: 'Esc', label: 'close search' },
];

/** The status tabs, in display order, mapped to their count field. */
const STATUS_TABS: { id: MrTab; label: string; countKey: keyof MrTabCounts }[] = [
  { id: 'needs-review', label: 'Needs review', countKey: 'needsReview' },
  { id: 'approved', label: 'Approved', countKey: 'approved' },
  { id: 'snoozed', label: 'Snoozed', countKey: 'snoozed' },
];

const DEFAULT_TAB: MrTab = 'needs-review';

/** Read the tab out of `?tab=`, falling back to the default for junk values. */
function parseTab(value: string | null): MrTab {
  const match = STATUS_TABS.find((tab) => tab.id === value);
  return match ? match.id : DEFAULT_TAB;
}

/** Step `delta` places along the tab strip, wrapping at either end. */
function stepTab(current: MrTab, delta: number): MrTab {
  const index = STATUS_TABS.findIndex((tab) => tab.id === current);
  const count = STATUS_TABS.length;
  return STATUS_TABS[(index + delta + count) % count].id;
}

/**
 * Page for displaying the merge request list.
 */
export default function MRListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];
  const loading = instancesQuery.isLoading;
  const settingsQuery = useSettingsQuery();
  const condensed = settingsQuery.data?.mrListCondensed ?? false;
  useCondensedModeAnnouncement();
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [mrs, setMrs] = useState<MergeRequest[]>([]);
  // The active tab lives in the URL, not in React state, so that *any* way back
  // to this page restores it — including a history POP, which is what the iOS
  // edge-swipe-back gesture fires and which cannot carry `navigate()` state.
  const activeTab = parseTab(searchParams.get('tab'));
  const [tabCounts, setTabCounts] = useState<MrTabCounts>({ needsReview: 0, approved: 0, snoozed: 0 });
  const [syncing, setSyncing] = useState(false);
  const isSmallScreen = useSmallScreen();
  const mrListRef = useRef<MRListHandle>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  // Only opened by swipe-left on touch; there is no snooze button in the rows.
  const [snoozeMenuMrId, setSnoozeMenuMrId] = useState<number | null>(null);

  // Lets the setter below resolve updater functions (`t => ...`) without
  // depending on the current tab, so it stays stable across tab switches.
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // Switching tabs replaces the current history entry rather than pushing one:
  // the tab is a view of this page, not a place of its own, so back should still
  // leave the list instead of walking through the tabs you visited.
  const setActiveTab = useCallback(
    (next: MrTab | ((prev: MrTab) => MrTab)) => {
      const tab = typeof next === 'function' ? next(activeTabRef.current) : next;
      navigate(tab === DEFAULT_TAB ? '/mrs' : `/mrs?tab=${tab}`, { replace: true });
    },
    [navigate],
  );

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

  // A live filter spans every status, so the tabs stop filtering and become a
  // read-only breakdown of where the matches are. Touch screens keep the bar
  // revealed without an "open" flag, so a non-empty query is the only signal.
  const filtering = (isSmallScreen || isSearchOpen) && query.trim().length > 0;

  // Track filtered counts from MRList
  const handleFilteredCountChange = useCallback((counts: { filtered: number; total: number }) => {
    setFilteredCounts(counts);
  }, []);

  // On small screens the search bar lives collapsed inside the list; the
  // header button reveals it AND focuses it (the only path that may open the
  // keyboard — pull-revealing never focuses). Focus goes first, inside the tap
  // gesture, so iOS actually opens the keyboard; preventScroll keeps the
  // browser from jump-cutting past the smooth reveal.
  const handleHeaderSearch = useCallback(() => {
    mobileSearchInputRef.current?.focus({ preventScroll: true });
    mrListRef.current?.revealSearch();
  }, []);

  const closeMobileSearch = useCallback(() => {
    setQuery('');
    mobileSearchInputRef.current?.blur();
    mrListRef.current?.hideSearch();
  }, [setQuery]);

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
    if (!filtering) return mrs;
    const q = query.toLowerCase();
    return mrs.filter((mr) => {
      const title = mr.title?.toLowerCase() ?? '';
      const author = mr.authorUsername?.toLowerCase() ?? '';
      const project = projectSearchText(mr.projectName).toLowerCase();
      return title.includes(q) || author.includes(q) || project.includes(q);
    });
  }, [mrs, query, filtering]);

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
  const navItemCount = filtering ? filteredMrs.length : mrs.length;

  // Keyboard navigation hook
  const { focusIndex, setFocusIndex, moveNext, movePrev, selectFocused } = useKeyboardNav({
    itemCount: navItemCount,
    onSelect: handleSelectByIndex,
    enabled: !loading && navItemCount > 0,
  });

  // Snooze shortcuts: `z` snoozes (or unsnoozes) the focused MR,
  // `Shift+Z` toggles snoozed visibility.
  const { getKey } = useShortcuts();
  useHotkey(parseHotkey(getKey('toggle-snoozed') ?? 'Shift+Z'), () => {
    setActiveTab(t => (t === 'snoozed' ? 'needs-review' : 'snoozed'));
  });

  // ⌃⌥←/→ walks the status tabs tmux-style, wrapping at both ends. Disabled
  // while filtering: the strip is a read-only match breakdown then, so stepping
  // would move `?tab=` with nothing on screen reading as active. Note the
  // absence of `ignoreInputs: false` — unlike its neighbours, this binding must
  // stay out of text fields, where ⌥← is macOS word-jump.
  useHotkey(parseHotkey(getKey('prev-tab') ?? 'Control+Alt+ArrowLeft'), () => {
    setActiveTab(t => stepTab(t, -1));
  }, { enabled: !filtering });
  useHotkey(parseHotkey(getKey('next-tab') ?? 'Control+Alt+ArrowRight'), () => {
    setActiveTab(t => stepTab(t, 1));
  }, { enabled: !filtering });
  // Reset focus to first item when query changes
  useEffect(() => {
    if (isSearchOpen) {
      setFocusIndex(0);
    }
  }, [query, isSearchOpen, setFocusIndex]);

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
          <button onClick={() => navigate('/settings', { replace: true })} className="primary-button">
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-list-page">
      <PageHeader title="Merge Requests" refreshing={syncing} />

      <div className="mr-status-bar">
        <nav
          className={`mr-tabs${filtering ? ' mr-tabs--filtering' : ''}`}
          role="tablist"
          aria-label={filtering ? 'Matches per status' : 'Merge request status'}
        >
          {STATUS_TABS.map((tab) => {
            const active = activeTab === tab.id;
            const count = tabCounts[tab.countKey];
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={filtering}
                title={filtering ? `${count} matching ${tab.label.toLowerCase()}` : undefined}
                className={`mr-tab${active && !filtering ? ' mr-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                <span
                  className={`mr-tab-count${filtering && count > 0 ? ' mr-tab-count--match' : ''}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="mr-status-bar-controls">
          {/* Touch only — on pointer screens ⌘F is the way in, advertised by
              the shortcut bar at the foot of the page. */}
          {isSmallScreen && (
            <button
              type="button"
              className="header-search-button"
              onClick={handleHeaderSearch}
              aria-label="Search merge requests"
            >
              <SearchIcon size={16} />
            </button>
          )}
          <InstanceSwitcher
            instances={instances}
            selectedId={selectedInstanceId}
            onSelect={setSelectedInstanceId}
          />
        </div>
      </div>

      <main className="mr-list-page-content" data-tour="mr-list">
        {!isSmallScreen && isSearchOpen && (
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
            ref={mrListRef}
            instanceId={selectedInstanceId}
            onSelect={handleSelectMR}
            focusIndex={focusIndex}
            onFocusChange={setFocusIndex}
            onMRsLoaded={handleMRsLoaded}
            filterQuery={isSmallScreen ? query : isSearchOpen ? query : undefined}
            onFilteredCountChange={handleFilteredCountChange}
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            onCountsChange={setTabCounts}
            snoozeMenuMrId={snoozeMenuMrId}
            onSnoozeMenuChange={setSnoozeMenuMrId}
            condensed={condensed}
            onRefresh={() => manualSyncAndWait(true)}
            onRefreshingChange={setSyncing}
            searchSlot={
              isSmallScreen ? (
                <SearchBar
                  query={query}
                  onQueryChange={setQuery}
                  onClose={closeMobileSearch}
                  filteredCount={filteredCounts.filtered}
                  totalCount={filteredCounts.total}
                  autoFocus={false}
                  inputRef={mobileSearchInputRef}
                />
              ) : undefined
            }
          />
        ) : null}
      </main>

      <footer className="mr-list-page-footer">
        <ShortcutBar shortcuts={isSearchOpen ? searchShortcuts : defaultShortcuts} variant="list" />
      </footer>
    </div>
  );
}
