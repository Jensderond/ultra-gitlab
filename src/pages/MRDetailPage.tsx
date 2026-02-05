/**
 * MR Detail page component.
 *
 * Displays a merge request with file navigation and Monaco diff viewer.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { FileNavigation } from '../components/DiffViewer';
import { MonacoDiffViewer, type MonacoDiffViewerRef, type LineComment, type CursorPosition } from '../components/Monaco/MonacoDiffViewer';
import { ApprovalButton, type ApprovalButtonRef } from '../components/Approval';
import { getMergeRequestById, getMergeRequestFiles, getDiffRefs, getFileContent } from '../services/gitlab';
import { invoke } from '../services/tauri';
import type { MergeRequest, DiffFileSummary, DiffRefs, Comment, AddCommentRequest } from '../types';
import './MRDetailPage.css';

/**
 * Page for viewing a single merge request with diffs.
 */
export default function MRDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mrId = parseInt(id || '0', 10);
  const approvalButtonRef = useRef<ApprovalButtonRef>(null);
  const diffViewerRef = useRef<MonacoDiffViewerRef>(null);

  const [mr, setMr] = useState<MergeRequest | null>(null);
  const [files, setFiles] = useState<DiffFileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFocusIndex, setFileFocusIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [viewedPaths, setViewedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monaco diff viewer state
  const [diffRefs, setDiffRefs] = useState<DiffRefs | null>(null);
  const [originalContent, setOriginalContent] = useState<string>('');
  const [modifiedContent, setModifiedContent] = useState<string>('');
  const [fileContentLoading, setFileContentLoading] = useState(false);
  const [fileContentError, setFileContentError] = useState<string | null>(null);

  // Scroll position state per file
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const previousFileRef = useRef<string | null>(null);

  // Comments state for current file
  const [fileComments, setFileComments] = useState<LineComment[]>([]);

  // Comment input state
  const [commentInput, setCommentInput] = useState<{
    visible: boolean;
    position: CursorPosition | null;
    text: string;
    submitting: boolean;
  }>({ visible: false, position: null, text: '', submitting: false });
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Load MR data
  useEffect(() => {
    async function loadData() {
      if (!mrId) return;

      try {
        setLoading(true);
        setError(null);

        const [mrData, filesData, diffRefsData] = await Promise.all([
          getMergeRequestById(mrId),
          getMergeRequestFiles(mrId),
          getDiffRefs(mrId).catch(() => null), // May not exist yet
        ]);

        setMr(mrData);
        setDiffRefs(diffRefsData);

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
  }, [mrId]);

  // Handle file selection with scroll position preservation
  const handleFileSelect = useCallback((filePath: string) => {
    // Save current scroll position before switching
    if (previousFileRef.current && diffViewerRef.current) {
      const scrollTop = diffViewerRef.current.getScrollTop();
      scrollPositionsRef.current.set(previousFileRef.current, scrollTop);
    }

    setSelectedFile(filePath);
    previousFileRef.current = filePath;

    const index = files.findIndex((f) => f.newPath === filePath);
    if (index >= 0) {
      setFileFocusIndex(index);
    }
  }, [files]);

  // Load file content when selected file changes
  useEffect(() => {
    async function loadFileContent() {
      if (!selectedFile || !mr || !diffRefs) {
        setOriginalContent('');
        setModifiedContent('');
        return;
      }

      // Find the file info to check if it's added/deleted
      const fileInfo = files.find((f) => f.newPath === selectedFile);
      const isNewFile = fileInfo?.changeType === 'added';
      const isDeletedFile = fileInfo?.changeType === 'deleted';
      const oldPath = fileInfo?.oldPath || selectedFile;

      try {
        setFileContentLoading(true);
        setFileContentError(null);

        // Fetch original and modified content in parallel
        const [original, modified] = await Promise.all([
          // Original content (at base SHA) - empty for new files
          isNewFile
            ? Promise.resolve('')
            : getFileContent(mr.instanceId, mr.projectId, oldPath, diffRefs.baseSha).catch(() => ''),
          // Modified content (at head SHA) - empty for deleted files
          isDeletedFile
            ? Promise.resolve('')
            : getFileContent(mr.instanceId, mr.projectId, selectedFile, diffRefs.headSha).catch(() => ''),
        ]);

        setOriginalContent(original);
        setModifiedContent(modified);
      } catch (err) {
        setFileContentError(err instanceof Error ? err.message : 'Failed to load file content');
      } finally {
        setFileContentLoading(false);
      }
    }
    loadFileContent();
  }, [selectedFile, mr, diffRefs, files]);

  // Restore scroll position after content loads
  useEffect(() => {
    if (!fileContentLoading && selectedFile && diffViewerRef.current) {
      const savedScrollTop = scrollPositionsRef.current.get(selectedFile);
      if (savedScrollTop !== undefined) {
        // Small delay to ensure editor is rendered
        requestAnimationFrame(() => {
          diffViewerRef.current?.setScrollTop(savedScrollTop);
        });
      }
    }
  }, [fileContentLoading, selectedFile, originalContent, modifiedContent]);

  // Clear scroll positions when MR changes
  useEffect(() => {
    scrollPositionsRef.current.clear();
    previousFileRef.current = null;
  }, [mrId]);

  // Fetch comments for the current file
  useEffect(() => {
    async function loadComments() {
      if (!mrId || !selectedFile) {
        setFileComments([]);
        return;
      }

      try {
        const comments = await invoke<Comment[]>('get_file_comments', {
          mrId,
          filePath: selectedFile,
        });

        // Convert to LineComment format
        const lineComments: LineComment[] = comments
          .filter((c) => !c.system && (c.newLine !== null || c.oldLine !== null))
          .map((c) => ({
            id: c.id,
            line: c.newLine ?? c.oldLine ?? 0,
            isOldLine: c.newLine === null && c.oldLine !== null,
            authorUsername: c.authorUsername,
            body: c.body,
            createdAt: c.createdAt,
            resolved: c.resolved,
          }));

        setFileComments(lineComments);
      } catch {
        // Silently ignore comment fetch errors
        setFileComments([]);
      }
    }
    loadComments();
  }, [mrId, selectedFile]);

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

  // Mark current file as viewed and go to next file
  const markViewedAndNext = useCallback(() => {
    if (selectedFile) {
      setViewedPaths((prev) => new Set(prev).add(selectedFile));
      navigateFile(1);
    }
  }, [selectedFile, navigateFile]);

  // Submit a new comment
  const submitComment = useCallback(async () => {
    if (!commentInput.text.trim() || !commentInput.position || !selectedFile) return;

    setCommentInput((prev) => ({ ...prev, submitting: true }));

    try {
      const request: AddCommentRequest = {
        mrId,
        body: commentInput.text.trim(),
        position: {
          filePath: selectedFile,
          ...(commentInput.position.isOriginal
            ? { oldLine: commentInput.position.line }
            : { newLine: commentInput.position.line }),
        },
      };

      await invoke<{ localId: number }>('add_comment', { input: request });

      // Add optimistic update to comments
      const newComment: LineComment = {
        id: -Date.now(), // Temporary local ID
        line: commentInput.position.line,
        isOldLine: commentInput.position.isOriginal,
        authorUsername: 'You',
        body: commentInput.text.trim(),
        createdAt: Math.floor(Date.now() / 1000),
      };

      setFileComments((prev) => [...prev, newComment]);
      setCommentInput({ visible: false, position: null, text: '', submitting: false });
    } catch (err) {
      console.error('Failed to add comment:', err);
      setCommentInput((prev) => ({ ...prev, submitting: false }));
    }
  }, [commentInput.text, commentInput.position, selectedFile, mrId]);

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
        case 'j':
        case 'ArrowDown':
          // Next file
          e.preventDefault();
          navigateFile(1);
          break;
        case 'p':
        case 'k':
        case 'ArrowUp':
          // Previous file
          e.preventDefault();
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
        case 'o':
          // Open MR in browser
          e.preventDefault();
          if (mr?.webUrl) {
            openUrl(mr.webUrl);
          }
          break;
        case 'v':
          // Mark file as viewed and go to next
          e.preventDefault();
          markViewedAndNext();
          break;
        case 'c':
          // Open comment input at current line
          e.preventDefault();
          if (selectedFile) {
            const pos = diffViewerRef.current?.getCursorPosition();
            if (pos) {
              setCommentInput({ visible: true, position: pos, text: '', submitting: false });
              // Focus textarea after render
              requestAnimationFrame(() => {
                commentInputRef.current?.focus();
              });
            }
          }
          break;
        case 'Escape':
          // Close comment input if visible, otherwise go back
          if (commentInput.visible) {
            e.preventDefault();
            setCommentInput({ visible: false, position: null, text: '', submitting: false });
          } else {
            // Go back to list, focus on latest item
            navigate('/mrs', { state: { focusLatest: true } });
          }
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateFile, navigate, viewMode, markViewedAndNext, selectedFile, commentInput.visible]);

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
            hasApproved={mr.userHasApproved}
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
            viewedPaths={viewedPaths}
          />
        </aside>

        <main className="mr-detail-main">
          {selectedFile ? (
            fileContentLoading ? (
              <div className="file-loading">Loading file content...</div>
            ) : fileContentError ? (
              <div className="file-error">
                <p>{fileContentError}</p>
                <button onClick={() => handleFileSelect(selectedFile)}>Retry</button>
              </div>
            ) : !diffRefs ? (
              <div className="file-error">
                <p>Diff information not available. Please sync the merge request first.</p>
              </div>
            ) : (
              <MonacoDiffViewer
                ref={diffViewerRef}
                originalContent={originalContent}
                modifiedContent={modifiedContent}
                filePath={selectedFile}
                viewMode={viewMode}
                comments={fileComments}
              />
            )
          ) : (
            <div className="no-file-selected">
              Select a file to view its diff
            </div>
          )}
        </main>
      </div>

      {/* Comment input overlay */}
      {commentInput.visible && commentInput.position && (
        <div className="comment-input-overlay">
          <div className="comment-input-container">
            <div className="comment-input-header">
              <span>
                Add comment on {commentInput.position.isOriginal ? 'old' : 'new'} line{' '}
                {commentInput.position.line}
              </span>
              <button
                className="comment-input-close"
                onClick={() => setCommentInput({ visible: false, position: null, text: '', submitting: false })}
              >
                ✕
              </button>
            </div>
            <textarea
              ref={commentInputRef}
              className="comment-input-textarea"
              placeholder="Write a comment..."
              value={commentInput.text}
              onChange={(e) => setCommentInput((prev) => ({ ...prev, text: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitComment();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setCommentInput({ visible: false, position: null, text: '', submitting: false });
                }
              }}
              disabled={commentInput.submitting}
              rows={4}
            />
            <div className="comment-input-actions">
              <span className="comment-input-hint">
                <kbd>⌘</kbd>+<kbd>Enter</kbd> to submit · <kbd>Esc</kbd> to cancel
              </span>
              <button
                className="comment-input-submit"
                onClick={submitComment}
                disabled={!commentInput.text.trim() || commentInput.submitting}
              >
                {commentInput.submitting ? 'Submitting...' : 'Add Comment'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mr-detail-footer">
        <span className="keyboard-hint">
          <kbd>j</kbd>/<kbd>k</kbd> or <kbd>↑</kbd>/<kbd>↓</kbd> file &middot;{' '}
          <kbd>v</kbd> viewed &middot;{' '}
          <kbd>x</kbd> split/unified &middot;{' '}
          <kbd>a</kbd> approve &middot;{' '}
          <kbd>c</kbd> comment &middot;{' '}
          <kbd>o</kbd> open &middot;{' '}
          <kbd>⌘F</kbd> find &middot;{' '}
          <kbd>?</kbd> help
        </span>
      </footer>
    </div>
  );
}
