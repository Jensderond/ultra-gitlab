/**
 * Comment thread component for displaying a discussion thread.
 *
 * Shows comments in chronological order with sync status indicators.
 */

import type { Comment, SyncStatus } from '../../types';
import CommentInput from './CommentInput';
import './CommentThread.css';

interface CommentThreadProps {
  /** Comments in this thread */
  comments: Comment[];
  /** Discussion ID for this thread */
  discussionId: string | null;
  /** Whether thread is resolved */
  resolved: boolean;
  /** Whether replies can be added */
  canReply?: boolean;
  /** Whether thread can be resolved */
  canResolve?: boolean;
  /** Current user for authoring */
  currentUser?: string;
  /** Called when replying to the thread */
  onReply?: (body: string) => void;
  /** Called when resolving/unresolving */
  onResolve?: (resolved: boolean) => void;
  /** Called when deleting a comment */
  onDelete?: (commentId: number) => void;
  /** Whether a reply is being submitted */
  isReplying?: boolean;
}

/**
 * Format a timestamp to relative time.
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Get sync status indicator.
 */
function SyncStatusBadge({ status }: { status: SyncStatus | null }) {
  if (!status || status === 'synced') return null;

  return (
    <span className={`sync-badge sync-${status}`}>
      {status === 'pending' && '⏳ Pending'}
      {status === 'failed' && '⚠️ Failed'}
    </span>
  );
}

/**
 * Single comment item.
 */
function CommentItem({
  comment,
  currentUser,
  onDelete,
}: {
  comment: Comment;
  currentUser?: string;
  onDelete?: (commentId: number) => void;
}) {
  const canDelete = currentUser && comment.authorUsername === currentUser;

  return (
    <div className={`comment-item ${comment.isLocal ? 'comment-local' : ''}`}>
      <div className="comment-header">
        <span className="comment-author">{comment.authorUsername}</span>
        <span className="comment-time">{formatRelativeTime(comment.createdAt)}</span>
        <SyncStatusBadge status={comment.syncStatus} />
        {canDelete && onDelete && (
          <button
            type="button"
            className="btn-link comment-delete"
            onClick={() => onDelete(comment.id)}
          >
            Delete
          </button>
        )}
      </div>
      <div className="comment-body">{comment.body}</div>
    </div>
  );
}

/**
 * Comment thread component.
 */
export default function CommentThread({
  comments,
  discussionId,
  resolved,
  canReply = true,
  canResolve = true,
  currentUser,
  onReply,
  onResolve,
  onDelete,
  isReplying = false,
}: CommentThreadProps) {
  // Sort by creation time
  const sortedComments = [...comments].sort((a, b) => a.createdAt - b.createdAt);

  // First comment starts the thread
  const rootComment = sortedComments[0];
  const replies = sortedComments.slice(1);

  if (!rootComment) return null;

  return (
    <div className={`comment-thread ${resolved ? 'thread-resolved' : ''}`}>
      <div className="thread-content">
        <CommentItem comment={rootComment} currentUser={currentUser} onDelete={onDelete} />

        {replies.length > 0 && (
          <div className="thread-replies">
            {replies.map((reply) => (
              <CommentItem key={reply.id} comment={reply} currentUser={currentUser} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>

      <div className="thread-actions">
        {canResolve && onResolve && discussionId && (
          <button
            type="button"
            className="btn-link"
            onClick={() => onResolve(!resolved)}
          >
            {resolved ? 'Unresolve' : 'Resolve'}
          </button>
        )}
      </div>

      {canReply && onReply && !resolved && (
        <div className="thread-reply">
          <CommentInput
            placeholder="Reply..."
            submitLabel="Reply"
            onSubmit={onReply}
            isSubmitting={isReplying}
          />
        </div>
      )}
    </div>
  );
}
