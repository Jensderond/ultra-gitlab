/**
 * Activity feed component rendering discussion threads inside the ActivityDrawer.
 *
 * Displays grouped comment threads with author, timestamp, body, file info,
 * and resolved/unresolved visual distinction.
 */

import { useMemo } from 'react';
import type { Comment } from '../../types';
import './ActivityFeed.css';

interface ActivityFeedProps {
  threads: Comment[][];
  systemEvents: Comment[];
  showSystemEvents: boolean;
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

export default function ActivityFeed({ threads, systemEvents, showSystemEvents, loading }: ActivityFeedProps) {
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
          <ThreadCard key={`thread-${item.thread[0].id}`} thread={item.thread} />
        ) : (
          <SystemEventEntry key={`event-${item.event.id}`} event={item.event} />
        )
      )}
    </div>
  );
}
