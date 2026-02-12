/**
 * MR Detail page component.
 *
 * Displays a merge request with file navigation and Monaco diff viewer.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { FileNavigation } from '../components/DiffViewer';
import { MonacoDiffViewer, type MonacoDiffViewerRef, type LineComment } from '../components/Monaco/MonacoDiffViewer';
import type { editor } from 'monaco-editor';
import { ImageDiffViewer } from '../components/Monaco/ImageDiffViewer';
import { isImageFile, getImageMimeType } from '../components/Monaco/languageDetection';
import { ApprovalButton, type ApprovalButtonRef } from '../components/Approval';
import { CommentOverlay, type CommentOverlayRef } from '../components/CommentOverlay';
import { getMergeRequestById, getMergeRequestFiles, getDiffRefs, getGitattributesPatterns } from '../services/gitlab';
import { invoke, getCollapsePatterns } from '../services/tauri';
import { classifyFiles } from '../utils/classifyFiles';
import { useFileContent } from '../hooks/useFileContent';
import { useCopyToast } from '../hooks/useCopyToast';
import type { MergeRequest, DiffFileSummary, DiffRefs, Comment } from '../types';
import './MRDetailPage.css';

interface MRDetailPageProps {
  updateAvailable?: boolean;
}

/**
 * Page for viewing a single merge request with diffs.
 */
