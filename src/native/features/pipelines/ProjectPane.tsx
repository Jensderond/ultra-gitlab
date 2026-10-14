/**
 * Right pane of the pipelines dashboard: the selected project's recent
 * pipelines, and the selected pipeline's failure, stage graph and manual jobs.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, openExternal } from '../../api/client';
import type { PipelineProject, PipelineStatus } from '../../api/types';
import { navigate, paths, setSearchParams } from '../../app/router';
import { getData, useQuery } from '../../data/query';
import { age, ago, duration, shortSha } from '../../lib/format';
import {
  Button,
  cx,
  EmptyState,
  IconButton,
  Label,
  pipelineLabel,
  pipelineTone,
  showContextMenu,
  Spinner,
  StatusIcon,
  Switch,
  Tag,
  copyText,
} from '../../ui/components';
import { ExternalIcon, PinIcon, PlayIcon, StopIcon } from '../../ui/icons';
import { canAutoRun, canPlay, isActive, jobActions, pipelineDuration, useAutoRun } from './model';
import { useExactJobs, usePipelineFailure } from './shared';
import { StageGraph } from './StageGraph';

export function openPipeline(instanceId: number, projectId: number, pipelineId: number, jobId?: number) {
  void api.visitProject(instanceId, projectId).catch(() => undefined);
  navigate(paths.pipeline(instanceId, projectId, pipelineId, jobId));
}

function PipelineRow({
  p,
  selected,
  onSelect,
  onOpen,
}: {
  p: PipelineStatus;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      className={cx('pl-prow', selected && 'is-selected')}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(e) =>
        void showContextMenu(e, [
          { label: 'Open pipeline', action: onOpen },
          { separator: true },
          { label: 'Open in GitLab', action: () => void openExternal(p.webUrl) },
          { label: 'Copy URL', action: () => void copyText(p.webUrl, 'Copied pipeline URL') },
          { label: 'Copy commit SHA', action: () => void copyText(p.sha, 'Copied SHA') },
        ])
      }
    >
      <StatusIcon status={p.status} size={14} />
      <span className="pl-prow__id mono tabular">#{p.id}</span>
      <span className="pl-prow__ref" title={p.refName}>
        {p.refName}
      </span>
      <span className="pl-prow__sha mono">{shortSha(p.sha)}</span>
      <span className="pl-prow__age tabular">{age(p.createdAt)}</span>
      <span className="pl-prow__dur tabular">{duration(pipelineDuration(p))}</span>
    </div>
  );
}

function PipelineDetail({
  instanceId,
  projectId,
  pipeline,
}: {
  instanceId: number;
  projectId: number;
  pipeline: PipelineStatus;
}) {
  const active = isActive(pipeline.status);
  const jobsQ = useExactJobs(instanceId, projectId, pipeline.id, active ? 5_000 : undefined);
  const failure = usePipelineFailure(instanceId, projectId, pipeline.status === 'failed' ? pipeline.id : undefined);
  const autoRun = useAutoRun(instanceId, projectId, pipeline.id);
  const ctx = { instanceId, projectId, pipelineId: pipeline.id, refName: pipeline.refName, autoRun };
  const manual = (jobsQ.data ?? []).filter((j) => canAutoRun(j) || canPlay(j));
  const [busy, setBusy] = useState(false);
  const open = (jobId?: number) => openPipeline(instanceId, projectId, pipeline.id, jobId);
  const f = failure.data;

  return (
    <div className="pl-pdetail">
      <div className="pl-pdetail__head">
        <div className="pl-pdetail__title">
          <span className="pl-pdetail__name">
            Pipeline #{pipeline.id}
            <Tag tone={pipelineTone(pipeline.status)}>{pipelineLabel(pipeline.status)}</Tag>
          </span>
          <span className="pl-pdetail__meta">
            <span className="mono">{pipeline.refName}</span> · <span className="mono">{shortSha(pipeline.sha)}</span> ·{' '}
            {ago(pipeline.createdAt)}
            {pipelineDuration(pipeline) ? ` · ${duration(pipelineDuration(pipeline))}` : ''}
          </span>
        </div>
        {active && (
          <Button
            size="sm"
            icon={<StopIcon size={11} />}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              await jobActions.cancelPipeline(instanceId, projectId, pipeline.id);
              setBusy(false);
            }}
          >
            Cancel
          </Button>
        )}
        <Button size="sm" variant="primary" shortcut="enter" onClick={() => open()}>
          Open
        </Button>
      </div>

      {pipeline.status === 'failed' && (
        <div className="pl-fail-card">
          {failure.loading && !f?.headline ? (
            <span className="pl-fail-card__head">
              <Spinner size={12} /> Reading the failed job’s log…
            </span>
          ) : (
            <>
              <div className="pl-fail-card__top">
                <span className="pl-fail-card__head">
                  <StatusIcon status="failed" size={14} />
                  {f?.headline ?? `${f?.failedJobs[0]?.name ?? 'A job'} failed`}
                </span>
                {f?.failedJobs[0] && (
                  <button type="button" className="pl-link" onClick={() => open(f.failedJobs[0].id)}>
                    Open log →
                  </button>
                )}
              </div>
              {f?.excerpt && <code className="pl-fail-card__excerpt">{f.excerpt}</code>}
              {f?.locations[0] && (
                <span className="pl-fail-card__loc">
                  Points to{' '}
                  <span className="mono">
                    {f.locations[0].path}
                    {f.locations[0].line ? `:${f.locations[0].line}` : ''}
                  </span>
                </span>
              )}
            </>
          )}
        </div>
      )}

      <div className="pl-pdetail__section">
        <Label>Stages</Label>
        {jobsQ.data ? (
          jobsQ.data.length ? (
            <StageGraph jobs={jobsQ.data} ctx={ctx} compact onOpen={(j) => open(j.id)} />
          ) : (
            <span className="pl-muted">No jobs in this pipeline.</span>
          )
        ) : jobsQ.error ? (
          <span className="pl-muted">
            Couldn’t load jobs. <button type="button" className="pl-link" onClick={() => void jobsQ.refetch()}>Try again</button>
          </span>
        ) : (
          <span className="pl-muted">
            <Spinner size={12} /> Loading jobs…
          </span>
        )}
      </div>

      {manual.length > 0 && (
        <div className="pl-pdetail__section">
          <Label>Manual jobs</Label>
          <div className="pl-manual">
            {manual.map((j) => (
              <div key={j.id} className="pl-manual__row">
                <StatusIcon status="manual" size={14} />
                <span className="pl-manual__name">{j.name}</span>
                <span className="pl-manual__stage">{j.stage}</span>
                {canAutoRun(j) && (
                  <label className="pl-manual__auto" title="Start this job automatically as soon as its stage is ready">
                    Run when ready
                    <Switch
                      label={`Run ${j.name} when ready`}
                      checked={autoRun.claimed.has(j.id)}
                      onChange={() => autoRun.toggle(j, pipeline.refName)}
                    />
                  </label>
                )}
                {canPlay(j) && (
                  <Button
                    size="sm"
                    icon={<PlayIcon size={11} />}
                    onClick={() => void jobActions.play(instanceId, projectId, pipeline.id, j)}
                  >
                    Run
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectPane({
  instanceId,
  project,
  pipelineId,
  onTogglePin,
}: {
  instanceId: number;
  project: PipelineProject;
  pipelineId?: number;
  onTogglePin: () => void;
}) {
  // Same key as useProjectPipelines, plus polling while something runs.
  const historyKey = ['pipelines', 'history', instanceId, project.projectId, 20];
  const moving = getData<PipelineStatus[]>(historyKey)?.some((p) => isActive(p.status)) ?? false;
  const history = useQuery(historyKey, () => api.projectPipelines(instanceId, project.projectId, 20), {
    staleTime: 10_000,
    refetchInterval: moving ? 10_000 : undefined,
  });
  const list = useMemo(() => history.data ?? [], [history.data]);
  const selected = list.find((p) => p.id === pipelineId) ?? list[0];
  const name = project.customName ?? project.name;

  useEffect(() => {
    document.querySelector('.pl-prow.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id]);

  return (
    <section className="pl-pane" aria-label={name}>
      <header className="pl-pane__head">
        <div className="pl-pane__title">
          <h1>{name}</h1>
          <span className="mono">{project.pathWithNamespace}</span>
        </div>
        <IconButton label={project.pinned ? 'Unpin (P)' : 'Pin (P)'} active={project.pinned} onClick={onTogglePin}>
          <PinIcon size={15} />
        </IconButton>
        <Button size="sm" icon={<ExternalIcon size={12} />} onClick={() => void openExternal(`${project.webUrl}/-/pipelines`)}>
          Open in GitLab
        </Button>
      </header>

      <div className="pl-pane__history">
        <div className="pl-pane__label">
          <Label>Recent pipelines</Label>
          {history.fetching && <Spinner size={11} />}
        </div>
        <div className="pl-prows" role="listbox" aria-label="Recent pipelines">
          {history.error && !list.length ? (
            <span className="pl-muted pl-prows__note">
              Couldn’t load pipelines.{' '}
              <button type="button" className="pl-link" onClick={() => void history.refetch()}>
                Try again
              </button>
            </span>
          ) : history.loading ? (
            <span className="pl-muted pl-prows__note">
              <Spinner size={12} /> Loading…
            </span>
          ) : !list.length ? (
            <span className="pl-muted pl-prows__note">This project has no pipelines yet.</span>
          ) : (
            list.map((p) => (
              <PipelineRow
                key={p.id}
                p={p}
                selected={p.id === selected?.id}
                onSelect={() => setSearchParams({ pipeline: p.id })}
                onOpen={() => openPipeline(instanceId, project.projectId, p.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="pl-pane__detail">
        {selected ? (
          <PipelineDetail key={selected.id} instanceId={instanceId} projectId={project.projectId} pipeline={selected} />
        ) : (
          !history.loading && <EmptyState title="Nothing to show" message="Pick a pipeline above." />
        )}
      </div>
    </section>
  );
}
