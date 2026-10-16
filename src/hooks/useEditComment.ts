import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { editComment as gitlabEditComment } from '../services/gitlab';
import { queryKeys } from '../lib/queryKeys';
import type { Comment } from '../types';
import type { LineComment } from '../components/PierreDiffViewer/PierreDiffViewer';

function setLineCommentBody(comments: LineComment[], commentId: number, body: string): LineComment[] {
  return comments.map((c) => {
    if (c.id === commentId) return { ...c, body };
    if (c.replies?.some((r) => r.id === commentId)) {
      return { ...c, replies: setLineCommentBody(c.replies, commentId, body) };
    }
    return c;
  });
}

/**
 * Edit one of your own comments on an MR.
 *
 * Updates the cached MR comments and every cached file-comment list for the MR
 * right away, then saves. If saving fails both are refetched and the error is
 * rethrown so the editor can stay open with the draft.
 */
export function useEditComment(mrId: number) {
  const queryClient = useQueryClient();

  return useCallback(
    async (commentId: number, body: string) => {
      queryClient.setQueryData<Comment[]>(queryKeys.mrComments(mrId), (prev) =>
        prev?.map((c) => (c.id === commentId ? { ...c, body } : c)),
      );
      queryClient.setQueriesData<LineComment[]>(
        { queryKey: ['mrFileComments', mrId] },
        (prev) => (prev ? setLineCommentBody(prev, commentId, body) : prev),
      );

      try {
        await gitlabEditComment(mrId, commentId, body);
      } catch (e) {
        queryClient.invalidateQueries({ queryKey: queryKeys.mrComments(mrId) });
        queryClient.invalidateQueries({ queryKey: ['mrFileComments', mrId] });
        throw e;
      }
    },
    [mrId, queryClient],
  );
}
