/**
 * Main diff viewer container component.
 *
 * Displays syntax-highlighted diffs with virtual scrolling
 * for performance with large files. Supports inline comments.
 *
 * For large diffs (>10k lines), uses progressive loading to
 * fetch hunks on-demand as the user scrolls.
 */

import { useDiffData } from './useDiffData';
import { useDiffComments } from './useDiffComments';
import { useDiffKeyboard } from './useDiffKeyboard';
import DiffHeader from './DiffHeader';
import DiffContent from './DiffContent';
import './DiffViewer.css';

interface DiffViewerProps {
  /** Merge request ID */
  mrId: number;
  /** Project ID for API calls */
  projectId: number;
  /** MR IID for API calls */
  mrIid: number;
  /** File path to display */
  filePath: string;
  /** Current user's username */
  currentUser?: string;
  /** View mode: unified or split */
  viewMode?: 'unified' | 'split';
  /** Callback when view mode changes */
  onViewModeChange?: (mode: 'unified' | 'split') => void;
  /** Base SHA for inline comments */
  baseSha?: string;
  /** Head SHA for inline comments */
  headSha?: string;
  /** Start SHA for inline comments */
  startSha?: string;
}

export default function DiffViewer({
  mrId,
  projectId,
  mrIid,
  filePath,
  currentUser,
  viewMode = 'unified',
  onViewModeChange,
  baseSha,
  headSha,
  startSha,
}: DiffViewerProps) {
  const {
    loading,
    error,
    metadata,
    isLargeDiff,
    loadingHunks,
    selectedHunk,
    selectedLine,
    effectiveHunks,
    handleScroll,
    handleLineClick,
  } = useDiffData({ mrId, filePath });

  const {
    commentsByLine,
    addingCommentAt,
    isSubmitting,
    handleAddComment,
    startAddingComment,
    cancelAddingComment,
  } = useDiffComments({
    mrId,
    projectId,
    mrIid,
    filePath,
    currentUser,
    baseSha,
    headSha,
    startSha,
    effectiveHunks,
  });

  useDiffKeyboard({
    effectiveHunks,
    selectedHunk,
    selectedLine,
    addingCommentAt,
    viewMode,
    onLineSelect: handleLineClick,
    onStartComment: startAddingComment,
    onCancelComment: cancelAddingComment,
    onViewModeChange,
  });

  if (loading) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-loading">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-error">{error}</div>
      </div>
    );
  }

  if (effectiveHunks.length === 0) {
    return (
      <div className="diff-viewer">
        <div className="diff-viewer-empty">No changes in this file</div>
      </div>
    );
  }

  return (
    <div className="diff-viewer">
      <DiffHeader
        filePath={filePath}
        isLargeDiff={isLargeDiff}
        metadata={metadata}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
      />
      <DiffContent
        effectiveHunks={effectiveHunks}
        isLargeDiff={isLargeDiff}
        loadingHunks={loadingHunks}
        selectedHunk={selectedHunk}
        selectedLine={selectedLine}
        viewMode={viewMode}
        commentsByLine={commentsByLine}
        addingCommentAt={addingCommentAt}
        isSubmitting={isSubmitting}
        onLineClick={handleLineClick}
        onSubmitComment={handleAddComment}
        onCancelComment={cancelAddingComment}
        onScroll={handleScroll}
      />
    </div>
  );
}
