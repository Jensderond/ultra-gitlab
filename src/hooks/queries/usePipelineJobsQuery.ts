import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getPipelineJobs } from '../../services/tauri';
import type { PipelineJob } from '../../types';

function hasActiveJobs(jobs: PipelineJob[] | undefined): boolean {
  return !!jobs?.some(
    (j) => j.status === 'running' || j.status === 'pending' || j.status === 'preparing'
  );
}

export function usePipelineJobsQuery(
  instanceId: number,
  projectId: number,
  pipelineId: number
) {
  return useQuery({
    queryKey: queryKeys.pipelineJobs(String(instanceId), projectId, pipelineId),
    queryFn: () => getPipelineJobs(instanceId, projectId, pipelineId),
    enabled: !!instanceId && !!projectId && !!pipelineId,
    refetchInterval: (query) => (hasActiveJobs(query.state.data) ? 10_000 : false),
    refetchIntervalInBackground: false,
  });
}
