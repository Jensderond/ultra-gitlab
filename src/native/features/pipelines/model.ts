/**
 * Pipeline domain helpers shared by the dashboard, the pipeline screen and the
 * cross-feature contract (`shared.tsx`): stage grouping, status maths, job
 * actions with cache invalidation, and finding the MR behind a pipeline.
 */

import { useEffect, useMemo } from 'react';
import { api } from '../../api/client';
import type { MergeRequest, PipelineJob, PipelineStatus } from '../../api/types';
import { useMyMRs, usePipelineProjects, useReviewMRs } from '../../data/hooks';
import { getData, invalidate, setData, useQuery } from '../../data/query';
import { toast } from '../../ui/components';

/* ---------------------------------------------------------------------- */
/* Status                                                                 */
/* ---------------------------------------------------------------------- */

export const ACTIVE = new Set(['running', 'pending', 'created', 'preparing', 'waiting_for_resource', 'scheduled']);
export const isActive = (status: string | null | undefined) => !!status && ACTIVE.has(status);
/** Actually executing or queued on a runner (not merely created/blocked). */
export const isMoving = (status: string | null | undefined) =>
  status === 'running' || status === 'pending' || status === 'preparing' || status === 'waiting_for_resource';

export type Group = 'failing' | 'running' | 'passed' | 'other';
export function groupOf(status: string | null | undefined): Group {
  if (status === 'failed') return 'failing';
  if (status === 'running' || status === 'pending' || status === 'preparing' || status === 'waiting_for_resource')
    return 'running';
  if (status === 'success') return 'passed';
  return 'other';
}

/** A job that failed but is allowed to — it doesn't fail the pipeline. */
export const isSoftFail = (j: PipelineJob) => j.status === 'failed' && j.allowFailure;
export const isHardFail = (j: PipelineJob) => j.status === 'failed' && !j.allowFailure;

export type ChipKind = 'ok' | 'fail' | 'warn' | 'running' | 'manual' | 'skip' | 'pending';
export function chipKind(j: PipelineJob): ChipKind {
  switch (j.status) {
    case 'success':
      return 'ok';
    case 'failed':
      return j.allowFailure ? 'warn' : 'fail';
    case 'running':
      return 'running';
    case 'manual':
      return 'manual';
    case 'skipped':
    case 'canceled':
      return 'skip';
    case 'created':
      return j.manual ? 'manual' : 'pending';
    default:
      return 'pending';
  }
}

export function jobStatusText(j: PipelineJob): string {
  switch (j.status) {
    case 'success':
      return 'passed';
    case 'failed':
      return j.allowFailure ? 'failed (allowed)' : 'failed';
    case 'waiting_for_resource':
      return 'waiting';
    case 'created':
      return j.manual ? 'manual' : 'created';
    default:
      return j.status;
  }
}

/* ---------------------------------------------------------------------- */
/* Stages                                                                 */
/* ---------------------------------------------------------------------- */

export interface Stage {
  name: string;
  jobs: PipelineJob[];
  status: string;
  /** Wall-clock span of the stage in seconds, when known. */
  duration: number | null;
}

const ts = (v: string | null) => (v ? new Date(v).getTime() : NaN);

export function stageStatus(jobs: PipelineJob[]): string {
  if (jobs.some((j) => j.status === 'running')) return 'running';
  if (jobs.some((j) => ['pending', 'preparing', 'waiting_for_resource'].includes(j.status))) return 'pending';
  if (jobs.some(isHardFail)) return 'failed';
  if (jobs.some((j) => j.status === 'canceled')) return 'canceled';
  if (jobs.some((j) => j.status === 'manual')) return 'manual';
  if (jobs.every((j) => j.status === 'skipped')) return 'skipped';
  if (jobs.every((j) => j.status === 'success' || j.status === 'skipped' || isSoftFail(j))) return 'success';
  return 'created';
}

/** Group jobs into stages in pipeline order (GitLab returns jobs newest id first). */
export function groupStages(jobs: PipelineJob[]): Stage[] {
  const sorted = [...jobs].sort((a, b) => a.id - b.id);
  const byStage = new Map<string, PipelineJob[]>();
  for (const j of sorted) {
    const list = byStage.get(j.stage);
    if (list) list.push(j);
    else byStage.set(j.stage, [j]);
  }
  return [...byStage.entries()].map(([name, list]) => {
    const starts = list.map((j) => ts(j.startedAt)).filter(Number.isFinite);
    const ends = list.map((j) => ts(j.finishedAt)).filter(Number.isFinite);
    const duration =
      starts.length && ends.length && list.every((j) => j.finishedAt || !j.startedAt)
        ? Math.max(0, (Math.max(...ends) - Math.min(...starts)) / 1000)
        : list.length === 1
          ? list[0].duration
          : null;
    return { name, jobs: list, status: stageStatus(list), duration };
  });
}

