/**
 * Comment panel container for displaying all comments on an MR.
 *
 * Shows general comments and inline comments organized by discussion threads.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Comment } from '../../types';
import { invoke } from '../../services/tauri';
import CommentThread from './CommentThread';
import CommentInput from './CommentInput';
import './CommentPanel.css';

interface CommentPanelProps {
  /** Merge request ID */
  mrId: number;
  /** Optional file path to filter inline comments */
  filePath?: string;
  /** Called when comments change */
  onCommentsChange?: (comments: Comment[]) => void;
}

/**
 * Group comments by discussion ID.
 */
function groupByDiscussion(comments: Comment[]): Map<string | null, Comment[]> {
  const groups = new Map<string | null, Comment[]>();

  for (const comment of comments) {
    const key = comment.discussionId;
    const existing = groups.get(key) ?? [];
    existing.push(comment);
    groups.set(key, existing);
  }

  return groups;
}

/**
 * Comment panel component.
 */
export default function CommentPanel({
  mrId,
  filePath,
  onCommentsChange,
}: CommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Fetch comments
  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = filePath
        ? await invoke<Comment[]>('get_file_comments', { mrId, filePath })
        : await invoke<Comment[]>('get_comments', { mrId });

      setComments(result);
      onCommentsChange?.(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  }, [mrId, filePath, onCommentsChange]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Add a new general comment
  const handleAddComment = async (body: string) => {
    try {
      setSubmitting(true);
      await invoke('add_comment', {
        input: { mrId, body },
      });
      await fetchComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add comment');
    } finally {
      setSubmitting(false);
    }
  };

  // Reply to a discussion
  const handleReply = async (discussionId: string, parentId: number, body: string) => {
    try {
      setReplyingTo(discussionId);
      await invoke('reply_to_comment', {
        input: { mrId, discussionId, parentId, body },
      });
      await fetchComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reply');
    } finally {
      setReplyingTo(null);
    }
  };

  // Resolve/unresolve a discussion
  const handleResolve = async (discussionId: string, resolved: boolean) => {
    try {
      await invoke('resolve_discussion', {
        input: { mrId, discussionId, resolved },
      });
      await fetchComments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve');
    }
  };

  if (loading) {
    return <div className="comment-panel loading">Loading comments...</div>;
  }

  if (error) {
    return (
      <div className="comment-panel error">
        <p>{error}</p>
        <button type="button" onClick={fetchComments}>
          Retry
        </button>
      </div>
    );
  }

  // Group comments by discussion
  const discussions = groupByDiscussion(comments);

  // Separate general comments (no discussion ID) from inline comments
  const generalComments = discussions.get(null) ?? [];
  discussions.delete(null);

  // Sort discussion threads by first comment timestamp
  const sortedDiscussions = Array.from(discussions.entries()).sort(([, a], [, b]) => {
    const aFirst = Math.min(...a.map((c) => c.createdAt));
    const bFirst = Math.min(...b.map((c) => c.createdAt));
    return aFirst - bFirst;
  });

  return (
    <div className="comment-panel">
      <div className="comment-panel-header">
        <h3>Comments ({comments.length})</h3>
      </div>

      <div className="comment-panel-content">
        {/* General comments without discussion ID */}
        {generalComments.length > 0 && (
          <div className="general-comments">
            {generalComments.map((comment) => (
              <div key={comment.id} className="standalone-comment">
                <div className="comment-header">
                  <span className="comment-author">{comment.authorUsername}</span>
                </div>
                <div className="comment-body">{comment.body}</div>
              </div>
            ))}
          </div>
        )}

        {/* Discussion threads */}
        {sortedDiscussions.map(([discussionId, threadComments]) => {
          if (!discussionId) return null;

          const rootComment = threadComments.find((c) => !c.parentId);
          const isResolved = threadComments.some((c) => c.resolved);

          return (
            <CommentThread
              key={discussionId}
              comments={threadComments}
              discussionId={discussionId}
              resolved={isResolved}
              onReply={(body) => {
                if (rootComment) {
                  handleReply(discussionId, rootComment.id, body);
                }
              }}
              onResolve={(resolved) => handleResolve(discussionId, resolved)}
              isReplying={replyingTo === discussionId}
            />
          );
        })}

        {/* Empty state */}
        {comments.length === 0 && (
          <div className="empty-state">
            <p>No comments yet</p>
          </div>
        )}
      </div>

      {/* Add new comment */}
      {!filePath && (
        <div className="comment-panel-footer">
          <CommentInput
            placeholder="Add a general comment..."
            onSubmit={handleAddComment}
            isSubmitting={submitting}
          />
        </div>
      )}
    </div>
  );
}
