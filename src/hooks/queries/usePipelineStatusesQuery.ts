import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getPipelineStatuses, getCachedPipelineStatuses } from '../../services/tauri';
import type { PipelineStatus } from '../../types';

function hasActivePipelines(statuses: PipelineStatus[] | undefined): boolean {
  return !!statuses?.some(
    (s) => s.status === 'running' || s.status === 'pending'
  );
}

export function usePipelineStatusesQuery(
  instanceId: number | null,
  projectIds: number[]
) {
  // Load cached statuses from DB for instant display
  const cachedQuery = useQuery({
    queryKey: [...queryKeys.pipelineStatuses(String(instanceId ?? ''), projectIds), 'cached'],
    queryFn: () => getCachedPipelineStatuses(instanceId!, projectIds),
    enabled: !!instanceId && projectIds.length > 0,
    staleTime: Infinity, // cache query is one-shot, never refetch
  });

  return useQuery({
    queryKey: queryKeys.pipelineStatuses(String(instanceId ?? ''), projectIds),
    queryFn: () => getPipelineStatuses(instanceId!, projectIds),
    enabled: !!instanceId && projectIds.length > 0,
    placeholderData: cachedQuery.data,
    refetchInterval: (query) =>
      hasActivePipelines(query.state.data) ? 30_000 : 120_000,
    refetchIntervalInBackground: false,
  });
}
