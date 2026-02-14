/**
 * Pipeline detail page showing jobs grouped by stage.
 *
 * Displays all jobs for a specific pipeline, organized by stage,
 * with the ability to trigger manual jobs, retry failed jobs, and cancel running jobs.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  getPipelineJobs,
  getPipelineStatuses,
  playPipelineJob,
  retryPipelineJob,
  cancelPipelineJob,
} from '../services/tauri';
import type { PipelineJob, PipelineJobStatus } from '../types';
import './PipelineDetailPage.css';

/**
 * Format duration from seconds into human-readable form.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Format an ISO 8601 date string as a relative time string.
 */
function formatRelativeTime(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString();
}

/**
 * Human-readable status label.
 */
function jobStatusLabel(status: PipelineJobStatus): string {
  switch (status) {
    case 'success': return 'passed';
    case 'failed': return 'failed';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'canceled': return 'canceled';
    case 'skipped': return 'skipped';
    case 'manual': return 'manual';
    case 'created': return 'created';
    case 'waiting_for_resource': return 'waiting';
    case 'preparing': return 'preparing';
    case 'scheduled': return 'scheduled';
  }
}

// SVG icon components
function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5z"/>
      <path d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0v-5z"/>
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
      <path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
    </svg>
  );
}

function CancelIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
      <path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
    </svg>
  );
}

/**
 * Map status to a stage-level aggregate:
 * If any job in a stage is running -> running
 * If any job failed (and !allowFailure) -> failed
 * If all passed -> success
 * etc.
 */
function aggregateStageStatus(jobs: PipelineJob[]): PipelineJobStatus {
  if (jobs.some((j) => j.status === 'running')) return 'running';
  if (jobs.some((j) => j.status === 'pending')) return 'pending';
  if (jobs.some((j) => j.status === 'preparing')) return 'preparing';
  if (jobs.some((j) => j.status === 'waiting_for_resource')) return 'waiting_for_resource';
  if (jobs.some((j) => j.status === 'failed' && !j.allowFailure)) return 'failed';
  if (jobs.some((j) => j.status === 'canceled')) return 'canceled';
  if (jobs.some((j) => j.status === 'manual')) return 'manual';
  if (jobs.some((j) => j.status === 'scheduled')) return 'scheduled';
  if (jobs.some((j) => j.status === 'created')) return 'created';
  if (jobs.every((j) => j.status === 'skipped')) return 'skipped';
  if (jobs.every((j) => j.status === 'success' || (j.status === 'failed' && j.allowFailure) || j.status === 'skipped'))
    return 'success';
  return 'created';
}

interface StageGroup {
  name: string;
  jobs: PipelineJob[];
  status: PipelineJobStatus;
}

