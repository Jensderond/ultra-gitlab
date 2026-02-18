import { useEffect, useRef } from 'react';
import type { PipelineStatus } from '../../types';
import { formatDuration, formatRelativeTime } from './utils';

interface HistoryTabProps {
  pipelines: PipelineStatus[];
  historyLoading: boolean;
  historyLoaded: boolean;
  currentPipelineId: number;
  onOpenPipeline: (pipeline: PipelineStatus) => void;
}

export default function HistoryTab({
  pipelines,
  historyLoading,
  historyLoaded,
  currentPipelineId,
  onOpenPipeline,
}: HistoryTabProps) {
  const historyListRef = useRef<HTMLDivElement>(null);

  // Auto-focus the current (or first) pipeline row when history becomes visible
  useEffect(() => {
    if (!historyLoaded) return;
    requestAnimationFrame(() => {
      const container = historyListRef.current;
      if (!container) return;
      const current = container.querySelector<HTMLButtonElement>('.pipeline-history-row--current');
      (current || container.querySelector<HTMLButtonElement>('.pipeline-history-row'))?.focus();
    });
  }, [historyLoaded]);

  if (historyLoading) {
    return (
      <main className="pipeline-detail-content">
        <div className="pipeline-detail-loading">Loading pipeline history...</div>
      </main>
    );
  }

  if (pipelines.length === 0) {
    return (
      <main className="pipeline-detail-content">
        <div className="pipeline-detail-empty">No pipelines found for this project.</div>
      </main>
    );
  }

  return (
    <main className="pipeline-detail-content">
      <div
        ref={historyListRef}
        className="pipeline-history-list"
        role="listbox"
        aria-label="Pipeline history"
        onKeyDown={(e) => {
          const down = e.key === 'ArrowDown' || e.key === 'j';
          const up = e.key === 'ArrowUp' || e.key === 'k';
          if (!down && !up) return;
          e.preventDefault();
          const items = e.currentTarget.querySelectorAll<HTMLButtonElement>('.pipeline-history-row');
          const idx = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
          const next = down
            ? Math.min(idx + 1, items.length - 1)
            : Math.max(idx - 1, 0);
          items[next]?.focus();
        }}
      >
        {pipelines.map((p) => (
          <button
            key={p.id}
            role="option"
            aria-selected={p.id === currentPipelineId}
            className={`pipeline-history-row ${p.id === currentPipelineId ? 'pipeline-history-row--current' : ''}`}
            onClick={() => onOpenPipeline(p)}
          >
            <span className={`pipeline-job-status-dot pipeline-job-status-dot--${p.status}`} />
            <div className="pipeline-history-info">
              <span className="pipeline-history-id">
                #{p.id}
                {p.id === currentPipelineId && <span className="pipeline-history-current-badge">current</span>}
              </span>
              <div className="pipeline-job-meta">
                <span className={`pipeline-job-status-label pipeline-job-status-label--${p.status}`}>
                  {p.status === 'success' ? 'passed' : p.status}
                </span>
                <span className="pipeline-detail-ref">{p.refName}</span>
                {p.duration != null && (
                  <span className="pipeline-job-duration">{formatDuration(p.duration)}</span>
                )}
                <span className="pipeline-job-time">{formatRelativeTime(p.createdAt)}</span>
              </div>
            </div>
            <span className="pipeline-history-sha">{p.sha}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
