/**
 * Pipeline detail page showing jobs grouped by stage.
 *
 * Displays all jobs for a specific pipeline, organized by stage,
 * with the ability to trigger manual jobs, retry failed jobs, and cancel running jobs.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import TabBar from '../../components/TabBar';
import { openExternalUrl } from '../../services/transport';
import type { PipelineStatus } from '../../types';
import PipelineHeader from './PipelineHeader';
import JobsTab from './JobsTab';
import HistoryTab from './HistoryTab';
import { usePipelineData } from './usePipelineData';
import { groupJobsByStage } from './utils';
import { trackPipelineHistoryTabOpened, trackPipelineHistorySelected, trackShortcut } from '../../services/analytics';
import '../PipelineDetailPage.css';

type TabId = 'jobs' | 'history';

export default function PipelineDetailPage() {
  const { projectId, pipelineId } = useParams<{ projectId: string; pipelineId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const instanceId = Number(searchParams.get('instance') || 0);
  const projectName = searchParams.get('project') || '';
  const pipelineRef = searchParams.get('ref') || '';
  const pipelineWebUrl = searchParams.get('url') || '';

  const pid = Number(projectId);
  const plid = Number(pipelineId);

  const [activeTab, setActiveTab] = useState<TabId>('jobs');

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
    handleNavigateToJob,
  } = usePipelineData({
    instanceId,
    projectId: pid,
    pipelineId: plid,
  });

  // Switch to jobs tab when navigating to a different pipeline (e.g. from history)
  useEffect(() => {
    setActiveTab('jobs');
  }, [plid]);

  // Lazy-load history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  // Keyboard shortcuts: 1 = Jobs tab, 2 = History tab, Escape = back, o = open in browser
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        trackShortcut('Escape', 'go_back', 'pipeline_detail');
        navigate('/pipelines');
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
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, pipelineWebUrl]);

  const handleOpenPipeline = useCallback(
    (pipeline: PipelineStatus) => {
      trackPipelineHistorySelected(pid, pipeline.id);
      const params = new URLSearchParams({
        instance: String(instanceId),
        project: projectName,
        ref: pipeline.refName,
        url: pipeline.webUrl,
      });
      navigate(`/pipelines/${pid}/${pipeline.id}?${params.toString()}`);
    },
    [navigate, instanceId, pid, projectName]
  );

  const handleNavigate = useCallback(
    (job: Parameters<typeof handleNavigateToJob>[0]) => {
      handleNavigateToJob(job, navigate, { projectName, pipelineRef, pipelineWebUrl });
    },
    [handleNavigateToJob, navigate, projectName, pipelineRef, pipelineWebUrl]
  );

  const stages = groupJobsByStage(jobs);

  return (
    <div className="pipeline-detail-page">
      <PipelineHeader
        pipelineId={plid}
        pipelineStatus={pipelineStatus}
        projectName={projectName}
        pipelineRef={pipelineRef}
        pipelineWebUrl={pipelineWebUrl}
        onRefresh={refresh}
      />

      <TabBar<TabId>
        tabs={[
          { id: 'jobs', label: 'Jobs' },
          { id: 'history', label: 'History' },
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === 'history') trackPipelineHistoryTabOpened(pid, plid);
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
          onNavigate={handleNavigate}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab
          pipelines={pipelines}
          historyLoading={historyLoading}
          historyLoaded={historyLoaded}
          currentPipelineId={plid}
          onOpenPipeline={handleOpenPipeline}
          onCancelPipeline={handleCancelPipeline}
          pipelineActionLoading={pipelineActionLoading}
        />
      )}
    </div>
  );
}
