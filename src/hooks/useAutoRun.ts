import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  claimAutoRun,
  listAutoRunClaims,
  unclaimAutoRun,
  type AutoRunClaim,
} from '../services/tauri';
import type { PipelineJob } from '../types';

const autoRunClaimsKey = (instanceId: number, projectId: number, pipelineId: number) =>
  ['autoRunClaims', instanceId, projectId, pipelineId] as const;

export interface UseAutoRunResult {
  claims: AutoRunClaim[];
  /** Job ids in this pipeline that are armed for auto-run. */
  armedJobIds: Set<number>;
  isLoading: boolean;
  /** Arm or disarm a manual job. */
  toggleAutoRun: (job: PipelineJob) => void;
  /** True while an arm/disarm mutation is in flight. */
  isMutating: boolean;
}

/**
 * Hook for reading and toggling auto-run claims for one pipeline's jobs.
 *
 * Claims persist in SQLite and are processed by the background sync engine
 * — this hook just exposes the rows to the UI and provides toggle mutations.
 * The `auto-run-updated` Tauri event invalidates the query (see tauriEvents).
 */
export function useAutoRun(
  instanceId: number,
  projectId: number,
  pipelineId: number,
  refName: string | null,
): UseAutoRunResult {
  const queryClient = useQueryClient();
  const queryKey = autoRunClaimsKey(instanceId, projectId, pipelineId);

  const query = useQuery({
    queryKey,
    queryFn: () => listAutoRunClaims(instanceId, projectId, pipelineId),
    enabled: instanceId > 0 && projectId > 0 && pipelineId > 0,
    staleTime: 0,
  });

  const claims = useMemo(() => query.data ?? [], [query.data]);
  const armedJobIds = useMemo(() => new Set(claims.map((c) => c.jobId)), [claims]);

  const claimMutation = useMutation({
    mutationFn: (job: PipelineJob) =>
      claimAutoRun(instanceId, projectId, pipelineId, job.id, job.name, refName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unclaimMutation = useMutation({
    mutationFn: (job: PipelineJob) => unclaimAutoRun(instanceId, projectId, job.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleAutoRun = useCallback(
    (job: PipelineJob) => {
      if (armedJobIds.has(job.id)) {
        unclaimMutation.mutate(job);
      } else {
        claimMutation.mutate(job);
      }
    },
    [armedJobIds, claimMutation, unclaimMutation],
  );

  return {
    claims,
    armedJobIds,
    isLoading: query.isLoading,
    toggleAutoRun,
    isMutating: claimMutation.isPending || unclaimMutation.isPending,
  };
}