/** Overall pipeline status from its jobs (used when the pipeline itself isn't cached). */
export function pipelineStatusFromJobs(jobs: PipelineJob[]): string {
  if (!jobs.length) return 'created';
  if (jobs.some((j) => j.status === 'running')) return 'running';
  if (jobs.some(isHardFail)) return 'failed';
  if (jobs.some((j) => j.status === 'pending' || j.status === 'preparing' || j.status === 'waiting_for_resource')) return 'pending';
  if (jobs.some((j) => j.status === 'canceled')) return 'canceled';
  if (jobs.every((j) => ['success', 'skipped', 'manual'].includes(j.status) || isSoftFail(j) || (j.status === 'created' && j.manual)))
    return jobs.some((j) => j.status === 'success') ? 'success' : 'manual';
  return 'created';
}

/** Elapsed seconds from first job start to last job finish (or now, if running). */
export function elapsedFromJobs(jobs: PipelineJob[], now = Date.now()): number | null {
  const starts = jobs.map((j) => ts(j.startedAt)).filter(Number.isFinite);
  if (!starts.length) return null;
  const running = jobs.some((j) => j.status === 'running');
  const ends = jobs.map((j) => ts(j.finishedAt)).filter(Number.isFinite);
  const end = running ? now : ends.length ? Math.max(...ends) : NaN;
  if (!Number.isFinite(end)) return null;
  return Math.max(0, (end - Math.min(...starts)) / 1000);
}

