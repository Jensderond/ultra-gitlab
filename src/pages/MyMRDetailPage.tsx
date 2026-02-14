/**
 * My MR Detail page component.
 *
 * Tab-based detail view for author's own merge requests.
 * Tabs: Overview (default), Comments, Code
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getMergeRequest, getMrReviewers, getComments, getCollapsePatterns, mergeMR, checkMergeStatus, rebaseMR } from '../services/tauri';
import { getMergeRequestFiles, getDiffRefs, getGitattributesPatterns } from '../services/gitlab';
import BackButton from '../components/BackButton';
import { FileNavigation } from '../components/DiffViewer';
import { MonacoDiffViewer, type MonacoDiffViewerRef } from '../components/Monaco/MonacoDiffViewer';
import { ImageDiffViewer } from '../components/Monaco/ImageDiffViewer';
import { isImageFile, getImageMimeType } from '../components/Monaco/languageDetection';
import { classifyFiles } from '../utils/classifyFiles';
import { useFileContent } from '../hooks/useFileContent';
import { useCopyToast } from '../hooks/useCopyToast';
import type { MergeRequest, MrReviewer, Comment, DiffFileSummary, DiffRefs } from '../types';
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

  const [showCopyToast, copyToClipboard] = useCopyToast();

  const [mr, setMr] = useState<MergeRequest | null>(null);
  const [reviewers, setReviewers] = useState<MrReviewer[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [mergeStatus, setMergeStatus] = useState<string | null>(null);
  const [mergeStatusLoading, setMergeStatusLoading] = useState(false);
  const [rebasing, setRebasing] = useState(false);

  // Code tab state
  const diffViewerRef = useRef<MonacoDiffViewerRef>(null);
  const [files, setFiles] = useState<DiffFileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFocusIndex, setFileFocusIndex] = useState(0);
  const [generatedPaths, setGeneratedPaths] = useState<Set<string>>(new Set());
  const [hideGenerated, setHideGenerated] = useState(true);
  const [diffRefs, setDiffRefs] = useState<DiffRefs | null>(null);
  const [codeTabLoaded, setCodeTabLoaded] = useState(false);

  // Reviewable files (excludes generated)
  const reviewableFiles = useMemo(
    () => files.filter((f) => !generatedPaths.has(f.newPath)),
    [files, generatedPaths]
  );

  // File content with in-memory cache for instant navigation
  const {
    content: fileContent,
    imageContent,
    isLoading: fileContentLoading,
  } = useFileContent(mrId, mr, diffRefs, files, selectedFile, reviewableFiles);

  // Track image→text transitions to re-layout Monaco
  const wasImageRef = useRef(false);
  useEffect(() => {
    const isImage = selectedFile ? isImageFile(selectedFile) : false;
    if (wasImageRef.current && !isImage && selectedFile) {
      requestAnimationFrame(() => {
        diffViewerRef.current?.layout();
      });
    }
    wasImageRef.current = isImage;
  }, [selectedFile]);

  // Load MR, reviewers, and comments
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [mrData, reviewerData, commentData] = await Promise.all([
          getMergeRequest(mrId),
          getMrReviewers(mrId),
          getComments(mrId),
        ]);
        setMr(mrData);
        setReviewers(reviewerData);
        setComments(commentData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load MR');
      } finally {
        setLoading(false);
      }
    }
    if (mrId) load();
  }, [mrId]);

  // Fetch merge status from GitLab when MR is open
  const fetchMergeStatus = useCallback(async () => {
    if (!mr || mr.state !== 'opened') return;
    setMergeStatusLoading(true);
    try {
      const status = await checkMergeStatus(mrId);
      setMergeStatus(status);
    } catch {
      setMergeStatus(null);
    } finally {
      setMergeStatusLoading(false);
    }
  }, [mr, mrId]);

  useEffect(() => {
    fetchMergeStatus();
  }, [fetchMergeStatus]);

  const handleRebase = useCallback(async () => {
    if (rebasing) return;
    setRebasing(true);
    setMergeError(null);
    try {
      await rebaseMR(mrId);
      // Re-check status after rebase is initiated
      // GitLab rebases asynchronously, so poll briefly
      setTimeout(() => fetchMergeStatus(), 3000);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Rebase failed');
    } finally {
      setRebasing(false);
    }
  }, [mrId, rebasing, fetchMergeStatus]);

  // Group comments by discussion thread
  const threads = useMemo(() => {
    const threadMap = new Map<string, Comment[]>();
    for (const c of comments) {
      if (c.system) continue;
      const key = c.discussionId ?? `standalone-${c.id}`;
      if (!threadMap.has(key)) threadMap.set(key, []);
      threadMap.get(key)!.push(c);
    }
    // Sort threads: unresolved first, then by earliest comment date
    return Array.from(threadMap.values()).sort((a, b) => {
      const aResolved = a.some(c => c.resolved);
      const bResolved = b.some(c => c.resolved);
      if (aResolved !== bResolved) return aResolved ? 1 : -1;
      return (a[0]?.createdAt ?? 0) - (b[0]?.createdAt ?? 0);
    });
  }, [comments]);

  const unresolvedCount = useMemo(
    () => threads.filter(
      t => t.some(c => c.discussionId) && !t.some(c => c.resolved)
    ).length,
    [threads]
  );

  const approvedCount = useMemo(
    () => reviewers.filter(r => r.status === 'approved').length,
    [reviewers]
  );

  const handleMerge = useCallback(async () => {
    if (!mr || merging) return;

    // First click: show confirmation
    if (!mergeConfirm) {
      setMergeConfirm(true);
      setMergeError(null);
      return;
    }

    // Second click: actually merge
    setMerging(true);
    setMergeError(null);
    setMergeConfirm(false);
    try {
      await mergeMR(mrId);
      setMr((prev) => prev ? { ...prev, state: 'merged' } : prev);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setMerging(false);
    }
  }, [mr, mrId, merging, mergeConfirm]);

  const goBack = useCallback(() => {
    navigate('/my-mrs');
  }, [navigate]);

  // Lazy-load Code tab data on first activation
  useEffect(() => {
    if (activeTab !== 'code' || codeTabLoaded || !mr) return;
    const currentMr = mr;

    async function loadCodeData() {
      try {
        const [filesData, diffRefsData] = await Promise.all([
          getMergeRequestFiles(mrId),
          getDiffRefs(mrId).catch(() => null),
        ]);

        setDiffRefs(diffRefsData);

        const summaries: DiffFileSummary[] = filesData.map((f) => ({
          newPath: f.newPath,
          oldPath: f.oldPath,
          changeType: f.changeType,
          additions: f.additions,
          deletions: f.deletions,
        }));
        setFiles(summaries);

        const [gitattributes, userPatterns] = await Promise.all([
          getGitattributesPatterns(currentMr.instanceId, currentMr.projectId).catch(() => []),
          getCollapsePatterns().catch(() => []),
        ]);

        const { reviewable, generated } = classifyFiles(summaries, gitattributes, userPatterns);
        setGeneratedPaths(generated);

        if (reviewable.length > 0) {
          setSelectedFile(reviewable[0].newPath);
          const fullIndex = summaries.findIndex((f) => f.newPath === reviewable[0].newPath);
          if (fullIndex >= 0) setFileFocusIndex(fullIndex);
        }

        setCodeTabLoaded(true);
      } catch {
        // Silently handle — files just won't load
      }
    }
    loadCodeData();
  }, [activeTab, codeTabLoaded, mr, mrId]);

  // File selection handler for Code tab
  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    const index = files.findIndex((f) => f.newPath === filePath);
    if (index >= 0) setFileFocusIndex(index);
  }, [files]);

  // Navigate to next/previous reviewable file (Code tab)
  const navigateFile = useCallback(
    (direction: 1 | -1) => {
      if (reviewableFiles.length === 0) return;
      const currentIdx = reviewableFiles.findIndex((f) => f.newPath === selectedFile);
      let nextIdx: number;
      if (currentIdx === -1) {
        nextIdx = direction === 1 ? 0 : reviewableFiles.length - 1;
      } else {
        nextIdx = currentIdx + direction;
        if (nextIdx < 0) nextIdx = reviewableFiles.length - 1;
        if (nextIdx >= reviewableFiles.length) nextIdx = 0;
      }
      const nextFile = reviewableFiles[nextIdx];
      const fullIndex = files.findIndex((f) => f.newPath === nextFile.newPath);
      if (fullIndex >= 0) setFileFocusIndex(fullIndex);
      setSelectedFile(nextFile.newPath);
    },
    [reviewableFiles, files, selectedFile]
  );

  // Keyboard shortcuts — ref pattern avoids listener churn
  const keydownRef = useRef<(e: KeyboardEvent) => void>(undefined);
  keydownRef.current = (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    switch (e.key) {
      case 'Escape':
        if (!document.querySelector('.keyboard-help-overlay')) {
          e.preventDefault();
          goBack();
        }
        break;
      case '1':
      case '2':
      case '3': {
        e.preventDefault();
        const tabs: TabId[] = ['overview', 'comments', 'code'];
        const tabIndex = parseInt(e.key, 10) - 1;
        setActiveTab(tabs[tabIndex]);
        break;
      }
      case 'o':
        e.preventDefault();
        if (mr?.webUrl) openUrl(mr.webUrl);
        break;
      case 'y':
        // Copy MR link to clipboard
        e.preventDefault();
        if (mr?.webUrl) copyToClipboard(mr.webUrl);
        break;
      case 'n':
      case 'j':
      case 'ArrowDown':
        if (activeTab === 'code') {
          e.preventDefault();
          navigateFile(1);
        }
        break;
      case 'p':
      case 'k':
      case 'ArrowUp':
        if (activeTab === 'code') {
          e.preventDefault();
          navigateFile(-1);
        }
        break;
      case 'g':
        if (activeTab === 'code') {
          e.preventDefault();
          setHideGenerated((prev) => !prev);
        }
        break;
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keydownRef.current?.(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

  const requiredCount = mr.approvalsRequired ?? 0;

  return (
    <div className="my-mr-detail">
      <header className="my-mr-detail-header">
        <div className="my-mr-detail-title-row">
          <BackButton onClick={goBack} title="Back" />
          <span className="my-mr-detail-iid">!{mr.iid}</span>
          <h1>{mr.title}</h1>
        </div>
      </header>

      <nav className="my-mr-tabs">
        <button
          className={`my-mr-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <kbd>[1]</kbd> Overview
        </button>
        <button
          className={`my-mr-tab ${activeTab === 'comments' ? 'active' : ''}`}
          onClick={() => setActiveTab('comments')}
        >
          <kbd>[2]</kbd> Comments{unresolvedCount > 0 ? ` (${unresolvedCount})` : ''}
        </button>
        <button
          className={`my-mr-tab ${activeTab === 'code' ? 'active' : ''}`}
          onClick={() => setActiveTab('code')}
        >
          <kbd>[3]</kbd> Code
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
                <div className="my-mr-reviewer-row">
                  {reviewers.map(reviewer => (
                    <div key={reviewer.username} className={`my-mr-reviewer-chip ${reviewerStatusClass(reviewer.status)}`}>
                      <div className="my-mr-reviewer-avatar">
                        {reviewer.avatarUrl && (
                          <img
                            src={reviewer.avatarUrl}
                            alt=""
                            onError={(e) => { e.currentTarget.hidden = true; }}
                          />
                        )}
                        <span>{reviewer.username.charAt(0).toUpperCase()}</span>
                      </div>
                      <span className="my-mr-reviewer-name">{reviewer.username}</span>
                      <span className="my-mr-reviewer-dot" title={reviewerStatusLabel(reviewer.status)} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {mr.state === 'opened' && (
              <section className="my-mr-merge-section">
                <h3>Merge</h3>
                {mergeStatusLoading ? (
                  <p className="my-mr-merge-status-text">Checking merge status...</p>
                ) : mergeStatus === 'mergeable' && mr.approvalStatus === 'approved' ? (
                  <div className="my-mr-merge-actions">
                    <button
                      className={`my-mr-merge-button ${mergeConfirm ? 'confirm' : ''}`}
                      onClick={handleMerge}
                      disabled={merging}
                    >
                      {merging ? 'Merging...' : mergeConfirm ? 'Click again to confirm' : 'Merge'}
                    </button>
                    {mergeConfirm && (
                      <button
                        className="my-mr-merge-cancel"
                        onClick={() => setMergeConfirm(false)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ) : mergeStatus === 'need_rebase' ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status need-rebase">Needs rebase</span>
                    <button
                      className="my-mr-rebase-button"
                      onClick={handleRebase}
                      disabled={rebasing}
                    >
                      {rebasing ? 'Rebasing...' : 'Rebase'}
                    </button>
                  </div>
                ) : mergeStatus === 'conflict' ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status conflict">Has conflicts</span>
                  </div>
                ) : mergeStatus === 'ci_must_pass' ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status ci-pending">Pipeline must pass</span>
                  </div>
                ) : mergeStatus === 'discussions_not_resolved' ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status discussions">Unresolved discussions</span>
                  </div>
                ) : mergeStatus === 'draft_status' ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status draft">Draft</span>
                  </div>
                ) : mergeStatus === 'not_approved' ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status not-approved">Not yet approved</span>
                  </div>
                ) : mergeStatus === 'checking' ? (
                  <p className="my-mr-merge-status-text">GitLab is checking mergeability...</p>
                ) : mergeStatus === 'mergeable' ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status not-approved">Not yet approved</span>
                  </div>
                ) : mergeStatus ? (
                  <div className="my-mr-merge-actions">
                    <span className="my-mr-merge-status">{mergeStatus.replace(/_/g, ' ')}</span>
                  </div>
                ) : null}
                {mergeError && (
                  <p className="my-mr-merge-error">{mergeError}</p>
                )}
              </section>
            )}

            {mr.state === 'merged' && (
              <section className="my-mr-merge-section">
                <h3>Merge</h3>
                <span className="my-mr-state-badge merged">Merged</span>
              </section>
            )}
          </div>
        )}

        {activeTab === 'comments' && (
          <div className="my-mr-comments">
            {threads.length === 0 ? (
              <p className="my-mr-no-comments">No comments on this merge request.</p>
            ) : (
              threads.map((thread) => {
                const isResolved = thread.some(c => c.resolved);
                return (
                  <div
                    key={thread[0].discussionId ?? thread[0].id}
                    className={`my-mr-thread ${isResolved ? 'resolved' : ''}`}
                  >
                    {thread[0].filePath && (
                      <div className="my-mr-thread-file">
                        {thread[0].filePath}
                        {thread[0].newLine != null && `:${thread[0].newLine}`}
                      </div>
                    )}
                    {thread.map(comment => (
                      <div key={comment.id} className="my-mr-comment">
                        <div className="my-mr-comment-header">
                          <span className="my-mr-comment-author">{comment.authorUsername}</span>
                          <span className="my-mr-comment-time">{formatRelativeTime(comment.createdAt)}</span>
                        </div>
                        <div className="my-mr-comment-body">{comment.body}</div>
                      </div>
                    ))}
                    {isResolved && (
                      <div className="my-mr-thread-resolved-badge">Resolved</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'code' && (
          <div className="my-mr-code-tab">
            <aside className="my-mr-code-sidebar">
              <FileNavigation
                files={files}
                selectedPath={selectedFile ?? undefined}
                onSelect={handleFileSelect}
                focusIndex={fileFocusIndex}
                generatedPaths={generatedPaths}
                hideGenerated={hideGenerated}
                onToggleHideGenerated={() => setHideGenerated((prev) => !prev)}
              />
            </aside>
            <main className="my-mr-code-main">
              {!codeTabLoaded ? (
                <div className="my-mr-code-loading">Loading files...</div>
              ) : selectedFile ? (
                <>
                  {/* Loading overlay */}
                  {fileContentLoading && (
                    <div className="my-mr-code-overlay">
                      <div className="my-mr-code-spinner" />
                    </div>
                  )}

                  {/* No diff refs overlay */}
                  {!fileContentLoading && !diffRefs && (
                    <div className="my-mr-code-overlay">
                      <div className="my-mr-code-loading">Diff information not available. Please sync first.</div>
                    </div>
                  )}

                  {/* Image diff viewer (mounts/unmounts freely) */}
                  {isImageFile(selectedFile) && !fileContentLoading && diffRefs && (
                    <ImageDiffViewer
                      originalBase64={imageContent.originalBase64}
                      modifiedBase64={imageContent.modifiedBase64}
                      filePath={selectedFile}
                      mimeType={getImageMimeType(selectedFile)}
                    />
                  )}

                  {/* Monaco diff wrapper — always mounted, hidden for images */}
                  <div
                    className="my-mr-monaco-wrapper"
                    style={{ display: isImageFile(selectedFile) ? 'none' : undefined }}
                  >
                    <MonacoDiffViewer
                      ref={diffViewerRef}
                      originalContent={fileContent.original}
                      modifiedContent={fileContent.modified}
                      filePath={selectedFile}
                      viewMode="unified"
                      comments={[]}
                    />
                  </div>
                </>
              ) : files.length > 0 && reviewableFiles.length === 0 ? (
                <div className="my-mr-code-loading">All files are generated. Click a file to view.</div>
              ) : (
                <div className="my-mr-code-loading">Select a file to view its diff</div>
              )}
            </main>
          </div>
        )}
      </div>

      {showCopyToast && (
        <div className="copy-toast">Link copied</div>
      )}

      <footer className="my-mr-detail-footer">
        <span className="keyboard-hint">
          <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> tab &middot;{' '}
          <kbd>j</kbd>/<kbd>k</kbd> file &middot;{' '}
          <span className="shortcut-underline">g</span>enerated &middot;{' '}
          <span className="shortcut-underline">o</span>pen &middot;{' '}
          <span className="shortcut-underline">y</span>ank link &middot;{' '}
          <kbd>Esc</kbd> back
        </span>
      </footer>
    </div>
  );
}
