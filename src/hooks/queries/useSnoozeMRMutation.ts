import { useMutation, useQueryClient } from '@tanstack/react-query';
import { snoozeMR, unsnoozeMR } from '../../services/tauri';
import { queryKeys } from '../../lib/queryKeys';

/**
 * Snooze / unsnooze mutations for an MR. Invalidates the MR list queries so the
 * snoozed row is filtered (or restored) immediately, and the MR's own detail
 * query so the detail-page snooze button reflects the new state.
 */
export function useSnoozeMRMutation() {
  const queryClient = useQueryClient();

  const invalidate = (mrId: number) => {
    queryClient.invalidateQueries({ queryKey: ['mrList'] });
    queryClient.invalidateQueries({ queryKey: ['myMRList'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.mr(mrId) });
  };

  const snooze = useMutation({
    mutationFn: ({ mrId, until }: { mrId: number; until: number }) => snoozeMR(mrId, until),
    onSuccess: (_data, { mrId }) => invalidate(mrId),
  });

  const unsnooze = useMutation({
    mutationFn: ({ mrId }: { mrId: number }) => unsnoozeMR(mrId),
    onSuccess: (_data, { mrId }) => invalidate(mrId),
  });

  return { snooze, unsnooze };
}
