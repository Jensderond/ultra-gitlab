/**
 * Comments tab for MyMRDetailPage — discussion threads.
 */

import { formatRelativeTime } from './utils';
import type { Comment } from '../../types';

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

interface CommentsTabProps {
  threads: Comment[][];
  currentUser?: string | null;
  onDelete?: (commentId: number) => void;
}

export function CommentsTab({ threads, currentUser, onDelete }: CommentsTabProps) {
  if (threads.length === 0) {
    return (
      <div className="my-mr-comments">
        <p className="my-mr-no-comments">No comments on this merge request.</p>
      </div>
    );
  }

  return (
    <div className="my-mr-comments">
      {threads.map((thread) => {
        const isResolved = thread.some(c => c.resolved);
        return (
          <div
            key={thread[0].discussionId ?? thread[0].id}
            className={`my-mr-thread ${isResolved ? 'resolved' : ''}`}
          >
            {thread[0].filePath && (
              <div className="my-mr-thread-file">
                {thread[0].filePath}
                {thread[0].newLine != null && `:${thread[0].newLine}`}
              </div>
            )}
            {thread.map(comment => (
              <div key={comment.id} className="my-mr-comment">
                <div className="my-mr-comment-header">
                  <span className="my-mr-comment-author">{comment.authorUsername}</span>
                  <span className="my-mr-comment-time">{formatRelativeTime(comment.createdAt)}</span>
                  {currentUser && comment.authorUsername === currentUser && onDelete && (
                    <button
                      type="button"
                      className="my-mr-comment-delete"
                      onClick={() => onDelete(comment.id)}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
                <div className="my-mr-comment-body">{comment.body}</div>
              </div>
            ))}
            {isResolved && (
              <div className="my-mr-thread-resolved-badge">Resolved</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
