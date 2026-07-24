import { useMutation, useQueryClient } from '@tanstack/react-query';
import { snoozeMR, unsnoozeMR } from '../../services/tauri';

/**
 * Snooze / unsnooze mutations for an MR. Invalidates the MR list queries so
 * the snoozed row is filtered (or restored) immediately.
 */
export function useSnoozeMRMutation() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['mrList'] });
    queryClient.invalidateQueries({ queryKey: ['myMRList'] });
  };

  const snooze = useMutation({
    mutationFn: ({ mrId, until }: { mrId: number; until: number }) => snoozeMR(mrId, until),
    onSuccess: invalidate,
  });

  const unsnooze = useMutation({
    mutationFn: ({ mrId }: { mrId: number }) => unsnoozeMR(mrId),
    onSuccess: invalidate,
  });

  return { snooze, unsnooze };
}
