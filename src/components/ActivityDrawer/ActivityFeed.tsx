/**
 * Activity feed component rendering discussion threads inside the ActivityDrawer.
 *
 * Displays grouped comment threads with author, timestamp, body, file info,
 * and resolved/unresolved visual distinction.
 */

import type { Comment } from '../../types';
import './ActivityFeed.css';

interface ActivityFeedProps {
  threads: Comment[][];
  loading: boolean;
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

function CommentEntry({ comment }: { comment: Comment }) {
  return (
    <div className="activity-comment" data-testid="activity-comment">
      <div className="activity-comment__meta">
        <span className="activity-comment__author">{comment.authorUsername}</span>
        <span className="activity-comment__time">{formatRelativeTime(comment.createdAt)}</span>
      </div>
      <div className="activity-comment__body">{comment.body}</div>
    </div>
  );
}

function ThreadCard({ thread }: { thread: Comment[] }) {
  const root = thread[0];
  const replies = thread.slice(1);
  const isResolved = root.resolved;
  const isInline = root.filePath !== null;

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
      <CommentEntry comment={root} />
      {replies.length > 0 && (
        <div className="activity-thread__replies" data-testid="activity-thread-replies">
          {replies.map((reply) => (
            <CommentEntry key={reply.id} comment={reply} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ActivityFeed({ threads, loading }: ActivityFeedProps) {
  if (loading) {
    return (
      <div className="activity-feed__loading" data-testid="activity-feed-loading">
        <div className="activity-feed__spinner" />
        Loading comments...
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="activity-feed__empty" data-testid="activity-feed-empty">
        No comments yet
      </div>
    );
  }

  return (
    <div className="activity-feed" data-testid="activity-feed">
      {threads.map((thread) => (
        <ThreadCard key={thread[0].id} thread={thread} />
      ))}
    </div>
  );
}