export default function PipelineDetailPage() {
  const { projectId, pipelineId } = useParams<{ projectId: string; pipelineId: string }>();
  const [searchParams] = useSearchParams();
  const instanceId = Number(searchParams.get('instance') || 0);
  const projectName = searchParams.get('project') || '';
  const pipelineRef = searchParams.get('ref') || '';
  const pipelineWebUrl = searchParams.get('url') || '';

  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Set<number>>(new Set());
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pid = Number(projectId);
  const plid = Number(pipelineId);

  // Load jobs
  const loadJobs = useCallback(async () => {
    if (!instanceId || !pid || !plid) return;
    try {
      const jobList = await getPipelineJobs(instanceId, pid, plid);
      setJobs(jobList);
      setError(null);
    } catch (err) {
      console.error('Failed to load pipeline jobs:', err);
      setError('Failed to load pipeline jobs');
    } finally {
      setLoading(false);
    }
  }, [instanceId, pid, plid]);

  // Load pipeline status
  const loadPipelineStatus = useCallback(async () => {
    if (!instanceId || !pid) return;
    try {
      const statuses = await getPipelineStatuses(instanceId, [pid]);
      const status = statuses.find((s) => s.id === plid);
      if (status) {
        setPipelineStatus(status.status);
      }
    } catch {
      // Non-critical
    }
  }, [instanceId, pid, plid]);

  useEffect(() => {
    setLoading(true);
    loadJobs();
    loadPipelineStatus();
  }, [loadJobs, loadPipelineStatus]);

  // Auto-refresh when pipeline is active
  useEffect(() => {
    const hasActive = jobs.some(
      (j) => j.status === 'running' || j.status === 'pending' || j.status === 'preparing'
    );

    if (!hasActive) return;

    function scheduleNextPoll() {
      pollTimerRef.current = setTimeout(async () => {
        if (document.visibilityState === 'visible') {
          await loadJobs();
          await loadPipelineStatus();
        }
        scheduleNextPoll();
      }, 10_000);
    }

    scheduleNextPoll();

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [jobs, loadJobs, loadPipelineStatus]);

  // Job actions
  const handlePlayJob = useCallback(
    async (jobId: number) => {
      setActionLoading((prev) => new Set(prev).add(jobId));
      try {
        const updated = await playPipelineJob(instanceId, pid, jobId);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      } catch (err) {
        console.error('Failed to play job:', err);
      } finally {
        setActionLoading((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        // Refresh all jobs after a short delay to get updated downstream state
        setTimeout(loadJobs, 1500);
      }
    },
    [instanceId, pid, loadJobs]
  );

  const handleRetryJob = useCallback(
    async (jobId: number) => {
      setActionLoading((prev) => new Set(prev).add(jobId));
      try {
        await retryPipelineJob(instanceId, pid, jobId);
      } catch (err) {
        console.error('Failed to retry job:', err);
      } finally {
        setActionLoading((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        setTimeout(loadJobs, 1500);
      }
    },
    [instanceId, pid, loadJobs]
  );

  const handleCancelJob = useCallback(
    async (jobId: number) => {
      setActionLoading((prev) => new Set(prev).add(jobId));
      try {
        const updated = await cancelPipelineJob(instanceId, pid, jobId);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
      } catch (err) {
        console.error('Failed to cancel job:', err);
      } finally {
        setActionLoading((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        setTimeout(loadJobs, 1500);
      }
    },
    [instanceId, pid, loadJobs]
  );

  // Group jobs by stage, preserving stage order from the pipeline
  const stages: StageGroup[] = (() => {
    const stageMap = new Map<string, PipelineJob[]>();
    const stageOrder: string[] = [];

    for (const job of jobs) {
      if (!stageMap.has(job.stage)) {
        stageMap.set(job.stage, []);
        stageOrder.push(job.stage);
      }
      stageMap.get(job.stage)!.push(job);
    }

    return stageOrder.map((name) => {
      const stageJobs = stageMap.get(name)!;
      return {
        name,
        jobs: stageJobs,
        status: aggregateStageStatus(stageJobs),
      };
    });
  })();

  return (
    <div className="pipeline-detail-page">
      <header className="pipeline-detail-header">
        <div className="pipeline-detail-header-left">
          <BackButton to="/pipelines" title="Back to pipelines" />
          <div className="pipeline-detail-title-group">
            <h1>
              Pipeline #{plid}
              {pipelineStatus && (
                <span className={`pipeline-detail-status pipeline-badge pipeline-badge--${pipelineStatus}`}>
                  {pipelineStatus === 'running' && <span className="pipeline-badge-pulse" />}
                  {pipelineStatus}
                </span>
              )}
            </h1>
            {projectName && (
              <span className="pipeline-detail-project">{projectName}</span>
            )}
            {pipelineRef && (
              <span className="pipeline-detail-ref">{pipelineRef}</span>
            )}
          </div>
        </div>
        <div className="pipeline-detail-header-actions">
          <button
            className="pipeline-detail-action-btn"
            onClick={() => { loadJobs(); loadPipelineStatus(); }}
            title="Refresh"
          >
            <RefreshIcon />
          </button>
          {pipelineWebUrl && (
            <button
              className="pipeline-detail-action-btn"
              onClick={() => openUrl(pipelineWebUrl)}
              title="Open in browser"
            >
              <ExternalLinkIcon />
            </button>
          )}
        </div>
      </header>

      {/* Stage mini-pipeline overview */}
      {stages.length > 0 && (
        <div className="pipeline-stages-bar">
          {stages.map((stage, i) => (
            <div key={stage.name} className="pipeline-stage-chip-wrapper">
              {i > 0 && <span className="pipeline-stage-connector" />}
              <span className={`pipeline-stage-chip pipeline-stage-chip--${stage.status}`}>
                {stage.status === 'running' && <span className="pipeline-badge-pulse" />}
                {stage.name}
              </span>
            </div>
          ))}
        </div>
      )}

      <main className="pipeline-detail-content">
        {loading ? (
          <div className="pipeline-detail-loading">Loading jobs...</div>
        ) : error ? (
          <div className="pipeline-detail-error">{error}</div>
        ) : jobs.length === 0 ? (
          <div className="pipeline-detail-empty">No jobs found for this pipeline.</div>
        ) : (
          <div className="pipeline-stages">
            {stages.map((stage) => (
              <section key={stage.name} className="pipeline-stage-section">
                <div className="pipeline-stage-header">
                  <span className={`pipeline-stage-indicator pipeline-stage-indicator--${stage.status}`} />
                  <h2 className="pipeline-stage-name">{stage.name}</h2>
                  <span className="pipeline-stage-count">{stage.jobs.length} {stage.jobs.length === 1 ? 'job' : 'jobs'}</span>
                </div>
                <div className="pipeline-jobs-list">
                  {stage.jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      loading={actionLoading.has(job.id)}
                      onPlay={handlePlayJob}
                      onRetry={handleRetryJob}
                      onCancel={handleCancelJob}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JobRow
// ---------------------------------------------------------------------------

interface JobRowProps {
  job: PipelineJob;
  loading: boolean;
  onPlay: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onCancel: (jobId: number) => void;
}

function JobRow({ job, loading, onPlay, onRetry, onCancel }: JobRowProps) {
  const canPlay = job.status === 'manual' || job.status === 'scheduled';
  const canRetry = job.status === 'failed' || job.status === 'canceled';
  const canCancel = job.status === 'running' || job.status === 'pending' || job.status === 'created';

  return (
    <div className={`pipeline-job-row pipeline-job-row--${job.status}`}>
      <span className={`pipeline-job-status-dot pipeline-job-status-dot--${job.status}`} />
      <div className="pipeline-job-info">
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
      </div>
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
          onClick={() => openUrl(job.webUrl)}
          title="Open in browser"
        >
          <ExternalLinkIcon />
        </button>
      </div>
    </div>
  );
}
