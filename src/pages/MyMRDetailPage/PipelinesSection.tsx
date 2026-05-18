/**
 * Pipelines section — lists pipelines attached to the MR with their status,
 * branch, and timing. Clicking a row opens the pipeline detail in a dialog
 * overlay so the MR detail page stays in view.
 */

import { useState } from 'react';
import { useMRPipelinesQuery } from '../../hooks/queries/useMRPipelinesQuery';
import { formatRelativeTime, formatDuration, statusLabel } from '../PipelinesPage/utils';
import { PipelineDetailDialog } from '../PipelineDetailPage/PipelineDetailDialog';
import type { PipelineStatus } from '../../types';

interface PipelinesSectionProps {
  mrId: number;
  instanceId: number;
  projectName: string;
}

export function PipelinesSection({ mrId, instanceId, projectName }: PipelinesSectionProps) {
  const { data, isLoading, isError, isFetching, error, refetch } = useMRPipelinesQuery(mrId, true);
  const pipelines: PipelineStatus[] = data ?? [];
  const [openPipeline, setOpenPipeline] = useState<PipelineStatus | null>(null);

  return (
    <section className="my-mr-overview-section">
      <h3>
        Pipelines
        {pipelines.length > 0 && (
          <span className="my-mr-approval-summary">
            {pipelines.length} total
          </span>
        )}
        <button
          type="button"
          className={`my-mr-section-refresh${isFetching ? ' is-fetching' : ''}`}
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh pipelines"
          title="Refresh pipelines"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </h3>
      {isLoading ? (
        <p className="my-mr-merge-status-text">Loading pipelines…</p>
      ) : isError ? (
        <p className="my-mr-merge-error">
          {error instanceof Error ? error.message : 'Failed to load pipelines'}
        </p>
      ) : pipelines.length === 0 ? (
        <p className="my-mr-no-reviewers">No pipelines for this MR</p>
      ) : (
        <ul className="my-mr-pipeline-list">
          {pipelines.map((p) => (
            <li
              key={p.id}
              className={`my-mr-pipeline-row pipeline-card--${p.status}`}
              onClick={() => setOpenPipeline(p)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenPipeline(p);
                }
              }}
            >
              <span className="my-mr-pipeline-status-chip">{statusLabel(p.status)}</span>
              <span className="my-mr-pipeline-id">#{p.id}</span>
              <code className="my-mr-pipeline-ref">{p.refName}</code>
              <span className="my-mr-pipeline-sha">{p.sha}</span>
              <span className="my-mr-pipeline-time">{formatRelativeTime(p.createdAt)}</span>
              {p.duration != null && (
                <span className="my-mr-pipeline-duration">{formatDuration(p.duration)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {openPipeline && (
        <PipelineDetailDialog
          key={openPipeline.id}
          instanceId={instanceId}
          projectId={openPipeline.projectId}
          pipelineId={openPipeline.id}
          projectName={projectName}
          pipelineRef={openPipeline.refName}
          pipelineWebUrl={openPipeline.webUrl}
          onClose={() => setOpenPipeline(null)}
        />
      )}
    </section>
  );
}
