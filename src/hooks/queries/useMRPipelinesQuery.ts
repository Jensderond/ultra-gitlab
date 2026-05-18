import { useQuery } from '@tanstack/react-query';
import { getMRPipelines } from '../../services/tauri';

/**
 * Live pipelines attached to a merge request, newest first.
 *
 * Lazy: only fetched when `enabled` (typically when the row is focused) so
 * the list page doesn't spam GitLab for every MR.
 */
export function useMRPipelinesQuery(mrId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['mrPipelines', mrId],
    queryFn: () => getMRPipelines(mrId),
    enabled,
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data || data.length === 0) return false;
      const hasInflight = data.some(
        (p) => p.status === 'running' || p.status === 'pending'
      );
      return hasInflight ? 10_000 : false;
    },
  });
}
