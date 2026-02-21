/**
 * Activity feed component rendering discussion threads inside the ActivityDrawer.
 *
 * Displays grouped comment threads with author, timestamp, body, file info,
 * and resolved/unresolved visual distinction.
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Comment, SyncStatus } from '../../types';
import './ActivityFeed.css';

interface ActivityFeedProps {
  threads: Comment[][];
  systemEvents: Comment[];
  showSystemEvents: boolean;
  loading: boolean;
  currentUser?: string | null;
  onReply?: (discussionId: string, parentId: number, body: string) => Promise<void>;
  onResolve?: (discussionId: string, resolved: boolean) => Promise<void>;
  onDelete?: (commentId: number) => Promise<void>;
}

function formatRelativeTime(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins}m ago`;
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / 86400);
  return `${days}d ago`;
}

function SyncBadge({ status }: { status: SyncStatus | null }) {
  if (!status || status === 'synced') return null;

  return (
    <span
      className={`activity-sync-badge activity-sync-badge--${status}`}
      data-testid="activity-sync-badge"
    >
      {status === 'pending' && '⏳ Pending'}
      {status === 'failed' && '⚠️ Failed'}
    </span>
  );
}

interface CommentEntryProps {
  comment: Comment;
  currentUser?: string | null;
  onDelete?: (commentId: number) => Promise<void>;
}

function CommentEntry({ comment, currentUser, onDelete }: CommentEntryProps) {
  const isOwn = currentUser && comment.authorUsername === currentUser;

  const handleDelete = useCallback(() => {
    if (!onDelete) return;
    if (window.confirm('Delete this comment?')) {
      onDelete(comment.id);
    }
  }, [onDelete, comment.id]);

  return (
    <div className="activity-comment" data-testid="activity-comment">
      <div className="activity-comment__meta">
        <span className="activity-comment__author">{comment.authorUsername}</span>
        <span className="activity-comment__time">{formatRelativeTime(comment.createdAt)}</span>
        <SyncBadge status={comment.syncStatus} />
        {isOwn && onDelete && (
          <button
            className="activity-comment__delete"
            onClick={handleDelete}
            title="Delete comment"
            data-testid="activity-delete-btn"
          >
            🗑
          </button>
        )}
      </div>
      <div className="activity-comment__body">{comment.body}</div>
    </div>
  );
}

function ReplyInput({ onSubmit, onCancel }: { onSubmit: (body: string) => Promise<void>; onCancel: () => void }) {
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
    <div className="activity-reply-input" data-testid="activity-reply-input">
      <textarea
        ref={textareaRef}
        className="activity-reply-input__textarea"
        placeholder="Write a reply..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        disabled={submitting}
        data-testid="activity-reply-textarea"
      />
      <div className="activity-reply-input__actions">
        <button
          className="activity-reply-input__cancel"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          className="activity-reply-input__send"
          onClick={handleSubmit}
          disabled={!value.trim() || submitting}
          title="Send (⌘Enter)"
          data-testid="activity-reply-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}

interface ThreadCardProps {
  thread: Comment[];
  isReplying: boolean;
  currentUser?: string | null;
  onStartReply: () => void;
  onCancelReply: () => void;
  onSubmitReply?: (discussionId: string, parentId: number, body: string) => Promise<void>;
  onResolve?: (discussionId: string, resolved: boolean) => Promise<void>;
  onDelete?: (commentId: number) => Promise<void>;
}

function ThreadCard({ thread, isReplying, currentUser, onStartReply, onCancelReply, onSubmitReply, onResolve, onDelete }: ThreadCardProps) {
  const root = thread[0];
  const replies = thread.slice(1);
  const isResolved = root.resolved;
  const isInline = root.filePath !== null;
  const hasDiscussion = root.discussionId !== null;

  const handleReplySubmit = useCallback(
    async (body: string) => {
      if (onSubmitReply && root.discussionId) {
        await onSubmitReply(root.discussionId, root.id, body);
      }
    },
    [onSubmitReply, root.discussionId, root.id],
  );

  const handleResolve = useCallback(() => {
    if (onResolve && root.discussionId) {
      onResolve(root.discussionId, !isResolved);
    }
  }, [onResolve, root.discussionId, isResolved]);

  return (
    <div
      className={`activity-thread ${isResolved ? 'activity-thread--resolved' : ''}`}
      data-testid="activity-thread"
    >
      {isInline && (
        <div className="activity-thread__file-info" data-testid="activity-thread-file-info">
          <span className="activity-thread__file-path">{root.filePath}</span>
          {(root.newLine ?? root.oldLine) !== null && (
            <span className="activity-thread__line-number">
              :{root.newLine ?? root.oldLine}
            </span>
          )}
        </div>
      )}
      <CommentEntry comment={root} currentUser={currentUser} onDelete={onDelete} />
      {replies.length > 0 && (
        <div className="activity-thread__replies" data-testid="activity-thread-replies">
          {replies.map((reply) => (
            <CommentEntry key={reply.id} comment={reply} currentUser={currentUser} onDelete={onDelete} />
          ))}
        </div>
      )}
      <div className="activity-thread__actions">
        {hasDiscussion && onResolve && (
          <button
            className={`activity-thread__resolve-btn ${isResolved ? 'activity-thread__resolve-btn--resolved' : ''}`}
            onClick={handleResolve}
            data-testid="activity-resolve-btn"
          >
            {isResolved ? 'Unresolve' : 'Resolve'}
          </button>
        )}
        {hasDiscussion && !isReplying && (
          <button
            className="activity-thread__reply-btn"
            onClick={onStartReply}
            data-testid="activity-reply-btn"
          >
            Reply
          </button>
        )}
      </div>
      {isReplying && (
        <ReplyInput onSubmit={handleReplySubmit} onCancel={onCancelReply} />
      )}
    </div>
  );
}

type FeedItem =
  | { kind: 'thread'; thread: Comment[]; timestamp: number }
  | { kind: 'event'; event: Comment; timestamp: number };

function SystemEventEntry({ event }: { event: Comment }) {
  return (
    <div className="activity-system-event" data-testid="activity-system-event">
      <span className="activity-system-event__author">{event.authorUsername}</span>
      {' '}
      <span className="activity-system-event__body">{event.body}</span>
      <span className="activity-system-event__time">{formatRelativeTime(event.createdAt)}</span>
    </div>
  );
}

export default function ActivityFeed({ threads, systemEvents, showSystemEvents, loading, currentUser, onReply, onResolve, onDelete }: ActivityFeedProps) {
  const [replyingToThreadRootId, setReplyingToThreadRootId] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="activity-feed__loading" data-testid="activity-feed-loading">
        <div className="activity-feed__spinner" />
        Loading comments...
      </div>
    );
  }

  const hasContent = threads.length > 0 || (showSystemEvents && systemEvents.length > 0);

  if (!hasContent) {
    return (
      <div className="activity-feed__empty" data-testid="activity-feed-empty">
        No comments yet
      </div>
    );
  }

  const feedItems = useMemo((): FeedItem[] => {
    const items: FeedItem[] = threads.map((thread) => ({
      kind: 'thread' as const,
      thread,
      timestamp: thread[0]?.createdAt ?? 0,
    }));

    if (showSystemEvents) {
      for (const event of systemEvents) {
        items.push({ kind: 'event' as const, event, timestamp: event.createdAt });
      }
    }

    // Sort: unresolved threads first, then chronologically
    return items.sort((a, b) => {
      const aIsUnresolvedThread = a.kind === 'thread' && !a.thread.some(c => c.resolved);
      const bIsUnresolvedThread = b.kind === 'thread' && !b.thread.some(c => c.resolved);
      if (aIsUnresolvedThread && !bIsUnresolvedThread) return -1;
      if (!aIsUnresolvedThread && bIsUnresolvedThread) return 1;
      return a.timestamp - b.timestamp;
    });
  }, [threads, systemEvents, showSystemEvents]);

  return (
    <div className="activity-feed" data-testid="activity-feed">
      {feedItems.map((item) =>
        item.kind === 'thread' ? (
          <ThreadCard
            key={`thread-${item.thread[0].id}`}
            thread={item.thread}
            isReplying={replyingToThreadRootId === item.thread[0].id}
            currentUser={currentUser}
            onStartReply={() => setReplyingToThreadRootId(item.thread[0].id)}
            onCancelReply={() => setReplyingToThreadRootId(null)}
            onSubmitReply={onReply}
            onResolve={onResolve}
            onDelete={onDelete}
          />
        ) : (
          <SystemEventEntry key={`event-${item.event.id}`} event={item.event} />
        )
      )}
    </div>
  );
}
