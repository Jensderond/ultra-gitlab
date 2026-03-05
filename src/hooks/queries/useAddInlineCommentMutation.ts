import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { addComment } from '../../services/tauri';
import type { AddCommentRequest } from '../../types';

export function useAddInlineCommentMutation(mrId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: AddCommentRequest) => addComment(request),
    onSuccess: (_data, variables) => {
      if (variables.filePath) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.mrFileComments(mrId, variables.filePath),
        });
      }
      // Keep general comments cache consistent with activity view
      queryClient.invalidateQueries({
        queryKey: queryKeys.mrComments(mrId),
      });
    },
  });
}
