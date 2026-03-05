import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getPipelineStatuses } from '../../services/tauri';
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
  return useQuery({
    queryKey: queryKeys.pipelineStatuses(String(instanceId ?? ''), projectIds),
    queryFn: () => getPipelineStatuses(instanceId!, projectIds),
    enabled: !!instanceId && projectIds.length > 0,
    refetchInterval: (query) =>
      hasActivePipelines(query.state.data) ? 30_000 : 120_000,
    refetchIntervalInBackground: false,
  });
}
