/**
 * CONTRACT — owned by the pipelines feature, consumed by inbox + review.
 * Keep these exports and signatures stable; additions are fine.
 */

import { useMemo } from 'react';
import { api } from '../../api/client';
import type { PipelineJob } from '../../api/types';
import { usePipelineJobs } from '../../data/hooks';
import { getData, useQuery } from '../../data/query';
import { duration } from '../../lib/format';
import { cx } from '../../ui/components';
import { analyzeLog, type Analysis } from './log/failure';
import { parseTraceCached, type ParsedLog } from './log/parse';
import { groupOf, groupStages, isHardFail, usePipelineDashboardData } from './model';
import './shared.css';

export interface FailureLocation {
  path: string;
  line?: number;
}

export interface FailureSummary {
  jobs: PipelineJob[];
  failedJobs: PipelineJob[];
  /** Human headline, e.g. "1 of 48 tests failed" or "composer:install exited with code 1". */
  headline: string | null;
  /** A few lines from the log that explain the failure. */
  excerpt: string | null;
  /** File references found in the failing job's log (relative to the repo root). */
  locations: FailureLocation[];
}

/* Exact-key reads: useQuery keeps the previous key's data while a new key
   loads, which is right for lists but wrong when the data must belong to
   *this* job or pipeline. */

export function useExactJobs(instanceId?: number, projectId?: number, pipelineId?: number, refetchInterval?: number) {
  const q = usePipelineJobs(instanceId, projectId, pipelineId, { refetchInterval });
  const ready = !!(instanceId && projectId && pipelineId);
  const exact = ready ? getData<PipelineJob[]>(['pipelines', 'jobs', instanceId, projectId, pipelineId]) : undefined;
  return { ...q, data: exact, loading: ready && !exact && !q.error };
}

export function useTrace(instanceId?: number, projectId?: number, jobId?: number, refetchInterval?: number) {
  const ready = instanceId && projectId && jobId;
  const key = ready ? ['pipelines', 'trace', instanceId, projectId, jobId] : null;
  const q = useQuery(key, () => api.jobTrace(instanceId!, projectId!, jobId!), {
    staleTime: 5_000,
    refetchInterval,
  });
  const exact = key ? getData<string>(key) : undefined;
  return { ...q, data: exact, loading: !!key && exact === undefined && !q.error };
}

/** Parse + analyse a job's trace (memoised per trace text). */
export function useJobLog(
  instanceId?: number,
  projectId?: number,
  job?: PipelineJob,
  refetchInterval?: number,
): { log?: ParsedLog; analysis?: Analysis; loading: boolean; error?: Error; refetch: () => Promise<void> } {
  const trace = useTrace(instanceId, projectId, job && !job.isBridge ? job.id : undefined, refetchInterval);
  const log = useMemo(() => (trace.data !== undefined ? parseTraceCached(trace.data) : undefined), [trace.data]);
  const analysis = useMemo(() => (log ? analyzeLog(log, job?.name) : undefined), [log, job?.name]);
  return { log, analysis, loading: trace.loading, error: trace.error, refetch: trace.refetch };
}

/** Jobs + parsed failure for a pipeline. Loads the failed job's trace lazily. */
export function usePipelineFailure(
  instanceId: number | undefined,
  projectId: number | undefined,
  pipelineId: number | undefined,
): { data: FailureSummary | undefined; loading: boolean } {
  const { data: jobs, loading } = useExactJobs(instanceId, projectId, pipelineId);
  const failedJobs = useMemo(
    () => (jobs ? groupStages(jobs).flatMap((s) => s.jobs).filter(isHardFail) : []),
    [jobs],
  );
  const first = failedJobs[0];
  const { analysis, loading: traceLoading } = useJobLog(instanceId, projectId, first);

  const data = useMemo<FailureSummary | undefined>(() => {
    if (!jobs) return undefined;
    if (!first) return { jobs, failedJobs, headline: null, excerpt: null, locations: [] };
    const headline = analysis ? (analysis.headline ?? `${first.name} failed`) : null;
    return {
      jobs,
      failedJobs,
      headline,
      excerpt: analysis?.excerpt ?? null,
      locations: (analysis?.locations ?? []).map(({ path, line }) => ({ path, line })),
    };
  }, [jobs, failedJobs, first, analysis]);

  return { data, loading: loading || (!!first && traceLoading) };
}

