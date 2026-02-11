/**
 * My MR Detail page component.
 *
 * Tab-based detail view for author's own merge requests.
 * Tabs: Overview (default), Comments, Code
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getMergeRequest, getMrReviewers } from '../services/tauri';
import type { MergeRequest, MrReviewer } from '../types';
import './MyMRDetailPage.css';

type TabId = 'overview' | 'comments' | 'code';

/**
 * Format a Unix timestamp as a relative time string.
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Get CSS class for reviewer status.
 */
function reviewerStatusClass(status: string): string {
  switch (status) {
    case 'approved': return 'reviewer-approved';
    case 'changes_requested': return 'reviewer-changes';
    default: return 'reviewer-pending';
  }
}

/**
 * Get display label for reviewer status.
 */
function reviewerStatusLabel(status: string): string {
  switch (status) {
    case 'approved': return 'Approved';
    case 'changes_requested': return 'Changes Requested';
    default: return 'Pending';
  }
}

export default function MyMRDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mrId = parseInt(id || '0', 10);

  const [mr, setMr] = useState<MergeRequest | null>(null);
  const [reviewers, setReviewers] = useState<MrReviewer[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load MR and reviewers
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [mrData, reviewerData] = await Promise.all([
          getMergeRequest(mrId),
          getMrReviewers(mrId),
        ]);
        setMr(mrData);
        setReviewers(reviewerData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load MR');
      } finally {
        setLoading(false);
      }
    }
    if (mrId) load();
  }, [mrId]);

  const goBack = useCallback(() => {
    navigate('/my-mrs');
  }, [navigate]);

  // Handle Escape to go back
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        goBack();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goBack]);

  if (loading) {
    return (
      <div className="my-mr-detail">
        <div className="my-mr-detail-loading">Loading...</div>
      </div>
    );
  }

  if (error || !mr) {
    return (
      <div className="my-mr-detail">
        <div className="my-mr-detail-error">
          <p>{error || 'MR not found'}</p>
          <button onClick={goBack}>Go Back</button>
        </div>
      </div>
    );
  }

  const approvedCount = reviewers.filter(r => r.status === 'approved').length;
  const requiredCount = mr.approvalsRequired ?? 0;

  return (
    <div className="my-mr-detail">
      <header className="my-mr-detail-header">
        <button className="my-mr-back-btn" onClick={goBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          My MRs
        </button>
        <div className="my-mr-detail-title-row">
          <span className="my-mr-detail-iid">!{mr.iid}</span>
          <h1>{mr.title}</h1>
        </div>
      </header>

      <nav className="my-mr-tabs">
        <button
          className={`my-mr-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`my-mr-tab ${activeTab === 'comments' ? 'active' : ''}`}
          onClick={() => setActiveTab('comments')}
        >
          Comments
        </button>
        <button
          className={`my-mr-tab ${activeTab === 'code' ? 'active' : ''}`}
          onClick={() => setActiveTab('code')}
        >
          Code
        </button>
      </nav>

      <div className="my-mr-tab-content">
        {activeTab === 'overview' && (
          <div className="my-mr-overview">
            <section className="my-mr-overview-section">
              <h3>Details</h3>
              <dl className="my-mr-detail-list">
                <dt>State</dt>
                <dd>
                  <span className={`my-mr-state-badge ${mr.state}`}>
                    {mr.state === 'opened' ? 'Open' : mr.state}
                  </span>
                </dd>
                <dt>Branches</dt>
                <dd className="my-mr-branches">
                  <code>{mr.sourceBranch}</code>
                  <span className="my-mr-arrow">&rarr;</span>
                  <code>{mr.targetBranch}</code>
                </dd>
                <dt>Updated</dt>
                <dd>{formatRelativeTime(mr.updatedAt)}</dd>
                {mr.labels.length > 0 && (
                  <>
                    <dt>Labels</dt>
                    <dd className="my-mr-labels">
                      {mr.labels.map(label => (
                        <span key={label} className="my-mr-label">{label}</span>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            </section>

            {mr.description && (
              <section className="my-mr-overview-section">
                <h3>Description</h3>
                <div className="my-mr-description">{mr.description}</div>
              </section>
            )}

            <section className="my-mr-overview-section">
              <h3>
                Approvals
                {requiredCount > 0 && (
                  <span className="my-mr-approval-summary">
                    {approvedCount} of {requiredCount} required
                  </span>
                )}
              </h3>
              {reviewers.length === 0 ? (
                <p className="my-mr-no-reviewers">No reviewers assigned</p>
              ) : (
                <ul className="my-mr-reviewer-list">
                  {reviewers.map(reviewer => (
                    <li key={reviewer.username} className={`my-mr-reviewer ${reviewerStatusClass(reviewer.status)}`}>
                      {reviewer.avatarUrl && (
                        <img
                          src={reviewer.avatarUrl}
                          alt={reviewer.username}
                          className="my-mr-reviewer-avatar"
                        />
                      )}
                      <span className="my-mr-reviewer-name">{reviewer.username}</span>
                      <span className="my-mr-reviewer-status">
                        {reviewerStatusLabel(reviewer.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="my-mr-tab-placeholder">
            Comments tab (US-007)
          </div>
        )}

        {activeTab === 'code' && (
          <div className="my-mr-tab-placeholder">
            Code tab (US-008)
          </div>
        )}
      </div>
    </div>
  );
}
