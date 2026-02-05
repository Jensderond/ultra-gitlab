/**
 * MR List page component.
 *
 * Main page for viewing the list of merge requests.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MRList } from '../components/MRList';
import { listInstances, type GitLabInstanceWithStatus } from '../services/gitlab';
import type { MergeRequest } from '../types';
import { useKeyboardNav } from '../hooks/useKeyboardNav';
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
  const mrsRef = useRef<MergeRequest[]>([]);

  // Keep ref in sync with state for keyboard handler
  mrsRef.current = mrs;

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
  }, [selectedInstanceId]);

  // Sync MRs from MRList component (for keyboard navigation)
  const handleMRsLoaded = useCallback((loadedMrs: MergeRequest[]) => {
    setMrs(loadedMrs);
  }, []);

  // Handle Enter to open selected MR
  const handleSelectByIndex = useCallback(
    (index: number) => {
      const mr = mrsRef.current[index];
      if (mr) {
        navigate(`/mrs/${mr.id}`);
      }
    },
    [navigate]
  );

  // Keyboard navigation hook
  const { focusIndex, setFocusIndex } = useKeyboardNav({
    itemCount: mrs.length,
    onSelect: handleSelectByIndex,
    enabled: !loading && mrs.length > 0,
  });

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
        <h1>Merge Requests</h1>
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
        {selectedInstanceId && (
          <MRList
            instanceId={selectedInstanceId}
            onSelect={handleSelectMR}
            focusIndex={focusIndex}
            onFocusChange={setFocusIndex}
            onMRsLoaded={handleMRsLoaded}
          />
        )}
      </main>

      <footer className="mr-list-page-footer">
        <span className="keyboard-hint">
          <kbd>j</kbd>/<kbd>k</kbd> navigate &middot;{' '}
          <kbd>Enter</kbd> open &middot;{' '}
          <kbd>?</kbd> help
        </span>
      </footer>
    </div>
  );
}