/* ---------------------------------------------------------------------- */
/* Strip                                                                  */
/* ---------------------------------------------------------------------- */

interface StripChip {
  key: string;
  tone: 'ok' | 'fail' | 'neutral' | 'running';
  label: string;
  detail: string;
  job: PipelineJob;
}

function stripChips(jobs: PipelineJob[]): StripChip[] {
  const chips: StripChip[] = [];
  for (const stage of groupStages(jobs)) {
    const failed = stage.jobs.filter(isHardFail);
    if (failed.length) {
      for (const j of failed) {
        chips.push({ key: `j${j.id}`, tone: 'fail', label: `✕ ${j.name}`, detail: duration(j.duration), job: j });
      }
      continue;
    }
    const one = stage.jobs.length === 1 ? stage.jobs[0] : null;
    const name = one ? one.name : stage.name;
    const rep = stage.jobs.find((j) => j.status === 'running') ?? stage.jobs[0];
    switch (stage.status) {
      case 'success':
        chips.push({ key: stage.name, tone: 'ok', label: `✓ ${name}`, detail: duration(stage.duration), job: rep });
        break;
      case 'running':
      case 'pending':
        chips.push({ key: stage.name, tone: 'running', label: name, detail: stage.status, job: rep });
        break;
      case 'manual':
        chips.push({ key: stage.name, tone: 'neutral', label: name, detail: 'manual', job: rep });
        break;
      default:
        chips.push({
          key: stage.name,
          tone: 'neutral',
          label: name,
          detail: stage.status === 'created' ? 'waiting' : stage.status,
          job: rep,
        });
    }
  }
  return chips;
}

/** Compact stage chain: "✓ build 1m 04s → ✕ test:phpunit 2m 31s → deploy:staging skipped". */
export function PipelineStrip({ jobs, onJob }: { jobs: PipelineJob[]; onJob?: (job: PipelineJob) => void }) {
  const chips = useMemo(() => stripChips(jobs), [jobs]);
  return (
    <div className="pl-strip" role="list" aria-label="Pipeline stages">
      {chips.map((c, i) => (
        <span key={c.key} className="pl-strip__item" role="listitem">
          {i > 0 && (
            <span className="pl-strip__arrow" aria-hidden="true">
              →
            </span>
          )}
          {onJob ? (
            <button
              type="button"
              className={cx('pl-strip__chip', `pl-strip__chip--${c.tone}`)}
              onClick={() => onJob(c.job)}
              title={`Open the ${c.job.name} log`}
            >
              {c.label}
              {c.detail && <span className="pl-strip__detail tabular">{c.detail}</span>}
            </button>
          ) : (
            <span className={cx('pl-strip__chip', `pl-strip__chip--${c.tone}`)}>
              {c.label}
              {c.detail && <span className="pl-strip__detail tabular">{c.detail}</span>}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sidebar counts                                                         */
/* ---------------------------------------------------------------------- */

/** Counts for the home sidebar's Pipelines section. */
export function usePipelineCounts(instanceId: number | undefined): { failing: number; running: number } {
  const { statuses } = usePipelineDashboardData(instanceId);
  return useMemo(() => {
    let failing = 0;
    let running = 0;
    for (const s of statuses.data ?? []) {
      const g = groupOf(s.status);
      if (g === 'failing') failing++;
      else if (g === 'running') running++;
    }
    return { failing, running };
  }, [statuses.data]);
}

export { groupStages } from './model';
export type { Analysis } from './log/failure';
