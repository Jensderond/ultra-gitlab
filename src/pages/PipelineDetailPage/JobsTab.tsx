import type { PipelineJob } from '../../types';
import JobRow from './JobRow';
import type { StageGroup } from './utils';

interface JobsTabProps {
  stages: StageGroup[];
  jobs: PipelineJob[];
  loading: boolean;
  error: string | null;
  actionLoading: Set<number>;
  onPlay: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onCancel: (jobId: number) => void;
  onNavigate: (job: PipelineJob) => void;
}

export default function JobsTab({
  stages,
  jobs,
  loading,
  error,
  actionLoading,
  onPlay,
  onRetry,
  onCancel,
  onNavigate,
}: JobsTabProps) {
  return (
    <>
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
                      onPlay={onPlay}
                      onRetry={onRetry}
                      onCancel={onCancel}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