/** Pipeline duration: the API's when given, else the created→updated span for finished ones. */
export function pipelineDuration(p: PipelineStatus): number | null {
  if (p.duration !== null && p.duration !== undefined) return p.duration;
  if (isActive(p.status) || !p.updatedAt) return null;
  const d = (ts(p.updatedAt) - ts(p.createdAt)) / 1000;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** The job to show by default: first hard failure, else a running one, else the last job. */
export function defaultJob(jobs: PipelineJob[]): PipelineJob | undefined {
  const ordered = groupStages(jobs).flatMap((s) => s.jobs);
  return (
    ordered.find(isHardFail) ??
    ordered.find((j) => j.status === 'running') ??
    [...ordered].reverse().find((j) => j.startedAt && !j.isBridge) ??
    ordered[ordered.length - 1]
  );
}

/* ---------------------------------------------------------------------- */
/* Statuses for the dashboard + sidebar counts                            */
/* ---------------------------------------------------------------------- */

/**
 * Latest pipeline per project. Paints instantly from the local cache, then
 * refreshes from GitLab; polls every 15s while anything is running.
 */
export function usePipelineStatuses(instanceId: number | undefined, projectIds: number[]) {
  const ids = useMemo(() => [...projectIds].sort((a, b) => a - b), [projectIds]);
  const key = instanceId && ids.length ? ['pipelines', 'statuses', instanceId, ids] : null;
  const keyHash = key ? JSON.stringify(key) : '';

  useEffect(() => {
    if (!key || getData(key) !== undefined) return;
    let cancelled = false;
    api
      .cachedPipelineStatuses(instanceId!, ids)
      .then((cached) => {
        if (!cancelled && getData(key) === undefined && cached?.length) setData(key, cached);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyHash]);

  // Poll only while something is running (read from the cache this render).
  const anyActive = key ? (getData<PipelineStatus[]>(key)?.some((s) => isActive(s.status)) ?? false) : false;
  const polled = useQuery(key, () => api.pipelineStatuses(instanceId!, ids), {
    staleTime: 10_000,
    refetchInterval: anyActive ? 15_000 : undefined,
  });
  const map = useMemo(() => new Map((polled.data ?? []).map((s) => [s.projectId, s])), [polled.data]);
  return { ...polled, map };
}

export function usePipelineDashboardData(instanceId: number | undefined) {
  const projects = usePipelineProjects(instanceId);
  const ids = useMemo(() => (projects.data ?? []).map((p) => p.projectId), [projects.data]);
  const statuses = usePipelineStatuses(instanceId, ids);
  return { projects, statuses };
}

/* ---------------------------------------------------------------------- */
/* Actions                                                                */
/* ---------------------------------------------------------------------- */

export function refreshPipeline(instanceId: number, projectId: number, pipelineId?: number) {
  void invalidate(['pipelines', 'statuses', instanceId]);
  void invalidate(['pipelines', 'history', instanceId, projectId]);
  if (pipelineId) {
    void invalidate(['pipelines', 'jobs', instanceId, projectId, pipelineId]);
    void invalidate(['pipelines', 'autorun', instanceId, projectId, pipelineId]);
  }
}

async function attempt<T>(what: string, run: () => Promise<T>, done?: string): Promise<T | undefined> {
  try {
    const result = await run();
    if (done) toast(done);
    return result;
  } catch (e) {
    toast(`Couldn't ${what}: ${(e as Error).message}`, { tone: 'error' });
    return undefined;
  }
}

export const jobActions = {
  retry: (i: number, p: number, pipelineId: number, job: PipelineJob) =>
    attempt('retry the job', () => api.retryJob(i, p, job.id), `Retrying ${job.name}`).finally(() =>
      refreshPipeline(i, p, pipelineId),
    ),
  play: (i: number, p: number, pipelineId: number, job: PipelineJob) =>
    attempt('start the job', () => api.playJob(i, p, job.id), `Started ${job.name}`).finally(() =>
      refreshPipeline(i, p, pipelineId),
    ),
  cancel: (i: number, p: number, pipelineId: number, job: PipelineJob) =>
    attempt('cancel the job', () => api.cancelJob(i, p, job.id), `Canceled ${job.name}`).finally(() =>
      refreshPipeline(i, p, pipelineId),
    ),
  cancelPipeline: (i: number, p: number, pipelineId: number) =>
    attempt('cancel the pipeline', () => api.cancelPipeline(i, p, pipelineId), `Canceled pipeline #${pipelineId}`).finally(
      () => refreshPipeline(i, p, pipelineId),
    ),
};

export const canRetry = (j: PipelineJob) => !j.isBridge && ['failed', 'canceled', 'success'].includes(j.status);
export const canPlay = (j: PipelineJob) => j.status === 'manual';
export const canCancel = (j: PipelineJob) =>
  !j.isBridge && ['running', 'pending', 'preparing', 'waiting_for_resource', 'created'].includes(j.status) && !j.manual;
export const canAutoRun = (j: PipelineJob) => j.manual && (j.status === 'created' || j.status === 'manual');

/** "Run when ready" claims for manual jobs in one pipeline. */
export function useAutoRun(instanceId: number | undefined, projectId: number | undefined, pipelineId: number | undefined) {
  const ready = instanceId && projectId && pipelineId;
  const key = ready ? ['pipelines', 'autorun', instanceId, projectId, pipelineId] : null;
  const q = useQuery(key, () => api.autoRunClaims(instanceId!, projectId!, pipelineId!), { staleTime: 10_000 });
  const claimed = useMemo(() => new Set((q.data ?? []).map((c) => c.jobId)), [q.data]);
  const toggle = async (job: PipelineJob, refName: string | null) => {
    if (!ready || !key) return;
    const on = claimed.has(job.id);
    try {
      if (on) await api.unclaimAutoRun(instanceId, projectId, job.id);
      else await api.claimAutoRun(instanceId, projectId, pipelineId, job.id, job.name, refName);
      toast(on ? `${job.name} won't run automatically` : `${job.name} will run when its stage is ready`);
    } catch (e) {
      toast(`Couldn't change auto-run: ${(e as Error).message}`, { tone: 'error' });
    }
    void invalidate(key);
  };
  return { claimed, toggle };
}

/* ---------------------------------------------------------------------- */
/* MR lookup                                                              */
/* ---------------------------------------------------------------------- */

/** The open MR whose source branch is this pipeline's ref (from the cached MR lists). */
export function useLinkedMR(
  instanceId: number | undefined,
  projectId: number | undefined,
  ref: string | null | undefined,
): MergeRequest | null {
  const review = useReviewMRs(instanceId);
  const mine = useMyMRs(instanceId);
  return useMemo(() => {
    if (!ref || !projectId) return null;
    const all = [...(review.data ?? []), ...(mine.data ?? [])].filter((m) => m.projectId === projectId);
    const mrRef = /^refs\/merge-requests\/(\d+)\/(head|merge|train)$/.exec(ref);
    if (mrRef) return all.find((m) => m.iid === Number(mrRef[1])) ?? null;
    return all.find((m) => m.sourceBranch === ref && m.state === 'opened') ?? all.find((m) => m.sourceBranch === ref) ?? null;
  }, [review.data, mine.data, projectId, ref]);
}

/** Project display name: the user's custom name, else GitLab's. */
export function useProjectInfo(instanceId: number | undefined, projectId: number | undefined) {
  const { data } = usePipelineProjects(instanceId);
  return data?.find((p) => p.projectId === projectId) ?? null;
}

/** `group/sub/project/-/pipelines/1` → `group/sub/project`. */
export function projectPathFromUrl(url: string | null | undefined): string | null {
  const m = url ? /^https?:\/\/[^/]+\/(.+?)\/-\/(pipelines|jobs)\/\d+/.exec(url) : null;
  return m ? m[1] : null;
}
