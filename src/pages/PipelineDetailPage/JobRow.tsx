import { openExternalUrl } from '../../services/transport';
import type { PipelineJob } from '../../types';
import { ExternalLinkIcon, PlayIcon, RetryIcon, CancelIcon, AutoRunIcon } from './icons';
import { jobStatusLabel, formatDuration, formatRelativeTime } from './utils';

interface JobRowProps {
  job: PipelineJob;
  loading: boolean;
  onPlay: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onCancel: (jobId: number) => void;
  onNavigate: (job: PipelineJob) => void;
  /** True when this manual job is armed for auto-run. */
  autoRunArmed: boolean;
  onToggleAutoRun: (job: PipelineJob) => void;
}

export default function JobRow({ job, loading, onPlay, onRetry, onCancel, onNavigate, autoRunArmed, onToggleAutoRun }: JobRowProps) {
  const canPlay = job.status === 'manual' || job.status === 'scheduled';
  const canRetry = job.status === 'failed' || job.status === 'canceled';
  const canCancel = job.status === 'running' || job.status === 'pending' || job.status === 'created';
  const canAutoRun = job.status === 'manual';
  // Bridges have no log; the row drills into the downstream pipeline instead,
  // which needs a project id to fetch jobs from.
  const navigable = !job.isBridge || job.downstreamPipeline?.projectId != null;

  const info = (
    <>
      <span className="pipeline-job-name">
        {job.name}
        {job.isBridge && (
          <span className="pipeline-job-trigger-badge" title="Trigger job — starts a downstream pipeline">
            trigger
          </span>
        )}
        {job.allowFailure && <span className="pipeline-job-allow-failure" title="Allowed to fail">!</span>}
      </span>
      <div className="pipeline-job-meta">
        <span className={`pipeline-job-status-label pipeline-job-status-label--${job.status}`}>
          {jobStatusLabel(job.status)}
        </span>
        {job.downstreamPipeline && (
          <span
            className={`pipeline-job-downstream pipeline-job-status-label--${job.downstreamPipeline.status}`}
            title={`Downstream pipeline #${job.downstreamPipeline.id}`}
          >
            ↓ #{job.downstreamPipeline.id} {job.downstreamPipeline.status}
          </span>
        )}
        {job.duration != null && (
          <span className="pipeline-job-duration">{formatDuration(job.duration)}</span>
        )}
        {job.startedAt && (
          <span className="pipeline-job-time">{formatRelativeTime(job.startedAt)}</span>
        )}
        {job.runnerDescription && (
          <span className="pipeline-job-runner" title={`Runner: ${job.runnerDescription}`}>
            {job.runnerDescription}
          </span>
        )}
      </div>
    </>
  );

  return (
    <div className={`pipeline-job-row pipeline-job-row--${job.status}`}>
      <span className={`pipeline-job-status-dot pipeline-job-status-dot--${job.status}`} />
      {navigable ? (
        <button
          type="button"
          className="pipeline-job-info pipeline-job-info--clickable"
          title={job.isBridge ? 'View downstream pipeline' : undefined}
          onClick={() => onNavigate(job)}
        >
          {info}
        </button>
      ) : (
        <div className="pipeline-job-info">{info}</div>
      )}
      <div className="pipeline-job-actions">
        {canPlay && (
          <button
            className="pipeline-job-action-btn pipeline-job-action-btn--play"
            onClick={() => onPlay(job.id)}
            disabled={loading}
            title="Trigger this manual job"
          >
            {loading ? <span className="pipeline-job-spinner" /> : <PlayIcon />}
            <span>Run</span>
          </button>
        )}
        {canAutoRun && (
          <button
            className={`pipeline-job-action-btn pipeline-job-action-btn--auto${autoRunArmed ? ' pipeline-job-action-btn--auto-armed' : ''}`}
            aria-pressed={autoRunArmed}
            onClick={() => onToggleAutoRun(job)}
            disabled={loading}
            title={
              autoRunArmed
                ? 'Armed: runs automatically once all prior stages succeed. Click to disarm.'
                : 'Run automatically once all prior stages succeed'
            }
          >
            <AutoRunIcon />
            <span>{autoRunArmed ? 'Armed' : 'Auto'}</span>
          </button>
        )}
        {canRetry && (
          <button
            className="pipeline-job-action-btn pipeline-job-action-btn--retry"
            onClick={() => onRetry(job.id)}
            disabled={loading}
            title="Retry this job"
          >
            {loading ? <span className="pipeline-job-spinner" /> : <RetryIcon />}
            <span>Retry</span>
          </button>
        )}
        {canCancel && (
          <button
            className="pipeline-job-action-btn pipeline-job-action-btn--cancel"
            onClick={() => onCancel(job.id)}
            disabled={loading}
            title="Cancel this job"
          >
            {loading ? <span className="pipeline-job-spinner" /> : <CancelIcon />}
            <span>Cancel</span>
          </button>
        )}
        <button
          className="pipeline-job-action-btn pipeline-job-action-btn--link"
          onClick={() => openExternalUrl(job.webUrl)}
          title="Open in browser"
        >
          <ExternalLinkIcon />
        </button>
      </div>
    </div>
  );
}
