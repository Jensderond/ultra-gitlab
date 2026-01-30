/**
 * Merge request list container component.
 *
 * Displays a list of merge requests with filtering and selection.
 */

import { useState, useEffect, useCallback } from 'react';
import { listMergeRequests } from '../../services/gitlab';
import type { MergeRequest, MRFilter } from '../../types';
import MRListItem from './MRListItem';
import './MRList.css';

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
}

type FilterState = 'opened' | 'merged' | 'closed' | 'all';
type FilterScope = 'authored' | 'reviewing' | 'all';

/**
 * Merge request list component with filtering.
 */
export default function MRList({
  instanceId,
  selectedMrId,
  onSelect,
  focusIndex = 0,
  onFocusChange,
}: MRListProps) {
  const [mrs, setMrs] = useState<MergeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<FilterState>('opened');
  const [scopeFilter, setScopeFilter] = useState<FilterScope>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load merge requests
  const loadMRs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const filter: MRFilter = {};
      if (stateFilter !== 'all') {
        filter.state = stateFilter;
      }
      if (scopeFilter !== 'all') {
        filter.scope = scopeFilter;
      }
      if (searchQuery.trim()) {
        filter.search = searchQuery.trim();
      }

      const data = await listMergeRequests(instanceId, filter);
      setMrs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load merge requests');
    } finally {
      setLoading(false);
    }
  }, [instanceId, stateFilter, scopeFilter, searchQuery]);

  useEffect(() => {
    loadMRs();
  }, [loadMRs]);

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
        <button onClick={loadMRs}>Retry</button>
      </div>
    );
  }

  return (
    <div className="mr-list">
      <div className="mr-list-filters">
        <div className="filter-group">
          <label htmlFor="state-filter">State:</label>
          <select
            id="state-filter"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as FilterState)}
          >
            <option value="opened">Open</option>
            <option value="merged">Merged</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="scope-filter">Scope:</label>
          <select
            id="scope-filter"
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as FilterScope)}
          >
            <option value="all">All</option>
            <option value="authored">Authored by me</option>
            <option value="reviewing">Assigned to me</option>
          </select>
        </div>

        <div className="filter-group search-group">
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {loading && <div className="mr-list-loading-overlay">Updating...</div>}

      <div className="mr-list-content">
        {mrs.length === 0 ? (
          <div className="mr-list-empty">
            <p>No merge requests found</p>
            <span className="mr-list-empty-hint">
              {stateFilter !== 'all' || scopeFilter !== 'all' || searchQuery
                ? 'Try adjusting your filters'
                : 'Sync with GitLab to fetch merge requests'}
            </span>
          </div>
        ) : (
          mrs.map((mr, index) => (
            <MRListItem
              key={mr.id}
              mr={mr}
              selected={mr.id === selectedMrId || index === focusIndex}
              onClick={() => handleSelect(mr, index)}
            />
          ))
        )}
      </div>

      <div className="mr-list-footer">
        <span className="mr-count">{mrs.length} merge requests</span>
      </div>
    </div>
  );
}
