/**
 * MR Detail page component.
 *
 * Displays a merge request with file navigation and Pierre diff viewer.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import type { ApprovalButtonRef } from '../../components/Approval';
import type { SnoozeButtonRef } from '../../components/Snooze/SnoozeButton';
import { CommentOverlay, type CommentOverlayRef } from '../../components/CommentOverlay';
import { ActivityDrawer, ActivityFeed, CommentInput } from '../../components/ActivityDrawer';
import { useActivityData } from '../../hooks/useActivityData';
import type { DiffLineClickInfo } from '../../components/PierreDiffViewer';
import type { SelectedLineRange } from '../../components/PierreDiffViewer';
import { useFileContent } from '../../hooks/useFileContent';
import { useCopyToast } from '../../hooks/useCopyToast';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { useBackTo } from '../../hooks/useBackTo';
import { useMRData } from './useMRData';
import { useFileComments } from './useFileComments';
import { useViewReducer } from './viewReducer';
import { useMRKeyboard } from './useMRKeyboard';
import MRHeader from './MRHeader';
import MRDiffContent from './MRDiffContent';
import MRFilePanel from './MRFilePanel';
import MRFooter from './MRFooter';
import { deleteComment } from '../../services/gitlab';
import { openExternalUrl, isIOS } from '../../services/transport';
import { isImageFile } from '../../utils/languageDetection';
import { useHighlighterPreload } from '../../hooks/useHighlighterPreload';
import { buildGitLabSuggestionBlock, computeEditedRegion } from '../../utils/gitlabSuggestions';
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
  const mrId = parseInt(id || '0', 10);

  // The list entry carries its status tab in the URL and its reading position
  // is keyed to it, so returning through history restores both.
  const backToList = useBackTo('/mrs');

  const approvalButtonRef = useRef<ApprovalButtonRef>(null);
  const snoozeButtonRef = useRef<SnoozeButtonRef>(null);
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

  const [editedContent, setEditedContent] = useState<string | null>(null);
  // Bumped when an edit session ends: remounts the diff viewer so pierre's
  // edited document is discarded and the original contents render again.
  const [editSession, setEditSession] = useState(0);
  const editModeRef = useRef(view.editMode);
  editModeRef.current = view.editMode;
  const editedContentRef = useRef(editedContent);
  editedContentRef.current = editedContent;

  // Flag active edit sessions on the document root so App-level hotkeys
  // (keyboard-help `?`) can stay inert — they can't see typing inside the
  // editor's shadow root.
  useEffect(() => {
    if (view.editMode) {
      document.documentElement.dataset.diffEditing = 'true';
      return () => {
        delete document.documentElement.dataset.diffEditing;
      };
    }
  }, [view.editMode]);
  const editReady = useHighlighterPreload(
    view.selectedFile,
    !isIOS && !!view.selectedFile && !isImageFile(view.selectedFile),
  );
  // Normalized like computeEditedRegion, so a CRLF-only difference can't
  // enable Confirm only for confirmEdit to find no region.
  const hasEdits =
    editedContent !== null &&
    editedContent.replace(/\r\n/g, '\n') !== fileContent.modified.replace(/\r\n/g, '\n');

  const enterEditMode = useCallback(() => {
    setEditedContent(null);
    dispatch({ type: 'ENTER_EDIT_MODE' });
  }, [dispatch]);

  // Session teardown must land in the same render as the editMode flip:
  // pierre only discards the edited document when the editing viewer instance
  // is unmounted while still in edit mode. A true→false transition on a
  // mounted instance keeps the edited content rendered.
  const endEditSession = useCallback(() => {
    // No onChange ever fired → pierre's document was never mutated, so skip
    // the remount (it would only throw away the scroll position).
    if (editedContentRef.current !== null) {
      setEditedContent(null);
      setEditSession((s) => s + 1);
    }
    lineSelectionRef.current = null;
  }, []);

  const cancelEditMode = useCallback(() => {
    dispatch({ type: 'EXIT_EDIT_MODE' });
    endEditSession();
  }, [dispatch, endEditSession]);

  const confirmEdit = useCallback(() => {
    if (editedContent === null) return;
    const region = computeEditedRegion(fileContent.modified, editedContent);
    dispatch({ type: 'EXIT_EDIT_MODE' });
    endEditSession();
    if (!region) return;
    const selection = {
      startLine: region.startLine,
      endLine: region.endLine,
      isOriginal: false,
      text: region.replacement,
    };
    const suggestionText = buildGitLabSuggestionBlock({
      startLine: region.startLine,
      endLine: region.endLine,
      text: region.replacement,
    });
    commentOverlayRef.current?.open(
      { line: region.endLine, isOriginal: false },
      selection,
      suggestionText,
    );
  }, [editedContent, fileContent.modified, dispatch, endEditSession]);

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

  // Clear file cache when MR changes; a deep link can swap MRs without
  // unmounting, so also tear down any edit session dangling from the old MR.
  useEffect(() => {
    previousFileRef.current = null;
    clearFileCache();
    if (editModeRef.current) {
      dispatch({ type: 'EXIT_EDIT_MODE' });
      endEditSession();
    }
  }, [mrId, clearFileCache, dispatch, endEditSession]);

  // effectiveViewMode flips with the breakpoint without any dispatch — the
  // one view-mode transition the reducer can't see. Discard the session.
  useEffect(() => {
    if (editModeRef.current) {
      dispatch({ type: 'EXIT_EDIT_MODE' });
      endEditSession();
    }
  }, [isSmallScreen, dispatch, endEditSession]);

  const handleFileSelect = useCallback((filePath: string) => {
    if (editModeRef.current) endEditSession();
    const index = files.findIndex((f) => f.newPath === filePath);
    dispatch({
      type: 'SELECT_FILE',
      path: filePath,
      index: index >= 0 ? index : 0,
      hasSavedState: false,
    });
    previousFileRef.current = filePath;
  }, [files, dispatch, endEditSession]);

  const navigableFiles = view.hideGenerated ? reviewableFiles : files;
  const currentFileIndex = navigableFiles.findIndex((f) => f.newPath === view.selectedFile);

  const navigateFile = useCallback(
    (direction: number) => {
      if (navigableFiles.length === 0) return;
      const currentIdx = navigableFiles.findIndex((f) => f.newPath === view.selectedFile);
      const nextIdx = computeNextFileIndex(currentIdx, direction, navigableFiles.length);
      handleFileSelect(navigableFiles[nextIdx].newPath);
    },
    [navigableFiles, view.selectedFile, handleFileSelect]
  );

  const markViewedAndNext = useCallback(() => {
    if (!view.selectedFile) return;
    dispatch({ type: 'MARK_VIEWED', path: view.selectedFile });
    const currentIdx = navigableFiles.findIndex((f) => f.newPath === view.selectedFile);
    if (currentIdx < navigableFiles.length - 1) {
      navigateFile(1);
    }
  }, [view.selectedFile, dispatch, navigateFile, navigableFiles]);

  const handleToggleViewMode = useCallback(() => {
    if (editModeRef.current) endEditSession();
    dispatch({
      type: 'SET_VIEW_MODE',
      mode: view.viewMode === 'unified' ? 'split' : 'unified',
    });
  }, [view.viewMode, dispatch, endEditSession]);

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

  // Cmd+D toggles activity drawer (skip when focus is in text input/textarea,
  // or while the diff editor is active — its shadow root hides focus from us)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'd') {
        if (editModeRef.current) return;
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
    snoozeButtonRef,
    commentOverlayRef,
    lineSelectionRef,
    onNavigateFile: navigateFile,
    fileJumpCount: settings?.fileJumpCount,
    onToggleViewMode: handleToggleViewMode,
    onMarkViewedAndNext: markViewedAndNext,
    onToggleHideGenerated: () => dispatch({ type: 'TOGGLE_HIDE_GENERATED' }),
    onCopyLink: copyToClipboard,
    onEscapeBack: () => backToList(),
    editMode: view.editMode,
    onExitEditMode: cancelEditMode,
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
          <button onClick={() => backToList()}>Back to list</button>
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
            <button className="mr-state-banner-btn" onClick={() => backToList()}>
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
        snoozeButtonRef={snoozeButtonRef}
        onToggleMobileSidebar={() => dispatch({ type: 'TOGGLE_MOBILE_SIDEBAR' })}
        onBack={backToList}
        onApproved={(trigger) => {
          trackMRApproved(mrId, Math.round((Date.now() - mrEnteredAtRef.current) / 1000), trigger);
          backToList();
        }}
        onUnapproved={(trigger) => trackMRUnapproved(mrId, trigger)}
        hideApproval={isMergedOrClosed}
        unresolvedCount={unresolvedCount}
        onToggleActivity={() => setActivityOpen((o) => !o)}
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
          editMode={view.editMode}
          editReady={editReady}
          hasEdits={hasEdits}
          editSessionKey={editSession}
          onEnterEditMode={enterEditMode}
          onConfirmEdit={confirmEdit}
          onCancelEdit={cancelEditMode}
          onEditContentChange={setEditedContent}
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

      <MRFooter
        fileIndex={currentFileIndex >= 0 ? currentFileIndex : null}
        fileCount={navigableFiles.length}
        onPrevFile={() => navigateFile(-1)}
        onNextFile={() => navigateFile(1)}
        isCurrentFileViewed={view.selectedFile != null && view.viewedPaths.has(view.selectedFile)}
        onMarkViewed={markViewedAndNext}
        mr={mr}
        mrId={mrId}
        isSmallScreen={isSmallScreen}
        approvalButtonRef={approvalButtonRef}
        onApproved={(trigger) => {
          trackMRApproved(mrId, Math.round((Date.now() - mrEnteredAtRef.current) / 1000), trigger);
          backToList();
        }}
        onUnapproved={(trigger) => trackMRUnapproved(mrId, trigger)}
        hideApproval={isMergedOrClosed}
      />
    </div>
  );
}
