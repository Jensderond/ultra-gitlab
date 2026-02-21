/**
 * Comments tab for MyMRDetailPage — discussion threads.
 */

import { formatRelativeTime } from './utils';
import type { Comment } from '../../types';
import { TrashIcon } from '../../components/icons';

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
