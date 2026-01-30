/**
 * MR List page component.
 *
 * Main page for viewing the list of merge requests.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MRList } from '../components/MRList';
import { listInstances, type GitLabInstanceWithStatus } from '../services/gitlab';
import type { MergeRequest } from '../types';
import './MRListPage.css';

/**
 * Page for displaying the merge request list.
 */
export default function MRListPage() {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [selectedMrId, setSelectedMrId] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [loading, setLoading] = useState(true);

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

  // Handle MR selection - navigate to detail
  const handleSelectMR = useCallback(
    (mr: MergeRequest) => {
      setSelectedMrId(mr.id);
      navigate(`/mrs/${mr.id}`);
    },
    [navigate]
  );

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case 'j':
          // Move focus down
          setFocusIndex((prev) => prev + 1);
          break;
        case 'k':
          // Move focus up
          setFocusIndex((prev) => Math.max(0, prev - 1));
          break;
        case 'Enter':
          // Open selected MR - handled by MRList component
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
            selectedMrId={selectedMrId ?? undefined}
            onSelect={handleSelectMR}
            focusIndex={focusIndex}
            onFocusChange={setFocusIndex}
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
