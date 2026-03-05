import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getJobTrace } from '../../services/tauri';
import type { PipelineJobStatus } from '../../types';

const ACTIVE_STATUSES: ReadonlySet<PipelineJobStatus> = new Set([
  'running',
  'pending',
  'created',
]);

export function useJobTraceQuery(
  instanceId: number,
  projectId: number,
  jobId: number,
  status: PipelineJobStatus
) {
  const isActive = ACTIVE_STATUSES.has(status);
  return useQuery({
    queryKey: queryKeys.jobTrace(String(instanceId), projectId, jobId),
    queryFn: () => getJobTrace(instanceId, projectId, jobId),
    enabled: !!instanceId && !!projectId && !!jobId,
    staleTime: isActive ? 0 : Infinity,
    refetchInterval: isActive ? 3_000 : false,
    refetchIntervalInBackground: false,
  });
}
