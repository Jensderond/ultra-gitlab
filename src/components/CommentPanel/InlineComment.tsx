/**
 * Inline comment component for showing comments at specific diff lines.
 *
 * Displayed below a diff line to show comments at that position.
 */

import type { Comment, SyncStatus } from '../../types';
import CommentInput from './CommentInput';
import './InlineComment.css';

interface InlineCommentProps {
  /** Comments at this line position */
  comments: Comment[];
  /** Whether adding a new comment at this line */
  isAddingComment?: boolean;
  /** Current user's username */
  currentUser?: string;
  /** Called when submitting a new comment */
  onSubmitComment?: (body: string) => void;
  /** Called when canceling comment input */
  onCancelComment?: () => void;
  /** Called when replying to a comment */
  onReply?: (commentId: number, discussionId: string, body: string) => void;
  /** Called when resolving/unresolving */
  onResolve?: (discussionId: string, resolved: boolean) => void;
  /** Whether submitting */
  isSubmitting?: boolean;
}

/**
 * Format relative time.
 */
function formatTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Sync status badge.
 */
function SyncBadge({ status }: { status: SyncStatus | null }) {
  if (!status || status === 'synced') return null;

  return (
    <span className={`inline-comment-sync sync-${status}`}>
      {status === 'pending' ? 'Pending' : 'Failed'}
    </span>
  );
}

/**
 * Single comment display.
 */
function CommentDisplay({ comment }: { comment: Comment }) {
  return (
    <div className={`inline-comment-item ${comment.isLocal ? 'is-local' : ''}`}>
      <div className="inline-comment-header">
        <span className="inline-comment-author">{comment.authorUsername}</span>
        <span className="inline-comment-time">{formatTime(comment.createdAt)}</span>
        <SyncBadge status={comment.syncStatus} />
      </div>
      <div className="inline-comment-body">{comment.body}</div>
    </div>
  );
}

/**
 * Inline comment component.
 */
export default function InlineComment({
  comments,
  isAddingComment = false,
  onSubmitComment,
  onCancelComment,
  onReply,
  onResolve,
  isSubmitting = false,
}: InlineCommentProps) {
  // Group comments by discussion
  const byDiscussion = new Map<string, Comment[]>();
  const standaloneComments: Comment[] = [];

  for (const comment of comments) {
    if (comment.discussionId) {
      const existing = byDiscussion.get(comment.discussionId) ?? [];
      existing.push(comment);
      byDiscussion.set(comment.discussionId, existing);
    } else {
      standaloneComments.push(comment);
    }
  }

  // Show nothing if no comments and not adding
  if (comments.length === 0 && !isAddingComment) {
    return null;
  }

  return (
    <div className="inline-comment-container">
      {/* Existing discussions */}
      {Array.from(byDiscussion.entries()).map(([discussionId, threadComments]) => {
        const sortedComments = [...threadComments].sort((a, b) => a.createdAt - b.createdAt);
        const rootComment = sortedComments[0];
        const replies = sortedComments.slice(1);
        const isResolved = threadComments.some((c) => c.resolved);

        return (
          <div
            key={discussionId}
            className={`inline-comment-thread ${isResolved ? 'is-resolved' : ''}`}
          >
            <CommentDisplay comment={rootComment} />

            {replies.map((reply) => (
              <div key={reply.id} className="inline-comment-reply">
                <CommentDisplay comment={reply} />
              </div>
            ))}

            <div className="inline-comment-actions">
              {onResolve && (
                <button
                  type="button"
                  className="inline-comment-action"
                  onClick={() => onResolve(discussionId, !isResolved)}
                >
                  {isResolved ? 'Unresolve' : 'Resolve'}
                </button>
              )}
              {onReply && !isResolved && (
                <button
                  type="button"
                  className="inline-comment-action"
                  onClick={() => {
                    const body = prompt('Reply:');
                    if (body && rootComment) {
                      onReply(rootComment.id, discussionId, body);
                    }
                  }}
                >
                  Reply
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Standalone comments (no discussion) */}
      {standaloneComments.map((comment) => (
        <div key={comment.id} className="inline-comment-standalone">
          <CommentDisplay comment={comment} />
        </div>
      ))}

      {/* New comment input */}
      {isAddingComment && onSubmitComment && (
        <div className="inline-comment-new">
          <CommentInput
            placeholder="Add a comment..."
            autoFocus
            onSubmit={onSubmitComment}
            onCancel={onCancelComment}
            isSubmitting={isSubmitting}
          />
        </div>
      )}
    </div>
  );
}
