import { useState, useEffect, useCallback } from 'react';
import TabBar from '../../components/TabBar';
import { openExternalUrl } from '../../services/transport';
import { useCopyToast } from '../../hooks/useCopyToast';
import type { PipelineJob, PipelineStatus } from '../../types';
import PipelineHeader from './PipelineHeader';
import JobsTab from './JobsTab';
import HistoryTab from './HistoryTab';
import { usePipelineData } from './usePipelineData';
import { useAutoRun } from '../../hooks/useAutoRun';
import { groupJobsByStage } from './utils';
import {
  trackPipelineHistoryTabOpened,
  trackPipelineHistorySelected,
  trackShortcut,
} from '../../services/analytics';

type TabId = 'jobs' | 'history';

export interface PipelineDetailViewProps {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  projectName: string;
  pipelineRef: string;
  pipelineWebUrl: string;
  /** When false, keyboard shortcuts are not bound (another layer is on top). */
  isActive: boolean;
  /** Close the view (page navigates back to /pipelines; dialog dismisses). */
  onClose: () => void;
  /** Open another pipeline (history click). */
  onSelectPipeline: (pipeline: PipelineStatus) => void;
  /** Open a job. */
  onSelectJob: (job: PipelineJob) => void;
  /** Render the back button in the header. Pages use it; dialogs hide it. */
  showBackButton?: boolean;
  backTitle?: string;
}

export default function PipelineDetailView({
  instanceId,
  projectId,
  pipelineId,
  projectName,
  pipelineRef,
  pipelineWebUrl,
  isActive,
  onClose,
  onSelectPipeline,
  onSelectJob,
  showBackButton = true,
  backTitle = 'Back to pipelines',
}: PipelineDetailViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>('jobs');
  const [showCopyToast, copyToClipboard] = useCopyToast();

  const {
    jobs,
    loading,
    error,
    actionLoading,
    pipelineStatus,
    pipelineActionLoading,
    pipelines,
    historyLoading,
    historyLoaded,
    refresh,
    loadHistory,
    handlePlayJob,
    handleRetryJob,
    handleCancelJob,
    handleCancelPipeline,
  } = usePipelineData({
    instanceId,
    projectId,
    pipelineId,
  });

  const { armedJobIds, toggleAutoRun } = useAutoRun(
    instanceId,
    projectId,
    pipelineId,
    pipelineRef || null,
  );

  useEffect(() => {
    setActiveTab('jobs');
  }, [pipelineId]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  useEffect(() => {
    if (!isActive) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        trackShortcut('Escape', 'go_back', 'pipeline_detail');
        onClose();
      } else if (e.key === '1') {
        e.preventDefault();
        trackShortcut('1', 'switch_tab_jobs', 'pipeline_detail');
        setActiveTab('jobs');
      } else if (e.key === '2') {
        e.preventDefault();
        trackShortcut('2', 'switch_tab_history', 'pipeline_detail');
        setActiveTab('history');
      } else if ((e.key === 'o' || e.key === 'O') && pipelineWebUrl) {
        e.preventDefault();
        trackShortcut('o', 'open_in_browser', 'pipeline_detail');
        openExternalUrl(pipelineWebUrl);
      } else if ((e.key === 'y' || e.key === 'Y') && pipelineWebUrl) {
        e.preventDefault();
        trackShortcut('y', 'copy_link', 'pipeline_detail');
        copyToClipboard(pipelineWebUrl);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, onClose, pipelineWebUrl, copyToClipboard]);

  const handleOpenPipeline = useCallback(
    (pipeline: PipelineStatus) => {
      trackPipelineHistorySelected(projectId, pipeline.id);
      onSelectPipeline(pipeline);
    },
    [onSelectPipeline, projectId]
  );

  const stages = groupJobsByStage(jobs);

  return (
    <div className="pipeline-detail-page">
      <PipelineHeader
        pipelineId={pipelineId}
        pipelineStatus={pipelineStatus}
        projectName={projectName}
        pipelineRef={pipelineRef}
        pipelineWebUrl={pipelineWebUrl}
        onRefresh={refresh}
        onBack={showBackButton ? onClose : undefined}
        backTitle={backTitle}
      />

      <TabBar<TabId>
        tabs={[
          { id: 'jobs', label: 'Jobs' },
          { id: 'history', label: 'History' },
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === 'history') trackPipelineHistoryTabOpened(projectId, pipelineId);
          setActiveTab(tab);
        }}
      />

      {activeTab === 'jobs' && (
        <JobsTab
          stages={stages}
          jobs={jobs}
          loading={loading}
          error={error}
          actionLoading={actionLoading}
          onPlay={handlePlayJob}
          onRetry={handleRetryJob}
          onCancel={handleCancelJob}
          onNavigate={onSelectJob}
          armedJobIds={armedJobIds}
          onToggleAutoRun={toggleAutoRun}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab
          pipelines={pipelines}
          historyLoading={historyLoading}
          historyLoaded={historyLoaded}
          currentPipelineId={pipelineId}
          onOpenPipeline={handleOpenPipeline}
          onCancelPipeline={handleCancelPipeline}
          pipelineActionLoading={pipelineActionLoading}
        />
      )}

      {showCopyToast && (
        <div className="copy-toast">Link copied</div>
      )}
    </div>
  );
}
