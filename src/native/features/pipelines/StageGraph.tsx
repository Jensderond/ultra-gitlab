/**
 * The stage graph: one column per stage, a chip per job, arrows between.
 * Chips select (click), open (double-click / ↩) and carry a native context
 * menu with every job action. Manual jobs get an inline ▶.
 */

import { Fragment, useMemo } from 'react';
import { openExternal } from '../../api/client';
import type { PipelineJob } from '../../api/types';
import { navigate, paths } from '../../app/router';
import { duration } from '../../lib/format';
import { copyText, cx, showContextMenu, StatusIcon, type MenuEntry } from '../../ui/components';
import { ClockIcon, PlayIcon } from '../../ui/icons';
import {
  canAutoRun,
  canCancel,
  canPlay,
  canRetry,
  chipKind,
  groupStages,
  jobActions,
  jobStatusText,
  type ChipKind,
} from './model';
import './stages.css';

export interface JobContext {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  refName: string | null;
  autoRun?: { claimed: Set<number>; toggle: (job: PipelineJob, ref: string | null) => void };
}

const GLYPH: Record<ChipKind, string> = {
  ok: '✓',
  fail: '✕',
  warn: '!',
  running: '',
  manual: '',
  skip: '○',
  pending: '○',
};

function chipTime(j: PipelineJob): string {
  if (j.status === 'skipped') return 'skipped';
  if (j.status === 'canceled') return 'canceled';
  if (j.status === 'running') return j.duration ? duration(j.duration) : 'running';
  if (j.status === 'manual' || (j.status === 'created' && j.manual)) return 'manual';
  if (j.status === 'pending' || j.status === 'created' || j.status === 'waiting_for_resource') return 'waiting';
  return duration(j.duration);
}

/** Every action for a job, for context menus. */
export function jobMenu(job: PipelineJob, ctx: JobContext, extra: MenuEntry[] = []): MenuEntry[] {
  const { instanceId: i, projectId: p, pipelineId } = ctx;
  const entries: MenuEntry[] = [...extra];
  if (canPlay(job)) entries.push({ label: `Run ${job.name}`, action: () => void jobActions.play(i, p, pipelineId, job) });
  if (canAutoRun(job) && ctx.autoRun) {
    const on = ctx.autoRun.claimed.has(job.id);
    entries.push({
      label: on ? '✓ Run when ready' : 'Run when ready',
      action: () => ctx.autoRun!.toggle(job, ctx.refName),
    });
  }
  if (canRetry(job)) entries.push({ label: 'Retry', action: () => void jobActions.retry(i, p, pipelineId, job) });
  if (canCancel(job)) entries.push({ label: 'Cancel', action: () => void jobActions.cancel(i, p, pipelineId, job) });
  if (job.downstreamPipeline?.projectId) {
    const d = job.downstreamPipeline;
    entries.push({
      label: `Open downstream pipeline #${d.id}`,
      action: () => navigate(paths.pipeline(i, d.projectId!, d.id)),
    });
  }
  if (entries.length) entries.push({ separator: true });
  entries.push(
    { label: 'Open in GitLab', action: () => void openExternal(job.webUrl) },
    { label: 'Copy job URL', action: () => void copyText(job.webUrl, 'Copied job URL') },
  );
  return entries;
}

export function JobChip({
  job,
  ctx,
  selected,
  onSelect,
  onOpen,
  compact,
}: {
  job: PipelineJob;
  ctx: JobContext;
  selected?: boolean;
  onSelect?: (job: PipelineJob) => void;
  onOpen?: (job: PipelineJob) => void;
  compact?: boolean;
}) {
  const kind = chipKind(job);
  const claimed = ctx.autoRun?.claimed.has(job.id);
  const downstream = job.downstreamPipeline;
  const open = () => {
    if (downstream?.projectId) navigate(paths.pipeline(ctx.instanceId, downstream.projectId, downstream.id));
    else onOpen?.(job);
  };
  return (
    <div
      className={cx('pl-chip', `pl-chip--${kind}`, selected && 'is-selected', compact && 'pl-chip--compact')}
      onContextMenu={(e) => void showContextMenu(e, jobMenu(job, ctx))}
    >
      <button
        type="button"
        className="pl-chip__main"
        aria-pressed={selected}
        title={`${job.name} — ${jobStatusText(job)}${downstream ? ' · opens the downstream pipeline' : ''}`}
        onClick={() => (onSelect ? onSelect(job) : open())}
        onDoubleClick={open}
      >
        <span className="pl-chip__icon" aria-hidden="true">
          {kind === 'running' ? (
            <StatusIcon status="running" size={12} />
          ) : kind === 'manual' ? (
            <PlayIcon size={10} />
          ) : (
            GLYPH[kind]
          )}
        </span>
        <span className="pl-chip__name">{job.name}</span>
        {claimed && (
          <span className="pl-chip__claim" title="Runs automatically when ready">
            <ClockIcon size={12} />
          </span>
        )}
        <span className="pl-chip__time tabular">{downstream ? `#${downstream.id} ↗` : chipTime(job)}</span>
      </button>
      {canPlay(job) && (
        <button
          type="button"
          className="pl-chip__action"
          aria-label={`Run ${job.name}`}
          title={`Run ${job.name}`}
          onClick={() => void jobActions.play(ctx.instanceId, ctx.projectId, ctx.pipelineId, job)}
        >
          <PlayIcon size={11} />
        </button>
      )}
    </div>
  );
}

export function StageGraph({
  jobs,
  ctx,
  selectedId,
  onSelect,
  onOpen,
  compact,
}: {
  jobs: PipelineJob[];
  ctx: JobContext;
  selectedId?: number;
  onSelect?: (job: PipelineJob) => void;
  onOpen?: (job: PipelineJob) => void;
  compact?: boolean;
}) {
  const stages = useMemo(() => groupStages(jobs), [jobs]);
  return (
    <div className={cx('pl-graph', compact && 'pl-graph--compact')} role="list" aria-label="Stages">
      {stages.map((stage, i) => (
        <Fragment key={stage.name}>
          <div className="pl-stage" role="listitem">
            <div className="pl-stage__col">
              <span className="pl-stage__name">{stage.name}</span>
              {stage.jobs.map((j) => (
                <JobChip
                  key={j.id}
                  job={j}
                  ctx={ctx}
                  selected={j.id === selectedId}
                  onSelect={onSelect}
                  onOpen={onOpen}
                  compact={compact}
                />
              ))}
            </div>
            {i < stages.length - 1 && (
              <span className="pl-stage__arrow" aria-hidden="true">
                →
              </span>
            )}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
