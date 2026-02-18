/**
 * Comment panel container for displaying all comments on an MR.
 *
 * Shows general comments and inline comments organized by discussion threads.
 */

import { useReducer, useEffect, useCallback } from 'react';
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

interface CommentPanelState {
  comments: Comment[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  replyingTo: string | null;
}

type CommentPanelAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; comments: Comment[] }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_END' }
  | { type: 'REPLY_START'; discussionId: string }
  | { type: 'REPLY_END' }
  | { type: 'SET_ERROR'; error: string };

function commentPanelReducer(state: CommentPanelState, action: CommentPanelAction): CommentPanelState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, comments: action.comments };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'SUBMIT_START':
      return { ...state, submitting: true };
    case 'SUBMIT_END':
      return { ...state, submitting: false };
    case 'REPLY_START':
      return { ...state, replyingTo: action.discussionId };
    case 'REPLY_END':
      return { ...state, replyingTo: null };
    case 'SET_ERROR':
      return { ...state, error: action.error };
  }
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
  const [state, dispatch] = useReducer(commentPanelReducer, {
    comments: [],
    loading: true,
    error: null,
    submitting: false,
    replyingTo: null,
  });

  const { comments, loading, error, submitting, replyingTo } = state;

  // Fetch comments
  const fetchComments = useCallback(async () => {
    try {
      dispatch({ type: 'FETCH_START' });

      const result = filePath
        ? await invoke<Comment[]>('get_file_comments', { mrId, filePath })
        : await invoke<Comment[]>('get_comments', { mrId });

      dispatch({ type: 'FETCH_SUCCESS', comments: result });
      onCommentsChange?.(result);
    } catch (e) {
      dispatch({ type: 'FETCH_ERROR', error: e instanceof Error ? e.message : 'Failed to load comments' });
    }
  }, [mrId, filePath, onCommentsChange]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Add a new general comment
  const handleAddComment = async (body: string) => {
    try {
      dispatch({ type: 'SUBMIT_START' });
      await invoke('add_comment', {
        input: { mrId, body },
      });
      await fetchComments();
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Failed to add comment' });
    } finally {
      dispatch({ type: 'SUBMIT_END' });
    }
  };

  // Reply to a discussion
  const handleReply = async (discussionId: string, parentId: number, body: string) => {
    try {
      dispatch({ type: 'REPLY_START', discussionId });
      await invoke('reply_to_comment', {
        input: { mrId, discussionId, parentId, body },
      });
      await fetchComments();
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Failed to reply' });
    } finally {
      dispatch({ type: 'REPLY_END' });
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
      dispatch({ type: 'SET_ERROR', error: e instanceof Error ? e.message : 'Failed to resolve' });
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
