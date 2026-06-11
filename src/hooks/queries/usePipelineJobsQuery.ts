import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getPipelineJobs } from '../../services/tauri';
import type { PipelineJob } from '../../types';

const ACTIVE_STATUSES = ['running', 'pending', 'preparing'];

function hasActiveJobs(jobs: PipelineJob[] | undefined): boolean {
  // A bridge job can finish before its downstream pipeline does (without
  // strategy:depend), so downstream statuses keep polling alive too.
  return !!jobs?.some(
    (j) =>
      ACTIVE_STATUSES.includes(j.status) ||
      (j.downstreamPipeline && ACTIVE_STATUSES.includes(j.downstreamPipeline.status))
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
