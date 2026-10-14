/**
 * Shared data hooks. Key conventions (used by `events.ts` to invalidate):
 *
 *   ['instances']                     ['settings']
 *   ['mrs', 'review', instanceId]     ['mrs', 'mine', instanceId]
 *   ['mr', mrId, ...rest]             e.g. ['mr', 42, 'files']
 *   ['pipelines', ...rest]            e.g. ['pipelines', 'jobs', instanceId, projectId, pipelineId]
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useQuery } from './query';

export function useInstances() {
  return useQuery(['instances'], api.instances, { staleTime: 60_000 });
}

const ACTIVE_KEY = 'ug.activeInstance';
const activeListeners = new Set<(id: number) => void>();

/** Switch the instance the whole app is showing. */
export function setActiveInstanceId(id: number) {
  try {
    localStorage.setItem(ACTIVE_KEY, String(id));
  } catch {
    /* storage unavailable */
  }
  activeListeners.forEach((l) => l(id));
}

/** The instance the app is showing: the user's pick, else the default, else the first. */
export function useActiveInstance() {
  const { data: instances, loading } = useInstances();
  const [picked, setPicked] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(ACTIVE_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    activeListeners.add(setPicked);
    return () => void activeListeners.delete(setPicked);
  }, []);
  const instance =
    instances?.find((i) => i.id === picked) ??
    instances?.find((i) => i.isDefault) ??
    instances?.[0] ??
    null;
  return { instance, instances: instances ?? [], loading };
}

/** Username of the signed-in user on the active instance. */
export function useMe(): string | null {
  return useActiveInstance().instance?.authenticatedUsername ?? null;
}

export function useSettings() {
  return useQuery(['settings'], api.settings, { staleTime: 60_000 });
}

export function useReviewMRs(instanceId: number | undefined) {
  return useQuery(
    instanceId ? ['mrs', 'review', instanceId] : null,
    () => api.reviewMRs(instanceId!, { state: 'opened' }),
  );
}

export function useMyMRs(instanceId: number | undefined, includeRecentlyMerged = true) {
  return useQuery(
    instanceId ? ['mrs', 'mine', instanceId, includeRecentlyMerged] : null,
    () => api.myMRs(instanceId!, includeRecentlyMerged, true),
  );
}

export function useMR(mrId: number | undefined) {
  return useQuery(mrId ? ['mr', mrId] : null, () => api.mr(mrId!));
}

export function useDiffFiles(mrId: number | undefined) {
  return useQuery(mrId ? ['mr', mrId, 'files'] : null, () => api.diffFiles(mrId!));
}

export function useDiffRefs(mrId: number | undefined) {
  return useQuery(mrId ? ['mr', mrId, 'refs'] : null, () => api.diffRefs(mrId!));
}

export function useComments(mrId: number | undefined) {
  return useQuery(mrId ? ['mr', mrId, 'comments'] : null, () => api.comments(mrId!));
}

export function useReviewers(mrId: number | undefined) {
  return useQuery(mrId ? ['mr', mrId, 'reviewers'] : null, () => api.reviewers(mrId!));
}

export function useMRPipelines(mrId: number | undefined) {
  return useQuery(mrId ? ['mr', mrId, 'pipelines'] : null, () => api.mrPipelines(mrId!), {
    staleTime: 10_000,
  });
}

export function usePipelineJobs(
  instanceId: number | undefined,
  projectId: number | undefined,
  pipelineId: number | undefined,
  options: { refetchInterval?: number } = {},
) {
  const ready = instanceId && projectId && pipelineId;
  return useQuery(
    ready ? ['pipelines', 'jobs', instanceId, projectId, pipelineId] : null,
    () => api.pipelineJobs(instanceId!, projectId!, pipelineId!),
    { staleTime: 5_000, ...options },
  );
}

export function useJobTrace(
  instanceId: number | undefined,
  projectId: number | undefined,
  jobId: number | undefined,
  options: { refetchInterval?: number } = {},
) {
  const ready = instanceId && projectId && jobId;
  return useQuery(
    ready ? ['pipelines', 'trace', instanceId, projectId, jobId] : null,
    () => api.jobTrace(instanceId!, projectId!, jobId!),
    { staleTime: 5_000, ...options },
  );
}

export function usePipelineProjects(instanceId: number | undefined) {
  return useQuery(instanceId ? ['pipelines', 'projects', instanceId] : null, () =>
    api.pipelineProjects(instanceId!),
  );
}

export function useProjectPipelines(
  instanceId: number | undefined,
  projectId: number | undefined,
  limit = 20,
) {
  const ready = instanceId && projectId;
  return useQuery(
    ready ? ['pipelines', 'history', instanceId, projectId, limit] : null,
    () => api.projectPipelines(instanceId!, projectId!, limit),
    { staleTime: 10_000 },
  );
}

/** Usernames → avatar data URIs. Missing avatars are simply absent. */
export function useAvatars(instanceId: number | undefined, usernames: string[]) {
  const sorted = [...new Set(usernames)].sort();
  return useQuery(
    instanceId && sorted.length ? ['avatars', instanceId, sorted] : null,
    () => api.avatars(instanceId!, sorted),
    { staleTime: 10 * 60_000 },
  ).data;
}
