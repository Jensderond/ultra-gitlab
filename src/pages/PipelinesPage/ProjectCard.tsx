import { openExternalUrl } from '../../services/transport';
import type { PipelineProject, PipelineStatus } from '../../types';
import { formatRelativeTime, statusLabel, formatDuration } from './utils';
import { PinIcon, RemoveIcon, ExternalLinkIcon, BranchIcon } from './icons';

interface ProjectCardProps {
  project: PipelineProject;
  status?: PipelineStatus;
  statusLoading: boolean;
  onTogglePin: (projectId: number) => void;
  onRemove: (projectId: number) => void;
  onOpenDetail: (project: PipelineProject, status: PipelineStatus) => void;
}

export default function ProjectCard({ project, status, statusLoading, onTogglePin, onRemove, onOpenDetail }: ProjectCardProps) {
  const statusName = status?.status;

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.pipeline-card-actions')) return;
    if (status) {
      onOpenDetail(project, status);
    }
  };

  return (
    <div
      className={`pipeline-card ${statusName ? `pipeline-card--${statusName}` : ''} ${status ? 'pipeline-card--clickable' : ''}`}
      onClick={handleCardClick}
    >
      <div className="pipeline-card-header">
        <span className="pipeline-card-name" title={project.nameWithNamespace}>
          {project.pinned && (
            <span className="pipeline-card-pin">
              <PinIcon filled />
            </span>
          )}
          {project.nameWithNamespace}
        </span>
        <div className="pipeline-card-actions">
          <button
            className="pipeline-card-action-btn"
            onClick={() => openExternalUrl(`${project.webUrl}/-/pipelines`)}
            title="Open in browser"
          >
            <ExternalLinkIcon />
          </button>
          <button
            className={`pipeline-card-action-btn ${project.pinned ? 'pipeline-card-action-btn--active' : ''}`}
            onClick={() => onTogglePin(project.projectId)}
            title={project.pinned ? 'Unpin project' : 'Pin project'}
          >
            <PinIcon filled={project.pinned} />
          </button>
          <button
            className="pipeline-card-action-btn pipeline-card-action-btn--remove"
            onClick={() => onRemove(project.projectId)}
            title="Remove from dashboard"
          >
            <RemoveIcon />
          </button>
        </div>
      </div>

      <div className="pipeline-card-status-row">
        {statusLoading && !status ? (
          <span className="pipeline-badge pipeline-badge--loading">loading</span>
        ) : status ? (
          <span className={`pipeline-badge pipeline-badge--${statusName}`}>
            {statusName === 'running' && <span className="pipeline-badge-pulse" />}
            {statusLabel(statusName!)}
          </span>
        ) : (
          <span className="pipeline-badge pipeline-badge--none">no pipeline</span>
        )}
        {status?.duration != null && (
          <span className="pipeline-card-duration">{formatDuration(status.duration)}</span>
        )}
      </div>

      {status && (
        <div className="pipeline-card-meta">
          <span className="pipeline-card-ref">
            <BranchIcon />
            {status.refName}
          </span>
          <span className="pipeline-card-sha">{status.sha}</span>
        </div>
      )}

      <div className="pipeline-card-footer">
        {status && (
          <span className="pipeline-card-time">
            {formatRelativeTime(status.createdAt)}
          </span>
        )}
        {project.lastVisitedAt && !status && (
          <span className="pipeline-card-time">
            visited {formatRelativeTime(project.lastVisitedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
