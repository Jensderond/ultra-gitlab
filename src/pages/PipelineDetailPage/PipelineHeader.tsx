import BackButton from '../../components/BackButton';
import { openExternalUrl } from '../../services/transport';
import { RefreshIcon, ExternalLinkIcon } from './icons';

interface PipelineHeaderProps {
  pipelineId: number;
  pipelineStatus: string | null;
  projectName: string;
  pipelineRef: string;
  pipelineWebUrl: string;
  onRefresh: () => void;
}

export default function PipelineHeader({
  pipelineId,
  pipelineStatus,
  projectName,
  pipelineRef,
  pipelineWebUrl,
  onRefresh,
}: PipelineHeaderProps) {
  return (
    <header className="pipeline-detail-header">
      <div className="pipeline-detail-header-left">
        <BackButton to="/pipelines" title="Back to pipelines" />
        <div className="pipeline-detail-title-group">
          <h1>
            Pipeline #{pipelineId}
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
          onClick={onRefresh}
          title="Refresh"
        >
          <RefreshIcon />
        </button>
        {pipelineWebUrl && (
          <button
            className="pipeline-detail-action-btn"
            onClick={() => openExternalUrl(pipelineWebUrl)}
            title="Open in browser"
          >
            <ExternalLinkIcon />
          </button>
        )}
      </div>
    </header>
  );
}
