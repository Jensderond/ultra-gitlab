/**
 * Pipeline + job log (design: Pipeline.dc.html).
 *
 *   toolbar      ‹ !iid · Pipeline #id · failed after 3m 52s · Open in GitLab · Retry failed job
 *   stage graph  one column per stage; click a chip (or J / K) to show its log
 *   aside        failure summary (or job facts)        log viewer
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { openExternal } from '../../api/client';
import { formatKeys, useKeys } from '../../app/keys';
import { back, navigate, paths, setSearchParams } from '../../app/router';
import { useDiffFiles, useProjectPipelines } from '../../data/hooks';
import { invalidate } from '../../data/query';
import { ago, duration, shortSha } from '../../lib/format';
import { Button, EmptyState, Spacer, Spinner, Toolbar, ToolbarTitle } from '../../ui/components';
import { ChevronLeft, ExternalIcon, RetryIcon, StopIcon } from '../../ui/icons';
import { Pane, Window } from '../../ui/layout';
import { FailureAside } from './FailureAside';
import { LogViewer, type LogViewerHandle } from './LogViewer';
import {
  defaultJob,
  elapsedFromJobs,
  groupStages,
  isActive,
  isHardFail,
  isMoving,
  jobActions,
  pipelineDuration,
  pipelineStatusFromJobs,
  useAutoRun,
  useLinkedMR,
  useProjectInfo,
} from './model';
import { useExactJobs, useJobLog } from './shared';
import { StageGraph } from './StageGraph';
import './pipeline.css';

function statusPhrase(status: string, seconds: number | null): string {
  const d = seconds ? duration(seconds) : '';
  switch (status) {
    case 'failed':
      return d ? `failed after ${d}` : 'failed';
    case 'success':
      return d ? `passed in ${d}` : 'passed';
    case 'running':
      return d ? `running for ${d}` : 'running';
    case 'canceled':
      return d ? `canceled after ${d}` : 'canceled';
    case 'manual':
      return 'waiting for a manual job';
    case 'skipped':
      return 'skipped';
    default:
      return 'waiting to start';
  }
}

export function PipelineScreen({
  instanceId,
  projectId,
  pipelineId,
  jobId,
}: {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  jobId?: number;
}) {
  const logRef = useRef<LogViewerHandle>(null);
  const history = useProjectPipelines(instanceId, projectId, 50);
  const pipeline = history.data?.find((p) => p.id === pipelineId);
  const project = useProjectInfo(instanceId, projectId);

  // Jobs poll every 5s while the pipeline is still moving.
  const [active, setActive] = useState(false);
  const jobsQ = useExactJobs(instanceId, projectId, pipelineId, active ? 5_000 : undefined);
  const jobs = jobsQ.data;
  const fromJobs = jobs ? pipelineStatusFromJobs(jobs) : null;
  // The cached pipeline row can lag behind its jobs; trust the jobs when they disagree.
  const status =
    pipeline && (!fromJobs || isMoving(pipeline.status) === isMoving(fromJobs)) ? pipeline.status : (fromJobs ?? 'created');
  useEffect(() => {
    const now = isActive(status);
    if (active && !now) void invalidate(['pipelines', 'history', instanceId, projectId]);
    if (now !== active) setActive(now);
  }, [status, active, instanceId, projectId]);

  const ordered = useMemo(() => (jobs ? groupStages(jobs).flatMap((s) => s.jobs) : []), [jobs]);
  const job = (jobId ? ordered.find((j) => j.id === jobId) : undefined) ?? (jobs ? defaultJob(jobs) : undefined);

  const jobRunning = job?.status === 'running' || job?.status === 'pending';
  const {
    log,
    analysis,
    loading: logLoading,
    error: logError,
    refetch,
  } = useJobLog(instanceId, projectId, job, jobRunning ? 3_000 : undefined);

  const mr = useLinkedMR(instanceId, projectId, pipeline?.refName);
  const diff = useDiffFiles(mr?.id);
  const changedPaths = useMemo(() => (diff.data ?? []).map((f) => f.newPath), [diff.data]);
  const autoRun = useAutoRun(instanceId, projectId, pipelineId);

  const goBack = () => {
    if (window.history.length > 1) back();
    else navigate(paths.pipelines(projectId));
  };

  const select = (id: number) => setSearchParams({ job: id });
  const move = (dir: 1 | -1) => {
    if (!ordered.length) return;
    const at = job ? ordered.findIndex((j) => j.id === job.id) : -1;
    const next = ordered[Math.max(0, Math.min(ordered.length - 1, at + dir))];
    if (next) select(next.id);
  };

  const retryTarget = job && isHardFail(job) ? job : ordered.find(isHardFail);
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (!retryTarget || busy) return;
    setBusy(true);
    const next = await jobActions.retry(instanceId, projectId, pipelineId, retryTarget);
    setBusy(false);
    if (next) setSearchParams({ job: next.id });
  };
  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    await jobActions.cancelPipeline(instanceId, projectId, pipelineId);
    setBusy(false);
  };

  useKeys({
    escape: () => goBack(),
    'mod+e': () => logRef.current?.jumpToError(),
    'mod+f': () => logRef.current?.focusSearch(),
    j: () => move(1),
    k: () => move(-1),
    'mod+shift+r': () => void retry(),
  });

  const elapsed = (pipeline && pipelineDuration(pipeline)) ?? (jobs ? elapsedFromJobs(jobs) : null);
  const title = `Pipeline #${pipelineId} · ${statusPhrase(status, elapsed)}`;
  const parts = [
    pipeline?.refName,
    project ? (project.customName ?? project.name) : null,
    pipeline ? `started ${ago(pipeline.createdAt)}` : null,
  ].filter(Boolean);
  const subtitle = (
    <>
      {pipeline && <span className="mono">{shortSha(pipeline.sha)}</span>}
      {parts.map((part, i) => (
        <span key={i}>
          {pipeline || i > 0 ? ' · ' : ''}
          {part}
        </span>
      ))}
    </>
  );
  const webUrl =
    pipeline?.webUrl ?? (job ? job.webUrl.replace(/\/-\/jobs\/\d+.*$/, `/-/pipelines/${pipelineId}`) : null);
  const ctx = { instanceId, projectId, pipelineId, refName: pipeline?.refName ?? null, autoRun };

  return (
    <Window className="pl-screen">
      <Toolbar>
        <button
          type="button"
          className="pl-back"
          onClick={goBack}
          title={`Back (${formatKeys('escape')})`}
          aria-label={mr ? `Back to !${mr.iid}` : 'Back to pipelines'}
        >
          <ChevronLeft size={14} />
          {mr ? `!${mr.iid}` : 'Pipelines'}
        </button>
        <ToolbarTitle title={title} subtitle={subtitle} />
        <Spacer />
        {webUrl && (
          <Button icon={<ExternalIcon size={13} />} onClick={() => void openExternal(webUrl)}>
            Open in GitLab
          </Button>
        )}
        {status === 'failed' && retryTarget ? (
          <Button
            variant="primary"
            icon={<RetryIcon size={13} />}
            busy={busy}
            onClick={() => void retry()}
            title={`Retry ${retryTarget.name} (${formatKeys('mod+shift+r')})`}
          >
            Retry failed job
          </Button>
        ) : isActive(status) ? (
          <Button icon={<StopIcon size={12} />} busy={busy} onClick={() => void cancel()}>
            Cancel pipeline
          </Button>
        ) : null}
      </Toolbar>

      {jobsQ.error && !jobs ? (
        <EmptyState
          title="Couldn’t load this pipeline"
          message={jobsQ.error.message}
          action={<Button onClick={() => void jobsQ.refetch()}>Try again</Button>}
        />
      ) : !jobs ? (
        <div className="pl-screen__loading">
          <Spinner /> Loading pipeline…
        </div>
      ) : !job ? (
        <EmptyState title="This pipeline has no jobs" />
      ) : (
        <>
          <div className="pl-screen__graph" title={`${formatKeys('j')} / ${formatKeys('k')} move between jobs`}>
            <StageGraph jobs={jobs} ctx={ctx} selectedId={job.id} onSelect={(j) => select(j.id)} />
          </div>
          <div className="pl-screen__body">
            <Pane
              id="pl-aside"
              defaultWidth={320}
              min={260}
              max={480}
              as="aside"
              className="pl-aside"
              label={job.status === 'failed' ? 'Failure summary' : 'Job'}
            >
              <FailureAside
                instanceId={instanceId}
                projectId={projectId}
                pipelineId={pipelineId}
                pipeline={pipeline}
                history={history.data}
                job={job}
                analysis={analysis}
                analysisLoading={logLoading}
                mr={mr}
                diffFiles={diff.data}
              />
            </Pane>
            <LogViewer
              key={job.id}
              ref={logRef}
              job={job}
              log={log}
              analysis={analysis}
              loading={logLoading}
              error={logError}
              onRetry={() => void refetch()}
              changedPaths={changedPaths}
              mrId={mr?.id}
            />
          </div>
        </>
      )}
    </Window>
  );
}
