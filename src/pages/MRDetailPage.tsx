/**
 * MR Detail page component.
 *
 * Displays a merge request with file navigation and diff viewer.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DiffViewer, FileNavigation } from '../components/DiffViewer';
import { ApprovalButton, type ApprovalButtonRef } from '../components/Approval';
import { getMergeRequestById, getMergeRequestFiles } from '../services/gitlab';
import type { MergeRequest, DiffFileSummary } from '../types';
import './MRDetailPage.css';
import '../styles/syntax.css';

/**
 * Page for viewing a single merge request with diffs.
 */
export default function MRDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mrId = parseInt(id || '0', 10);
  const approvalButtonRef = useRef<ApprovalButtonRef>(null);

  const [mr, setMr] = useState<MergeRequest | null>(null);
  const [files, setFiles] = useState<DiffFileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFocusIndex, setFileFocusIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load MR data
  useEffect(() => {
    async function loadData() {
      if (!mrId) return;

      try {
        setLoading(true);
        setError(null);

        const [mrData, filesData] = await Promise.all([
          getMergeRequestById(mrId),
          getMergeRequestFiles(mrId),
        ]);

        setMr(mrData);

        // Convert DiffFile[] to DiffFileSummary[]
        const summaries: DiffFileSummary[] = filesData.map((f) => ({
          newPath: f.newPath,
          oldPath: f.oldPath,
          changeType: f.changeType,
          additions: f.additions,
          deletions: f.deletions,
        }));

        setFiles(summaries);

        // Auto-select first file if available
        if (summaries.length > 0 && !selectedFile) {
          setSelectedFile(summaries[0].newPath);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load merge request');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [mrId, selectedFile]);

  // Handle file selection
  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    const index = files.findIndex((f) => f.newPath === filePath);
    if (index >= 0) {
      setFileFocusIndex(index);
    }
  }, [files]);

  // Navigate to next/previous file
  const navigateFile = useCallback(
    (direction: 1 | -1) => {
      const newIndex = fileFocusIndex + direction;
      if (newIndex >= 0 && newIndex < files.length) {
        setFileFocusIndex(newIndex);
        setSelectedFile(files[newIndex].newPath);
      }
    },
    [fileFocusIndex, files]
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
        case 'n':
          // Next file
          navigateFile(1);
          break;
        case 'p':
          // Previous file
          navigateFile(-1);
          break;
        case 'x':
          // Toggle unified/split view
          e.preventDefault();
          setViewMode(viewMode === 'unified' ? 'split' : 'unified');
          break;
        case 'a':
          // Approve/unapprove MR
          e.preventDefault();
          approvalButtonRef.current?.toggle();
          break;
        case 'Escape':
          // Go back to list
          navigate('/mrs');
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateFile, navigate, viewMode]);

  // Loading state
  if (loading) {
    return (
      <div className="mr-detail-page">
        <div className="mr-detail-loading">Loading merge request...</div>
      </div>
    );
  }

  // Error state
  if (error || !mr) {
    return (
      <div className="mr-detail-page">
        <div className="mr-detail-error">
          <p>{error || 'Merge request not found'}</p>
          <button onClick={() => navigate('/mrs')}>Back to list</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-detail-page">
      <header className="mr-detail-header">
        <button className="back-button" onClick={() => navigate('/mrs')}>
          ← Back
        </button>
        <div className="mr-detail-title">
          <span className="mr-iid">!{mr.iid}</span>
          <h1>{mr.title}</h1>
        </div>
        <div className="mr-detail-meta">
          <span className="mr-author">{mr.authorUsername}</span>
          <span className="mr-branches">
            {mr.sourceBranch} → {mr.targetBranch}
          </span>
        </div>
        <div className="mr-detail-actions">
          <ApprovalButton
            ref={approvalButtonRef}
            mrId={mrId}
            projectId={mr.projectId}
            mrIid={mr.iid}
            approvalStatus={mr.approvalStatus}
            approvalsCount={mr.approvalsCount ?? 0}
            approvalsRequired={mr.approvalsRequired ?? 1}
          />
        </div>
      </header>

      <div className="mr-detail-content">
        <aside className="mr-detail-sidebar">
          <FileNavigation
            files={files}
            selectedPath={selectedFile ?? undefined}
            onSelect={handleFileSelect}
            focusIndex={fileFocusIndex}
          />
        </aside>

        <main className="mr-detail-main">
          {selectedFile ? (
            <DiffViewer
              mrId={mrId}
              projectId={mr.projectId}
              mrIid={mr.iid}
              filePath={selectedFile}
              currentUser="" // TODO: Get from settings/auth
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          ) : (
            <div className="no-file-selected">
              Select a file to view its diff
            </div>
          )}
        </main>
      </div>

      <footer className="mr-detail-footer">
        <span className="keyboard-hint">
          <kbd>n</kbd>/<kbd>p</kbd> file &middot;{' '}
          <kbd>]</kbd>/<kbd>[</kbd> change &middot;{' '}
          <kbd>x</kbd> split/unified &middot;{' '}
          <kbd>a</kbd> approve &middot;{' '}
          <kbd>c</kbd> comment &middot;{' '}
          <kbd>?</kbd> help
        </span>
      </footer>
    </div>
  );
}
