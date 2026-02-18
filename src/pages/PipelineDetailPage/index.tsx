/**
 * Pipeline detail page showing jobs grouped by stage.
 *
 * Displays all jobs for a specific pipeline, organized by stage,
 * with the ability to trigger manual jobs, retry failed jobs, and cancel running jobs.
 */

import { useState, useEffect, useReducer, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import TabBar from '../../components/TabBar';
import { openExternalUrl } from '../../services/transport';
import type { PipelineStatus } from '../../types';
import PipelineHeader from './PipelineHeader';
import JobsTab from './JobsTab';
import HistoryTab from './HistoryTab';
import { pipelineDetailReducer, initialState } from './pipelineDetailReducer';
import { usePipelineData } from './usePipelineData';
import { groupJobsByStage } from './utils';
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
  const [state, dispatch] = useReducer(pipelineDetailReducer, initialState);

  const {
    loadJobs,
    loadPipelineStatus,
    loadHistory,
    handlePlayJob,
    handleRetryJob,
    handleCancelJob,
    handleNavigateToJob,
  } = usePipelineData({
    instanceId,
    projectId: pid,
    pipelineId: plid,
    state,
    dispatch,
  });

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
        navigate('/pipelines');
      } else if (e.key === '1') {
        e.preventDefault();
        setActiveTab('jobs');
      } else if (e.key === '2') {
        e.preventDefault();
        setActiveTab('history');
      } else if ((e.key === 'o' || e.key === 'O') && pipelineWebUrl) {
        e.preventDefault();
        openExternalUrl(pipelineWebUrl);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, pipelineWebUrl]);

  const handleOpenPipeline = useCallback(
    (pipeline: PipelineStatus) => {
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

  const handleRefresh = useCallback(() => {
    loadJobs();
    loadPipelineStatus();
  }, [loadJobs, loadPipelineStatus]);

  const stages = groupJobsByStage(state.jobs);

  return (
    <div className="pipeline-detail-page">
      <PipelineHeader
        pipelineId={plid}
        pipelineStatus={state.pipelineStatus}
        projectName={projectName}
        pipelineRef={pipelineRef}
        pipelineWebUrl={pipelineWebUrl}
        onRefresh={handleRefresh}
      />

      <TabBar<TabId>
        tabs={[
          { id: 'jobs', label: 'Jobs' },
          { id: 'history', label: 'History' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === 'jobs' && (
        <JobsTab
          stages={stages}
          jobs={state.jobs}
          loading={state.loading}
          error={state.error}
          actionLoading={state.actionLoading}
          onPlay={handlePlayJob}
          onRetry={handleRetryJob}
          onCancel={handleCancelJob}
          onNavigate={handleNavigate}
        />
      )}

      {activeTab === 'history' && (
        <HistoryTab
          pipelines={state.pipelines}
          historyLoading={state.historyLoading}
          historyLoaded={state.historyLoaded}
          currentPipelineId={plid}
          onOpenPipeline={handleOpenPipeline}
        />
      )}
    </div>
  );
}
