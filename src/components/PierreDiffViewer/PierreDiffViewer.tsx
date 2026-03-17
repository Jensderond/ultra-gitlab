import { MultiFileDiff } from '@pierre/diffs/react';
import type { FileContents } from '@pierre/diffs/react';
import type { DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs';
import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { TrashIcon } from '../icons';
import '../ActivityDrawer/ActivityFeed.css';
import './PierreDiffViewer.css';

/** Comment data attached to a diff line annotation. */
export interface LineComment {
  id: number;
  line: number;
  isOldLine?: boolean;
  authorUsername: string;
  body: string;
  createdAt: number;
  resolved?: boolean;
  discussionId?: string | null;
  replies?: LineComment[];
}

/** Pierre line type for diff lines. */
export type DiffLineType = 'change-deletion' | 'change-addition' | 'context' | 'context-expanded';

/** Info passed when a line number is clicked in the diff. */
export interface DiffLineClickInfo {
  lineNumber: number;
  side: 'old' | 'new';
  lineType: DiffLineType;
  filePath: string;
}

export interface PierreDiffViewerProps {
  /** Original file content (null for new files) */
  oldContent: string | null;
  /** Modified file content (null for deleted files) */
  newContent: string | null;
  /** File path — used for language auto-detection */
  filePath: string;
  /** Split or unified diff view */
  viewMode: 'split' | 'unified';
  /** MR IID for cache key */
  mrIid: number;
  /** Commit SHA for cache key */
  sha: string;
  /** Inline comments to display as line annotations */
  comments?: LineComment[];
  /** Called when a line number is clicked in the diff */
  onLineClick?: (info: DiffLineClickInfo) => void;
  /** Called when the user selects a line range in the diff */
  onLineSelected?: (range: SelectedLineRange | null) => void;
  /** Current user's username (for showing delete button on own comments) */
  currentUser?: string;
  /** Called when a comment delete button is clicked */
  onDeleteComment?: (commentId: number) => void;
  /** Called when the user submits a reply to a discussion thread */
  onReply?: (discussionId: string, parentId: number, body: string) => Promise<void>;
  /** Called when the user resolves/unresolves a discussion thread */
  onResolve?: (discussionId: string, resolved: boolean) => Promise<void>;
}

/** Map LineComment[] to Pierre DiffLineAnnotation<LineComment>[]. */
function toAnnotations(comments: LineComment[]): DiffLineAnnotation<LineComment>[] {
  return comments.map((c) => ({
    side: c.isOldLine ? 'deletions' as const : 'additions' as const,
    lineNumber: c.line,
    metadata: c,
  }));
}

/** Format a Unix timestamp (seconds) as a relative or short date string. */
function formatDate(ts: number): string {
  const date = new Date(ts * 1000);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Single comment entry within an annotation thread. */
function AnnotationComment({
  comment,
  currentUser,
  onDeleteComment,
}: {
  comment: LineComment;
  currentUser?: string;
  onDeleteComment?: (commentId: number) => void;
}) {
  const isOwn = currentUser && comment.authorUsername === currentUser;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = useCallback(() => {
    if (!onDeleteComment) return;
    if (confirmingDelete) {
      setConfirmingDelete(false);
      onDeleteComment(comment.id);
    } else {
      setConfirmingDelete(true);
    }
  }, [onDeleteComment, comment.id, confirmingDelete]);

  return (
    <div className="activity-comment">
      <div className="activity-comment__meta">
        <span className="activity-comment__author">{comment.authorUsername}</span>
        <span className="activity-comment__time">{formatDate(comment.createdAt)}</span>
        {isOwn && onDeleteComment && (
          <button
            className={`activity-comment__delete ${confirmingDelete ? 'activity-comment__delete--confirming' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            onBlur={() => setConfirmingDelete(false)}
            title={confirmingDelete ? 'Click again to confirm' : 'Delete comment'}
          >
            {confirmingDelete ? 'Delete?' : <TrashIcon />}
          </button>
        )}
      </div>
      <div className="activity-comment__body">{comment.body}</div>
    </div>
  );
}

/** Inline reply input for annotation threads. */
function AnnotationReplyInput({ onSubmit, onCancel }: { onSubmit: (body: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const body = value.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(body);
      setValue('');
      onCancel();
    } finally {
      setSubmitting(false);
    }
  }, [value, submitting, onSubmit, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [handleSubmit, onCancel],
  );

  return (
    <div className="activity-reply-input">
      <textarea
        ref={textareaRef}
        className="activity-reply-input__textarea"
        placeholder="Write a reply..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        disabled={submitting}
      />
      <div className="activity-reply-input__actions">
        <button className="activity-reply-input__cancel" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
        <button
          className="activity-reply-input__send"
          onClick={handleSubmit}
          disabled={!value.trim() || submitting}
          title="Send (⌘Enter)"
        >
          Send
        </button>
      </div>
    </div>
  );
}

/** Render a single annotation (comment thread) inline in the diff. */
function AnnotationThread({
  annotation,
  currentUser,
  onDeleteComment,
  onReply,
  onResolve,
}: {
  annotation: DiffLineAnnotation<LineComment>;
  currentUser?: string;
  onDeleteComment?: (commentId: number) => void;
  onReply?: (discussionId: string, parentId: number, body: string) => Promise<void>;
  onResolve?: (discussionId: string, resolved: boolean) => Promise<void>;
}) {
  const root = annotation.metadata;
  const replies = root.replies ?? [];
  const isResolved = root.resolved;
  const hasDiscussion = !!root.discussionId;
  const [replying, setReplying] = useState(false);
  const [collapsed, setCollapsed] = useState(!!isResolved);

  const handleReplySubmit = useCallback(
    async (body: string) => {
      if (onReply && root.discussionId) {
        await onReply(root.discussionId, root.id, body);
      }
    },
    [onReply, root.discussionId, root.id],
  );

  const handleResolve = useCallback(() => {
    if (onResolve && root.discussionId) {
      onResolve(root.discussionId, !isResolved);
      setCollapsed(!isResolved);
    }
  }, [onResolve, root.discussionId, isResolved]);

  return (
    <div
      className={`annotation-thread-wrapper ${isResolved ? 'annotation-thread--resolved' : ''}`}
      style={{ whiteSpace: 'normal', margin: '12px 16px' }}
    >
      <div className="activity-thread">
        {/* Collapsed: clickable summary bar */}
        {collapsed && (
          <div
            className="annotation-thread__header"
            onClick={() => setCollapsed(false)}
          >
            {isResolved && <span className="annotation-thread__resolved-badge">Resolved</span>}
            <span className="annotation-thread__header-author">{root.authorUsername}</span>
            <span className="annotation-thread__header-body">{root.body}</span>
            {replies.length > 0 && (
              <span className="annotation-thread__reply-count">
                {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </span>
            )}
          </div>
        )}
        {!collapsed && (
          /* Expanded state — full thread */
          <>
            <AnnotationComment comment={root} currentUser={currentUser} onDeleteComment={onDeleteComment} />
            {replies.length > 0 && (
              <div className="activity-thread__replies">
                {replies.map((reply) => (
                  <AnnotationComment key={reply.id} comment={reply} currentUser={currentUser} onDeleteComment={onDeleteComment} />
                ))}
              </div>
            )}
            <div className="activity-thread__actions">
              {isResolved && (
                <button
                  className="activity-thread__reply-btn"
                  onClick={(e) => { e.stopPropagation(); setCollapsed(true); }}
                >
                  Collapse
                </button>
              )}
              {hasDiscussion && onResolve && (
                <button
                  className={`activity-thread__resolve-btn ${isResolved ? 'activity-thread__resolve-btn--resolved' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleResolve(); }}
                >
                  {isResolved ? 'Unresolve' : 'Resolve'}
                </button>
              )}
              {hasDiscussion && onReply && !replying && (
                <button
                  className="activity-thread__reply-btn"
                  onClick={(e) => { e.stopPropagation(); setReplying(true); }}
                >
                  Reply
                </button>
              )}
            </div>
            {replying && (
              <AnnotationReplyInput onSubmit={handleReplySubmit} onCancel={() => setReplying(false)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Pierre-based diff viewer component.
 * Renders file diffs with syntax highlighting via web workers.
 */
export function PierreDiffViewer({
  oldContent,
  newContent,
  filePath,
  viewMode,
  mrIid,
  sha,
  comments,
  onLineClick,
  onLineSelected,
  currentUser,
  onDeleteComment,
  onReply,
  onResolve,
}: PierreDiffViewerProps) {
  const [selectedLines, setSelectedLines] = useState<SelectedLineRange | null>(null);

  const handleLineSelected = useCallback(
    (range: SelectedLineRange | null) => {
      setSelectedLines(range);
      onLineSelected?.(range);
    },
    [onLineSelected]
  );

  const oldFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: oldContent ?? '',
      cacheKey: `${mrIid}:${filePath}:${sha}:old`,
    }),
    [filePath, oldContent, mrIid, sha]
  );

  const newFile: FileContents = useMemo(
    () => ({
      name: filePath,
      contents: newContent ?? '',
      cacheKey: `${mrIid}:${filePath}:${sha}:new`,
    }),
    [filePath, newContent, mrIid, sha]
  );

  const handleLineNumberClick = useCallback(
    (props: { lineNumber: number; annotationSide: 'deletions' | 'additions'; lineType: DiffLineType }) => {
      onLineClick?.({
        lineNumber: props.lineNumber,
        side: props.annotationSide === 'deletions' ? 'old' : 'new',
        lineType: props.lineType,
        filePath,
      });
    },
    [onLineClick, filePath]
  );

  const options = useMemo(
    () => ({
      diffStyle: viewMode,
      lineDiffType: 'word' as const,
      expandUnchanged: false,
      themeType: 'system' as const,
      onLineNumberClick: onLineClick ? handleLineNumberClick : undefined,
      enableLineSelection: true,
      onLineSelected: handleLineSelected,
    }),
    [viewMode, onLineClick, handleLineNumberClick, handleLineSelected]
  );

  const lineAnnotations = useMemo(
    () => comments && comments.length > 0 ? toAnnotations(comments) : undefined,
    [comments]
  );

  // Stable refs so the render callback doesn't trigger re-renders
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const onDeleteRef = useRef(onDeleteComment);
  onDeleteRef.current = onDeleteComment;
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const onResolveRef = useRef(onResolve);
  onResolveRef.current = onResolve;

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<LineComment>) => (
      <AnnotationThread
        annotation={annotation}
        currentUser={currentUserRef.current}
        onDeleteComment={onDeleteRef.current}
        onReply={onReplyRef.current}
        onResolve={onResolveRef.current}
      />
    ),
    []
  );

  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={options}
      lineAnnotations={lineAnnotations}
      renderAnnotation={lineAnnotations ? renderAnnotation : undefined}
      selectedLines={selectedLines}
    />
  );
}

export default PierreDiffViewer;
