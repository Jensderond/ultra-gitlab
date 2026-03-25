/**
 * MR Detail page component.
 *
 * Displays a merge request with file navigation and Pierre diff viewer.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { ApprovalButtonRef } from '../../components/Approval';
import { CommentOverlay, type CommentOverlayRef } from '../../components/CommentOverlay';
import { ActivityDrawer, ActivityFeed, CommentInput } from '../../components/ActivityDrawer';
import { useActivityData } from '../../hooks/useActivityData';
import type { DiffLineClickInfo } from '../../components/PierreDiffViewer';
import type { SelectedLineRange } from '../../components/PierreDiffViewer';
import { useFileContent } from '../../hooks/useFileContent';
import { useCopyToast } from '../../hooks/useCopyToast';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { useMRData } from './useMRData';
import { useFileComments } from './useFileComments';
import { useViewReducer } from './viewReducer';
import { useMRKeyboard } from './useMRKeyboard';
import MRHeader from './MRHeader';
import MRDiffContent from './MRDiffContent';
import MRFilePanel from './MRFilePanel';
import MRFooter from './MRFooter';
import { deleteComment } from '../../services/gitlab';
import { openExternalUrl } from '../../services/transport';
import { useCurrentUserQuery } from '../../hooks/queries/useCurrentUserQuery';
import { useSettingsQuery } from '../../hooks/queries/useSettingsQuery';
import { trackMRApproved, trackMRUnapproved, trackCommentPosted, trackReplyPosted } from '../../services/analytics';
import { computeNextFileIndex } from '../../utils/fileNavigation';
import '../MRDetailPage.css';

interface MRDetailPageProps {
  updateAvailable?: boolean;
}

export default function MRDetailPage({ updateAvailable }: MRDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mrId = parseInt(id || '0', 10);

  const approvalButtonRef = useRef<ApprovalButtonRef>(null);
  const commentOverlayRef = useRef<CommentOverlayRef>(null);
  const mrEnteredAtRef = useRef(Date.now());
  const lineSelectionRef = useRef<SelectedLineRange | null>(null);
  const previousFileRef = useRef<string | null>(null);

  const [activityOpen, setActivityOpen] = useState(false);
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [activityHeightVh, setActivityHeightVh] = useState(40);
  const { threads: activityThreads, systemEvents: activitySystemEvents, unresolvedCount, currentUser: activityCurrentUser, loading: activityLoading, error: activityError, addComment: activityAddComment, replyToComment: activityReplyToComment, resolveDiscussion: activityResolveDiscussion, deleteComment: activityDeleteComment } = useActivityData(mrId);
  const [showCopyToast, copyToClipboard] = useCopyToast();
  const isSmallScreen = useSmallScreen();
  const [view, dispatch] = useViewReducer();

  const effectiveViewMode = isSmallScreen ? 'unified' : view.viewMode;

  // File content hook needs clearFileCache; define a stable ref for it
  const clearFileCacheRef = useRef<() => void>(() => {});

  const { mr, files, diffRefs, generatedPaths, loading, error, initialReviewableFile } =
    useMRData(mrId, clearFileCacheRef.current);

  const reviewableFiles = useMemo(
    () => files.filter((f) => !generatedPaths.has(f.newPath)),
    [files, generatedPaths]
  );

  const {
    content: fileContent,
    imageContent,
    isLoading: fileContentLoading,
    error: fileContentError,
    clearCache: clearFileCache,
  } = useFileContent(mrId, mr, diffRefs, files, view.selectedFile, reviewableFiles);

  // Wire up the stable ref so useMRData can call clearFileCache
  clearFileCacheRef.current = clearFileCache;

  const { data: settings } = useSettingsQuery();
  const { fileComments, removeComment, restoreComment } = useFileComments(mrId, view.selectedFile);

  const currentUserQuery = useCurrentUserQuery(mr?.instanceId ?? 0);
  const currentUser = currentUserQuery.data ?? null;

  const handleDeleteComment = useCallback((commentId: number) => {
    const toRestore = fileComments.find((c) => c.id === commentId);
    removeComment(commentId);
    deleteComment(mrId, commentId).catch(() => {
      if (toRestore) restoreComment(toRestore);
    });
  }, [mrId, fileComments, removeComment, restoreComment]);

  // Auto-select first reviewable file on initial load
  const appliedInitialRef = useRef(false);
  if (initialReviewableFile && !view.selectedFile && !appliedInitialRef.current) {
    appliedInitialRef.current = true;
    dispatch({
      type: 'SELECT_FILE',
      path: initialReviewableFile.path,
      index: initialReviewableFile.index,
      hasSavedState: false,
    });
    previousFileRef.current = initialReviewableFile.path;
  }

  // Reset applied flag when MR changes
  const prevMrIdRef = useRef(mrId);
  if (prevMrIdRef.current !== mrId) {
    prevMrIdRef.current = mrId;
    appliedInitialRef.current = false;
  }

  // Clear file cache when MR changes
  useEffect(() => {
    previousFileRef.current = null;
    clearFileCache();
  }, [mrId, clearFileCache]);

  const handleFileSelect = useCallback((filePath: string) => {
    const index = files.findIndex((f) => f.newPath === filePath);
    dispatch({
      type: 'SELECT_FILE',
      path: filePath,
      index: index >= 0 ? index : 0,
      hasSavedState: false,
    });
    previousFileRef.current = filePath;
  }, [files, dispatch]);

  const navigateFile = useCallback(
    (direction: number) => {
      if (reviewableFiles.length === 0) return;
      const currentIdx = reviewableFiles.findIndex((f) => f.newPath === view.selectedFile);
      const nextIdx = computeNextFileIndex(currentIdx, direction, reviewableFiles.length);
      handleFileSelect(reviewableFiles[nextIdx].newPath);
    },
    [reviewableFiles, view.selectedFile, handleFileSelect]
  );

  const markViewedAndNext = useCallback(() => {
    if (!view.selectedFile) return;
    dispatch({ type: 'MARK_VIEWED', path: view.selectedFile });
    const currentIdx = reviewableFiles.findIndex((f) => f.newPath === view.selectedFile);
    if (currentIdx < reviewableFiles.length - 1) {
      navigateFile(1);
    }
  }, [view.selectedFile, dispatch, navigateFile, reviewableFiles]);

  const handleToggleViewMode = useCallback(() => {
    dispatch({
      type: 'SET_VIEW_MODE',
      mode: view.viewMode === 'unified' ? 'split' : 'unified',
    });
  }, [view.viewMode, dispatch]);

  const handleLineClick = useCallback((info: DiffLineClickInfo) => {
    const isContext = info.lineType === 'context' || info.lineType === 'context-expanded';
    commentOverlayRef.current?.open(
      { line: info.lineNumber, isOriginal: info.side === 'old', isContext },
      null,
    );
  }, []);

  const handleLineSelected = useCallback((range: SelectedLineRange | null) => {
    lineSelectionRef.current = range;
  }, []);

  // Cmd+D toggles activity drawer (skip when focus is in text input/textarea)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'd') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setActivityOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useMRKeyboard({
    selectedFile: view.selectedFile,
    fileContent,
    isSmallScreen,
    webUrl: mr?.webUrl,
    approvalButtonRef,
    commentOverlayRef,
    lineSelectionRef,
    onNavigateFile: navigateFile,
    fileJumpCount: settings?.fileJumpCount,
    onToggleViewMode: handleToggleViewMode,
    onMarkViewedAndNext: markViewedAndNext,
    onToggleHideGenerated: () => dispatch({ type: 'TOGGLE_HIDE_GENERATED' }),
    onCopyLink: copyToClipboard,
    onEscapeBack: () => navigate('/mrs', { state: { focusLatest: true } }),
  });

  if (loading) {
    return (
      <div className="mr-detail-page">
        <div className="mr-detail-loading">Loading merge request...</div>
      </div>
    );
  }

  if ((error && !mr) || !mr) {
    return (
      <div className="mr-detail-page">
        <div className="mr-detail-error">
          <p>{error || 'Merge request not found'}</p>
          <button onClick={() => navigate('/mrs')}>Back to list</button>
        </div>
      </div>
    );
  }

  const isMergedOrClosed = mr.state === 'merged' || mr.state === 'closed';

  return (
    <div className="mr-detail-page">
      {isMergedOrClosed && (
        <div className={`mr-state-banner ${mr.state}`}>
          <span>
            This merge request has been {mr.state === 'closed' ? 'closed' : 'merged'}
          </span>
          <div className="mr-state-banner-actions">
            {mr.webUrl && (
              <button className="mr-state-banner-btn" onClick={() => openExternalUrl(mr.webUrl)}>
                Open in GitLab
              </button>
            )}
            <button className="mr-state-banner-btn" onClick={() => navigate('/mrs')}>
              Back to list
            </button>
          </div>
        </div>
      )}

      <MRHeader
        mr={mr}
        mrId={mrId}
        updateAvailable={updateAvailable}
        isSmallScreen={isSmallScreen}
        fileCount={files.length}
        approvalButtonRef={approvalButtonRef}
        onToggleMobileSidebar={() => dispatch({ type: 'TOGGLE_MOBILE_SIDEBAR' })}
        onApproved={(trigger) => {
          trackMRApproved(mrId, Math.round((Date.now() - mrEnteredAtRef.current) / 1000), trigger);
          navigate('/mrs');
        }}
        onUnapproved={(trigger) => trackMRUnapproved(mrId, trigger)}
      />

      <div className="mr-detail-content">
        <MRFilePanel
          files={files}
          selectedPath={view.selectedFile}
          focusIndex={view.fileFocusIndex}
          viewedPaths={view.viewedPaths}
          generatedPaths={generatedPaths}
          hideGenerated={view.hideGenerated}
          mobileSidebarOpen={view.mobileSidebarOpen}
          isSmallScreen={isSmallScreen}
          onSelect={handleFileSelect}
          onToggleHideGenerated={() => dispatch({ type: 'TOGGLE_HIDE_GENERATED' })}
          onCloseMobileSidebar={() => dispatch({ type: 'CLOSE_MOBILE_SIDEBAR' })}
        />

        <MRDiffContent
          selectedFile={view.selectedFile}
          files={files}
          reviewableFiles={reviewableFiles}
          diffRefs={diffRefs}
          fileContent={fileContent}
          imageContent={imageContent}
          fileContentLoading={fileContentLoading}
          fileContentError={fileContentError}
          viewMode={effectiveViewMode}
          mrIid={mr.iid}
          instanceId={mr.instanceId}
          comments={fileComments}
          onLineClick={handleLineClick}
          onLineSelected={handleLineSelected}
          onRetry={() => view.selectedFile && handleFileSelect(view.selectedFile)}
          currentUser={currentUser ?? undefined}
          onDeleteComment={handleDeleteComment}
          onReply={async (discussionId, parentId, body) => { await activityReplyToComment(discussionId, parentId, body); trackReplyPosted(mrId); }}
          onResolve={activityResolveDiscussion}
          bottomPadding={activityOpen ? activityHeightVh : undefined}
        />
      </div>

      <CommentOverlay
        ref={commentOverlayRef}
        mrId={mrId}
        selectedFile={view.selectedFile}
      />

      <ActivityDrawer
        isOpen={activityOpen}
        onToggle={() => setActivityOpen((o) => !o)}
        showSystemEvents={showSystemEvents}
        onToggleSystemEvents={() => setShowSystemEvents((s) => !s)}
        heightVh={activityHeightVh}
        onHeightChange={setActivityHeightVh}
        footer={<CommentInput onSubmit={async (body) => { await activityAddComment(body); trackCommentPosted(mrId); }} />}
      >
        <ActivityFeed
          threads={activityThreads}
          systemEvents={activitySystemEvents}
          showSystemEvents={showSystemEvents}
          loading={activityLoading}
          error={activityError}
          currentUser={activityCurrentUser}
          onReply={async (discussionId, parentId, body) => { await activityReplyToComment(discussionId, parentId, body); trackReplyPosted(mrId); }}
          onResolve={activityResolveDiscussion}
          onDelete={activityDeleteComment}
        />
      </ActivityDrawer>

      {showCopyToast && (
        <div className="copy-toast">Link copied</div>
      )}

      <MRFooter unresolvedCount={unresolvedCount} onToggleActivity={() => setActivityOpen((o) => !o)} />
    </div>
  );
}
