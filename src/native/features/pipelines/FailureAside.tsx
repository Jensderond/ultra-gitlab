/**
 * Left aside of the pipeline screen. For a failed job: what failed, the
 * likely related change in the MR, how the same job did on the base branch,
 * and job facts. For other jobs: the job facts and its state.
 */

import type { DiffFile, MergeRequest, PipelineJob, PipelineStatus } from '../../api/types';
import { openExternal } from '../../api/client';
import { navigate, paths } from '../../app/router';
import { ago, duration } from '../../lib/format';
import { Button, Label, Spinner, StatusIcon } from '../../ui/components';
import { PlayIcon } from '../../ui/icons';
import { samePath, type Analysis } from './log/failure';
import { canPlay, isActive, isHardFail, jobActions } from './model';
import { useExactJobs } from './shared';

interface Props {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  pipeline?: PipelineStatus;
  history?: PipelineStatus[];
  job: PipelineJob;
  analysis?: Analysis;
  analysisLoading: boolean;
  mr: MergeRequest | null;
  diffFiles?: DiffFile[];
}

const CHANGE_WORD: Record<string, string> = {
  added: 'Added',
  modified: 'Changed',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

function Comparison({ instanceId, projectId, pipelineId, pipeline, history, job, mr }: Props) {
  const base =
    mr?.targetBranch ??
    (history?.some((h) => h.refName === 'main') ? 'main' : history?.some((h) => h.refName === 'master') ? 'master' : 'main');
  const onBase = pipeline?.refName === base;
  const basePipeline = history?.find(
    (h) => h.refName === base && h.id !== pipelineId && !isActive(h.status) && (!onBase || h.id < pipelineId),
  );
  const { data: baseJobs, loading } = useExactJobs(instanceId, projectId, basePipeline?.id);
  const same = baseJobs?.find((j) => j.name === job.name);
  const when = same?.finishedAt ?? basePipeline?.updatedAt ?? basePipeline?.createdAt;

  let body;
  if (!history) {
    body = <Spinner size={12} />;
  } else if (!basePipeline) {
    body = <span className="pl-aside__muted">No finished pipeline on {base} among the recent runs to compare with.</span>;
  } else if (loading) {
    body = (
      <span className="pl-aside__row">
        <Spinner size={12} /> Checking {base}…
      </span>
    );
  } else if (!same) {
    body = (
      <span className="pl-aside__muted">
        The latest {base} pipeline (#{basePipeline.id}) didn’t run {job.name}.
      </span>
    );
  } else if (same.status === 'success') {
    body = (
      <>
        <span className="pl-aside__row">
          <StatusIcon status="success" size={14} />
          {onBase ? `Passed in the previous run on ${base} ${ago(when)}` : `Same job passed on ${base} ${ago(when)}`}
        </span>
        <span className="pl-aside__muted">
          {onBase
            ? 'Something that landed since then broke it — or the test is flaky.'
            : 'So it’s likely new in this branch, not a flaky test.'}
        </span>
      </>
    );
  } else if (same.status === 'failed') {
    body = (
      <>
        <span className="pl-aside__row">
          <StatusIcon status="failed" size={14} />
          Also failing on {base}
        </span>
        <span className="pl-aside__muted">
          Pipeline #{basePipeline.id}, {ago(when)} — probably not caused by this branch.
        </span>
      </>
    );
  } else {
    body = (
      <span className="pl-aside__row">
        <StatusIcon status={same.status} size={14} />
        On {base} this job was {same.status} ({ago(when)}).
      </span>
    );
  }

  return (
    <div className="pl-aside__block">
      <Label>{onBase ? 'Compared to the previous run' : `Compared to ${base}`}</Label>
      {body}
    </div>
  );
}

function JobFacts({ job, analysis }: { job: PipelineJob; analysis?: Analysis }) {
  const rows: [string, string | null | undefined][] = [
    ['Runner', job.runnerDescription],
    ['Image', analysis?.image],
    ['Duration', job.duration ? duration(job.duration) : null],
    ['Queued', job.queuedDuration ? duration(job.queuedDuration) : null],
    ['Started', job.startedAt ? ago(job.startedAt) : null],
    ['Exit code', analysis?.exitCode !== null && analysis?.exitCode !== undefined ? String(analysis.exitCode) : null],
  ];
  return (
    <div className="pl-aside__block pl-aside__facts">
      <Label>Job</Label>
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <span key={k} className="pl-aside__fact">
            {k} <span className="mono selectable">{v}</span>
          </span>
        ))}
      <button type="button" className="pl-aside__link" onClick={() => void openExternal(job.webUrl)}>
        Open job in GitLab
      </button>
    </div>
  );
}

