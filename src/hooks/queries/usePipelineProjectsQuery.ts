import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { listPipelineProjects } from '../../services/tauri';

export function usePipelineProjectsQuery(instanceId: number | null) {
  return useQuery({
    queryKey: queryKeys.pipelineProjects(String(instanceId ?? '')),
    queryFn: () => listPipelineProjects(instanceId!),
    enabled: !!instanceId,
    staleTime: 60_000,
  });
}