export default function MRDetailPage({ updateAvailable }: MRDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mrId = parseInt(id || '0', 10);
  const approvalButtonRef = useRef<ApprovalButtonRef>(null);
  const diffViewerRef = useRef<MonacoDiffViewerRef>(null);

  const [showCopyToast, copyToClipboard] = useCopyToast();

  const [mr, setMr] = useState<MergeRequest | null>(null);
  const [files, setFiles] = useState<DiffFileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFocusIndex, setFileFocusIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');
  const [collapseState, setCollapseState] = useState<'collapsed' | 'expanded' | 'partial'>('collapsed');
  const [viewedPaths, setViewedPaths] = useState<Set<string>>(new Set());
  const [generatedPaths, setGeneratedPaths] = useState<Set<string>>(new Set());
  const [hideGenerated, setHideGenerated] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monaco diff viewer state
  const [diffRefs, setDiffRefs] = useState<DiffRefs | null>(null);

  // View state per file (scroll, cursor, collapsed regions)
  const viewStatesRef = useRef<Map<string, editor.IDiffEditorViewState>>(new Map());
  const previousFileRef = useRef<string | null>(null);
  // Pending view state to restore after view mode toggle
  const pendingViewStateRef = useRef<editor.IDiffEditorViewState | null>(null);

  // Comments state for current file
  const [fileComments, setFileComments] = useState<LineComment[]>([]);
  const commentOverlayRef = useRef<CommentOverlayRef>(null);

  // Reviewable files for keyboard navigation (excludes generated files)
  const reviewableFiles = useMemo(
    () => files.filter((f) => !generatedPaths.has(f.newPath)),
    [files, generatedPaths]
  );

  // File content with in-memory cache for instant navigation
  const {
    content: fileContent,
    imageContent,
    isLoading: fileContentLoading,
    error: fileContentError,
    clearCache: clearFileCache,
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

        // Fetch gitattributes and user collapse patterns for file classification
        const [gitattributes, userPatterns] = await Promise.all([
          getGitattributesPatterns(mrData.instanceId, mrData.projectId).catch(() => []),
          getCollapsePatterns().catch(() => []),
        ]);

        const { reviewable, generated } = classifyFiles(summaries, gitattributes, userPatterns);
        setGeneratedPaths(generated);

        // Auto-select first reviewable file (skip generated files)
        if (!selectedFile && reviewable.length > 0) {
          const firstReviewable = reviewable[0];
          setSelectedFile(firstReviewable.newPath);
          const fullIndex = summaries.findIndex((f) => f.newPath === firstReviewable.newPath);
          if (fullIndex >= 0) setFileFocusIndex(fullIndex);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load merge request');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [mrId]);

  // Re-fetch MR data when mr-updated event matches the current MR
  useEffect(() => {
    if (!mrId) return;

    let unlisten: UnlistenFn | undefined;
    listen<{ mr_id: number; update_type: string; instance_id: number; iid: number }>(
      'mr-updated',
      async (event) => {
        if (event.payload.mr_id !== mrId) return;

        try {
          const [mrData, filesData, diffRefsData] = await Promise.all([
            getMergeRequestById(mrId),
            getMergeRequestFiles(mrId),
            getDiffRefs(mrId).catch(() => null),
          ]);

          setMr(mrData);
          setDiffRefs(diffRefsData);

          const summaries: DiffFileSummary[] = filesData.map((f) => ({
            newPath: f.newPath,
            oldPath: f.oldPath,
            changeType: f.changeType,
            additions: f.additions,
            deletions: f.deletions,
          }));
          setFiles(summaries);
          clearFileCache();
        } catch (err) {
          console.warn('Failed to refresh MR data on event:', err);
        }
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [mrId]);

  // Handle file selection with view state preservation
  const handleFileSelect = useCallback((filePath: string) => {
    // Save current view state (scroll, cursor, collapsed regions) before switching
    if (previousFileRef.current && diffViewerRef.current) {
      const viewState = diffViewerRef.current.saveViewState();
      if (viewState) {
        viewStatesRef.current.set(previousFileRef.current, viewState);
      }
    }

    setSelectedFile(filePath);
    // Restore collapse state from saved view state, or default to 'collapsed'
    const savedState = viewStatesRef.current.get(filePath);
    setCollapseState(savedState ? 'partial' : 'collapsed');
    previousFileRef.current = filePath;

    const index = files.findIndex((f) => f.newPath === filePath);
    if (index >= 0) {
      setFileFocusIndex(index);
    }
  }, [files]);

  // Restore view state (scroll, cursor, collapsed regions) after content loads
  useEffect(() => {
    if (!fileContentLoading && selectedFile && diffViewerRef.current) {
      const savedState = viewStatesRef.current.get(selectedFile);
      if (savedState) {
        // Small delay to ensure editor is rendered and diff computed
        requestAnimationFrame(() => {
          diffViewerRef.current?.restoreViewState(savedState);
        });
      }
    }
  }, [fileContentLoading, selectedFile, fileContent]);

  // Restore view state after view mode toggle (split ↔ unified)
  useEffect(() => {
    const state = pendingViewStateRef.current;
    if (!state || !diffViewerRef.current) return;
    pendingViewStateRef.current = null;
    // Delay to allow Monaco to reconfigure after renderSideBySide change
    requestAnimationFrame(() => {
      diffViewerRef.current?.restoreViewState(state);
    });
  }, [viewMode]);

  // Clear view states and file content cache when MR changes
  useEffect(() => {
    viewStatesRef.current.clear();
    previousFileRef.current = null;
    clearFileCache();
  }, [mrId, clearFileCache]);

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

  // Collapse unchanged regions
  const handleCollapseUnchanged = useCallback(() => {
    diffViewerRef.current?.collapseUnchanged();
    setCollapseState('collapsed');
  }, []);

  // Expand all regions
  const handleExpandAll = useCallback(() => {
    diffViewerRef.current?.expandAll();
    setCollapseState('expanded');
  }, []);

  // Navigate to next/previous reviewable file
  const navigateFile = useCallback(
    (direction: 1 | -1) => {
      if (reviewableFiles.length === 0) return;

      // Find current position in reviewable list
      const currentReviewableIndex = reviewableFiles.findIndex(
        (f) => f.newPath === selectedFile
      );

      let nextReviewableIndex: number;
      if (currentReviewableIndex === -1) {
        // Current file is generated or none selected — go to first/last reviewable
        nextReviewableIndex = direction === 1 ? 0 : reviewableFiles.length - 1;
      } else {
        nextReviewableIndex = currentReviewableIndex + direction;
        // Wrap around
        if (nextReviewableIndex < 0) nextReviewableIndex = reviewableFiles.length - 1;
        if (nextReviewableIndex >= reviewableFiles.length) nextReviewableIndex = 0;
      }

      const nextFile = reviewableFiles[nextReviewableIndex];
      // Update focus index in the full file list for FileNavigation visual focus
      const fullIndex = files.findIndex((f) => f.newPath === nextFile.newPath);
      if (fullIndex >= 0) {
        setFileFocusIndex(fullIndex);
      }
      setSelectedFile(nextFile.newPath);
    },
    [reviewableFiles, files, selectedFile]
  );

  // Mark current file as viewed and go to next file
  const markViewedAndNext = useCallback(() => {
    if (selectedFile) {
      setViewedPaths((prev) => new Set(prev).add(selectedFile));
      navigateFile(1);
    }
  }, [selectedFile, navigateFile]);

  // Callback for when a comment is added via the overlay
  const handleCommentAdded = useCallback((comment: LineComment) => {
    setFileComments((prev) => [...prev, comment]);
  }, []);

  // Keyboard navigation — ref pattern avoids listener churn
  const keydownRef = useRef<(e: KeyboardEvent) => void>(undefined);
  keydownRef.current = (e: KeyboardEvent) => {
    // Ignore if typing in an input or Monaco comment editor
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (commentOverlayRef.current?.isVisible() && e.key !== 'Escape')
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
        // Toggle unified/split view, preserving collapse state
        e.preventDefault();
        if (diffViewerRef.current) {
          pendingViewStateRef.current = diffViewerRef.current.saveViewState();
        }
        setViewMode((prev) => prev === 'unified' ? 'split' : 'unified');
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
      case 'y':
        // Copy MR link to clipboard
        e.preventDefault();
        if (mr?.webUrl) {
          copyToClipboard(mr.webUrl);
        }
        break;
      case 'v':
        // Mark file as viewed and go to next
        e.preventDefault();
        markViewedAndNext();
        break;
      case 'g':
        // Toggle generated files visibility in file tree
        e.preventDefault();
        setHideGenerated((prev) => !prev);
        break;
      case 'c':
        // Open comment input at current line
        e.preventDefault();
        if (selectedFile) {
          const pos = diffViewerRef.current?.getCursorPosition();
          const sel = diffViewerRef.current?.getSelectedLines() ?? null;
          if (pos) {
            commentOverlayRef.current?.open(pos, sel);
          }
        }
        break;
      case 's':
        // Open comment input with suggestion template
        e.preventDefault();
        if (selectedFile) {
          const sel = diffViewerRef.current?.getSelectedLines();
          const pos = diffViewerRef.current?.getCursorPosition();
          if (pos && sel && !sel.isOriginal) {
            const linesAbove = 0;
            const linesBelow = sel.endLine - sel.startLine;
            const suggestionText = `\`\`\`suggestion:-${linesAbove}+${linesBelow}\n${sel.text}\n\`\`\`\n`;
            const cursorPos = { line: sel.startLine, isOriginal: false };
            commentOverlayRef.current?.open(cursorPos, sel, suggestionText);
          } else if (pos) {
            const singleSel = diffViewerRef.current?.getSelectedLines();
            const lineText = singleSel?.text ?? '';
            const suggestionText = `\`\`\`suggestion:-0+0\n${lineText}\n\`\`\`\n`;
            commentOverlayRef.current?.open(pos, singleSel ?? null, suggestionText);
          }
        }
        break;
      case 'Escape':
        // Close comment overlay if visible, otherwise go back
        // Skip if a modal (e.g. keyboard help) is open — let it handle its own Escape
        if (commentOverlayRef.current?.isVisible()) {
          e.preventDefault();
          commentOverlayRef.current.close();
        } else if (!document.querySelector('.keyboard-help-overlay')) {
          navigate('/mrs', { state: { focusLatest: true } });
        }
        break;
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => keydownRef.current?.(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
          {updateAvailable && (
            <span className="mr-update-tag">Update available</span>
          )}
          <ApprovalButton
            ref={approvalButtonRef}
            mrId={mrId}
            projectId={mr.projectId}
            mrIid={mr.iid}
            approvalStatus={mr.approvalStatus}
            approvalsCount={mr.approvalsCount ?? 0}
            approvalsRequired={mr.approvalsRequired ?? 1}
            hasApproved={mr.userHasApproved}
            onApprovalChange={(approved) => {
              if (approved) navigate('/mrs');
            }}
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
            generatedPaths={generatedPaths}
            hideGenerated={hideGenerated}
            onToggleHideGenerated={() => setHideGenerated((prev) => !prev)}
          />
        </aside>

        <main className="mr-detail-main">
          {selectedFile ? (
            <>
              {/* Loading overlay — sits on top of the editor, doesn't unmount it */}
              {fileContentLoading && (
                <div className="file-loading-overlay">
                  <div className="file-loading-spinner" />
                </div>
              )}

              {/* Error overlay */}
              {fileContentError && !fileContentLoading && (
                <div className="file-loading-overlay">
                  <div className="file-error">
                    <p>{fileContentError}</p>
                    <button onClick={() => handleFileSelect(selectedFile)}>Retry</button>
                  </div>
                </div>
              )}

              {/* No diff refs overlay */}
              {!fileContentError && !fileContentLoading && !diffRefs && (
                <div className="file-loading-overlay">
                  <div className="file-error">
                    <p>Diff information not available. Please sync the merge request first.</p>
                  </div>
                </div>
              )}

              {/* Image diff viewer (mounts/unmounts freely — images render instantly) */}
              {isImageFile(selectedFile) && !fileContentLoading && !fileContentError && diffRefs && (
                <ImageDiffViewer
                  originalBase64={imageContent.originalBase64}
                  modifiedBase64={imageContent.modifiedBase64}
                  filePath={selectedFile}
                  mimeType={getImageMimeType(selectedFile)}
                />
              )}

              {/* Monaco diff wrapper — always mounted, hidden when viewing images */}
              <div
                className="monaco-diff-wrapper"
                style={{ display: isImageFile(selectedFile) ? 'none' : undefined }}
              >
                <div className="diff-toolbar">
                  <button
                    className="diff-toolbar-btn"
                    onClick={handleCollapseUnchanged}
                    disabled={collapseState === 'collapsed'}
                    title="Collapse unchanged regions"
                  >
                    Collapse unchanged
                  </button>
                  <button
                    className="diff-toolbar-btn"
                    onClick={handleExpandAll}
                    disabled={collapseState === 'expanded'}
                    title="Expand all regions"
                  >
                    Expand all
                  </button>
                </div>
                <MonacoDiffViewer
                  ref={diffViewerRef}
                  originalContent={fileContent.original}
                  modifiedContent={fileContent.modified}
                  filePath={selectedFile}
                  viewMode={viewMode}
                  comments={fileComments}
                />
              </div>
            </>
          ) : files.length > 0 && reviewableFiles.length === 0 ? (
            <div className="all-generated-empty-state">
              <div className="all-generated-icon">~</div>
              <p className="all-generated-message">Nothing to see here &mdash; the robots wrote all of this.</p>
              <p className="all-generated-hint">Click any file in the sidebar to peek anyway.</p>
            </div>
          ) : (
            <div className="no-file-selected">
              Select a file to view its diff
            </div>
          )}
        </main>
      </div>

      <CommentOverlay
        ref={commentOverlayRef}
        mrId={mrId}
        selectedFile={selectedFile}
        onCommentAdded={handleCommentAdded}
      />

      {showCopyToast && (
        <div className="copy-toast">Link copied</div>
      )}

      <footer className="mr-detail-footer">
        <span className="keyboard-hint">
          <kbd>c</kbd> comment &middot;{' '}
          <kbd>s</kbd> suggest &middot;{' '}
          <kbd>y</kbd> copy link &middot;{' '}
          <kbd>?</kbd> help
        </span>
      </footer>
    </div>
  );
}
