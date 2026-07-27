import BackButton from '../../components/BackButton';
import { PageHeader } from '../../components/PageHeader';
import { openExternalUrl } from '../../services/transport';
import { RefreshIcon, ExternalLinkIcon } from './icons';

interface PipelineHeaderProps {
  pipelineId: number;
  pipelineStatus: string | null;
  projectName: string;
  pipelineRef: string;
  pipelineWebUrl: string;
  onRefresh: () => void;
  /** True while a refresh is in flight — drives the header's refresh feedback. */
  refreshing?: boolean;
  /** Click handler for the back button. If undefined, the back button is hidden. */
  onBack?: () => void;
  backTitle?: string;
}

export default function PipelineHeader({
  pipelineId,
  pipelineStatus,
  projectName,
  pipelineRef,
  pipelineWebUrl,
  onRefresh,
  refreshing = false,
  onBack,
  backTitle = 'Back to pipelines',
}: PipelineHeaderProps) {
  return (
    <PageHeader
      title={`Pipeline #${pipelineId}`}
      leading={onBack ? <BackButton onClick={onBack} title={backTitle} /> : undefined}
      refreshing={refreshing}
      meta={
        <>
          {pipelineStatus && (
            <span className={`pipeline-detail-status pipeline-badge pipeline-badge--${pipelineStatus}`}>
              {pipelineStatus === 'running' && <span className="pipeline-badge-pulse" />}
              {pipelineStatus}
            </span>
          )}
          {projectName && (
            <span className="pipeline-detail-project">{projectName}</span>
          )}
          {pipelineRef && (
            <span className="pipeline-detail-ref">{pipelineRef}</span>
          )}
        </>
      }
      actions={
        <>
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
        </>
      }
    />
  );
}
