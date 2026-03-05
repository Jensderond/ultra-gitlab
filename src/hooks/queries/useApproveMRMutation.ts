import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { approveMR, unapproveMR } from '../../services/tauri';

export function useApproveMRMutation(mrId: number) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.mr(mrId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.mrReviewers(mrId) });
    // Invalidate all MR list queries so approval badges stay consistent
    queryClient.invalidateQueries({ queryKey: ['mrList'] });
    queryClient.invalidateQueries({ queryKey: ['myMRList'] });
  };

  const approve = useMutation({
    mutationFn: () => approveMR(mrId),
    onSuccess: invalidate,
  });

  const unapprove = useMutation({
    mutationFn: () => unapproveMR(mrId),
    onSuccess: invalidate,
  });

  return { approve, unapprove };
}
