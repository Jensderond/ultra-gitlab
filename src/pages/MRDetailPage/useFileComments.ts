import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { useFileCommentsQuery } from '../../hooks/queries/useFileCommentsQuery';
import type { LineComment } from '../../components/PierreDiffViewer/PierreDiffViewer';

export function useFileComments(mrId: number, selectedFile: string | null) {
  const queryClient = useQueryClient();
  const { data: fileComments = [] } = useFileCommentsQuery(mrId, selectedFile);

  const removeComment = useCallback(
    (commentId: number) => {
      if (!selectedFile) return;
      queryClient.setQueryData<LineComment[]>(
        queryKeys.mrFileComments(mrId, selectedFile),
        (prev) => (prev ?? []).filter((c) => c.id !== commentId),
      );
    },
    [queryClient, mrId, selectedFile],
  );

  const restoreComment = useCallback(
    (comment: LineComment) => {
      if (!selectedFile) return;
      queryClient.setQueryData<LineComment[]>(
        queryKeys.mrFileComments(mrId, selectedFile),
        (prev) => [...(prev ?? []), comment],
      );
    },
    [queryClient, mrId, selectedFile],
  );

  return { fileComments, removeComment, restoreComment };
}
