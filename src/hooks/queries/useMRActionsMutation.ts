import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { mergeMR, rebaseMR } from '../../services/tauri';

export function useMRActionsMutation(mrId: number) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.mr(mrId) });
    queryClient.invalidateQueries({ queryKey: ['mrList'] });
    queryClient.invalidateQueries({ queryKey: ['myMRList'] });
    queryClient.invalidateQueries({ queryKey: ['mergeStatus', mrId] });
  };

  const merge = useMutation({
    mutationFn: () => mergeMR(mrId),
    onSuccess: invalidate,
  });

  const rebase = useMutation({
    mutationFn: () => rebaseMR(mrId),
    onSuccess: invalidate,
  });

  return { merge, rebase };
}
