import { openExternalUrl } from '../../services/transport';
import type { PipelineJob } from '../../types';
import { ExternalLinkIcon, PlayIcon, RetryIcon, CancelIcon } from './icons';
import { jobStatusLabel, formatDuration, formatRelativeTime } from './utils';

interface JobRowProps {
  job: PipelineJob;
  loading: boolean;
  onPlay: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onCancel: (jobId: number) => void;
  onNavigate: (job: PipelineJob) => void;
}

export default function JobRow({ job, loading, onPlay, onRetry, onCancel, onNavigate }: JobRowProps) {
  const canPlay = job.status === 'manual' || job.status === 'scheduled';
  const canRetry = job.status === 'failed' || job.status === 'canceled';
  const canCancel = job.status === 'running' || job.status === 'pending' || job.status === 'created';

  return (
    <div className={`pipeline-job-row pipeline-job-row--${job.status}`}>
      <span className={`pipeline-job-status-dot pipeline-job-status-dot--${job.status}`} />
      <button type="button" className="pipeline-job-info pipeline-job-info--clickable" onClick={() => onNavigate(job)}>
        <span className="pipeline-job-name">
          {job.name}
          {job.allowFailure && <span className="pipeline-job-allow-failure" title="Allowed to fail">!</span>}
        </span>
        <div className="pipeline-job-meta">
          <span className={`pipeline-job-status-label pipeline-job-status-label--${job.status}`}>
            {jobStatusLabel(job.status)}
          </span>
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
      </button>
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