function stateLine(job: PipelineJob): string {
  switch (job.status) {
    case 'success':
      return job.duration ? `Passed in ${duration(job.duration)}` : 'Passed';
    case 'failed':
      return job.allowFailure ? 'Failed, but allowed to fail' : 'Failed';
    case 'running':
      return job.duration ? `Running for ${duration(job.duration)}` : 'Running';
    case 'pending':
    case 'waiting_for_resource':
    case 'preparing':
      return 'Waiting for a runner';
    case 'created':
      return job.manual ? 'Manual — runs when you start it' : 'Waiting for earlier stages';
    case 'manual':
      return 'Manual — waiting for you to run it';
    case 'skipped':
      return 'Skipped';
    case 'canceled':
      return 'Canceled';
    default:
      return job.status;
  }
}

export function FailureAside(props: Props) {
  const { job, analysis, analysisLoading, mr, diffFiles, instanceId, projectId, pipelineId } = props;
  const failed = job.status === 'failed';

  if (!failed) {
    return (
      <div className="pl-aside__inner">
        <div className="pl-aside__block">
          <Label>Status</Label>
          <span className="pl-aside__state">
            <StatusIcon status={job.manual && job.status === 'created' ? 'manual' : job.status} size={16} />
            {stateLine(job)}
          </span>
          <span className="pl-aside__muted">
            {job.stage} stage{job.isBridge ? ' · triggers a downstream pipeline' : ''}
          </span>
          {canPlay(job) && (
            <div>
              <Button
                size="sm"
                icon={<PlayIcon size={12} />}
                onClick={() => void jobActions.play(instanceId, projectId, pipelineId, job)}
              >
                Run {job.name}
              </Button>
            </div>
          )}
          {job.downstreamPipeline?.projectId && (
            <button
              type="button"
              className="pl-aside__link"
              onClick={() =>
                navigate(paths.pipeline(instanceId, job.downstreamPipeline!.projectId!, job.downstreamPipeline!.id))
              }
            >
              Open downstream pipeline #{job.downstreamPipeline.id} →
            </button>
          )}
        </div>
        {(job.startedAt || job.runnerDescription) && <JobFacts job={job} analysis={analysis} />}
      </div>
    );
  }

  const changed = diffFiles ?? [];
  const related = (analysis?.locations ?? [])
    .map((loc) => ({ loc, file: changed.find((f) => samePath(loc.path, f.newPath)) }))
    .find((r) => r.file);
  // "What failed" points at the test when there is one; the related change covers the source.
  const primaryLoc =
    analysis?.locations.find((l) => /(^|\/)(tests?|spec|__tests__)\/|[._-](test|spec)\.\w+$/i.test(l.path)) ??
    analysis?.locations[0];
  const headline = analysis?.headline ?? `${job.name} failed`;

  return (
    <div className="pl-aside__inner">
      <div className="pl-aside__block">
        <Label>{job.allowFailure ? 'What failed (allowed to fail)' : 'What failed'}</Label>
        {analysisLoading && !analysis ? (
          <span className="pl-aside__row pl-aside__muted">
            <Spinner size={12} /> Reading the log…
          </span>
        ) : (
          <>
            <span className="pl-aside__headline selectable">{headline}</span>
            {analysis?.excerpt && <code className="pl-aside__excerpt">{analysis.excerpt}</code>}
            {primaryLoc && (
              <span className="pl-aside__loc mono selectable">
                {primaryLoc.path}
                {primaryLoc.line ? `:${primaryLoc.line}` : ''}
              </span>
            )}
          </>
        )}
      </div>

      {related && mr && (
        <div className="pl-aside__card">
          <Label>Likely related change</Label>
          <span className="mono selectable pl-aside__card-path">
            {related.file!.newPath}
            {related.loc.line ? `:${related.loc.line}` : ''}
          </span>
          <span className="pl-aside__muted">
            {CHANGE_WORD[related.file!.changeType] ?? 'Changed'} in this merge request (+{related.file!.additions} −
            {related.file!.deletions}), and the failure output points at it.
          </span>
          <button
            type="button"
            className="pl-aside__link pl-aside__link--strong"
            onClick={() => navigate(paths.review(mr.id, related.file!.newPath))}
          >
            Open in review →
          </button>
        </div>
      )}

      {isHardFail(job) && <Comparison {...props} />}

      <JobFacts job={job} analysis={analysis} />
    </div>
  );
}
