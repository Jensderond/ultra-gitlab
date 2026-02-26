import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import {
  getPipelineJobs,
  getPipelineStatuses,
  getProjectPipelines,
  playPipelineJob,
  retryPipelineJob,
  cancelPipelineJob,
  cancelPipeline,
} from '../../services/tauri';
import type { PipelineJob } from '../../types';
import type { PipelineDetailAction, PipelineDetailState } from './pipelineDetailReducer';

interface UsePipelineDataOptions {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  state: PipelineDetailState;
  dispatch: Dispatch<PipelineDetailAction>;
}

export function usePipelineData({
  instanceId,
  projectId,
  pipelineId,
  state,
  dispatch,
}: UsePipelineDataOptions) {
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadJobs = useCallback(async () => {
    if (!instanceId || !projectId || !pipelineId) return;
    try {
      const jobList = await getPipelineJobs(instanceId, projectId, pipelineId);
      dispatch({ type: 'JOBS_LOADED', jobs: jobList });
    } catch (err) {
      console.error('Failed to load pipeline jobs:', err);
      dispatch({ type: 'JOBS_ERROR', error: 'Failed to load pipeline jobs' });
    }
  }, [instanceId, projectId, pipelineId, dispatch]);

  const loadPipelineStatus = useCallback(async () => {
    if (!instanceId || !projectId) return;
    try {
      const statuses = await getPipelineStatuses(instanceId, [projectId]);
      const status = statuses.find((s) => s.id === pipelineId);
      if (status) {
        dispatch({ type: 'PIPELINE_STATUS', status: status.status });
      }
    } catch {
      // Non-critical
    }
  }, [instanceId, projectId, pipelineId, dispatch]);

  // Initial load + reset on param change
  useEffect(() => {
    dispatch({ type: 'RESET' });
    loadJobs();
    loadPipelineStatus();
  }, [loadJobs, loadPipelineStatus, dispatch]);

  // Auto-refresh when pipeline is active
  useEffect(() => {
    const hasActive = state.jobs.some(
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
  }, [state.jobs, loadJobs, loadPipelineStatus]);

  // Lazy-load pipeline history when switching to the history tab
  const loadHistory = useCallback(async () => {
    if (state.historyLoaded || !instanceId || !projectId) return;
    dispatch({ type: 'HISTORY_LOADING' });
    try {
      const list = await getProjectPipelines(instanceId, projectId, 20);
      dispatch({ type: 'HISTORY_LOADED', pipelines: list });
    } catch (err) {
      console.error('Failed to load pipeline history:', err);
      dispatch({ type: 'HISTORY_LOADED', pipelines: [] });
    }
  }, [state.historyLoaded, instanceId, projectId, dispatch]);

  // Job actions
  const handlePlayJob = useCallback(
    async (jobId: number) => {
      dispatch({ type: 'ACTION_START', jobId });
      try {
        const updated = await playPipelineJob(instanceId, projectId, jobId);
        dispatch({ type: 'UPDATE_JOB', job: updated });
      } catch (err) {
        console.error('Failed to play job:', err);
      } finally {
        dispatch({ type: 'ACTION_END', jobId });
        setTimeout(loadJobs, 1500);
      }
    },
    [instanceId, projectId, loadJobs, dispatch]
  );

  const handleRetryJob = useCallback(
    async (jobId: number) => {
      dispatch({ type: 'ACTION_START', jobId });
      try {
        await retryPipelineJob(instanceId, projectId, jobId);
      } catch (err) {
        console.error('Failed to retry job:', err);
      } finally {
        dispatch({ type: 'ACTION_END', jobId });
        setTimeout(loadJobs, 1500);
      }
    },
    [instanceId, projectId, loadJobs, dispatch]
  );

  const handleCancelJob = useCallback(
    async (jobId: number) => {
      dispatch({ type: 'ACTION_START', jobId });
      try {
        const updated = await cancelPipelineJob(instanceId, projectId, jobId);
        dispatch({ type: 'UPDATE_JOB', job: updated });
      } catch (err) {
        console.error('Failed to cancel job:', err);
      } finally {
        dispatch({ type: 'ACTION_END', jobId });
        setTimeout(loadJobs, 1500);
      }
    },
    [instanceId, projectId, loadJobs, dispatch]
  );

  const reloadHistory = useCallback(async () => {
    if (!instanceId || !projectId) return;
    dispatch({ type: 'HISTORY_LOADING' });
    try {
      const list = await getProjectPipelines(instanceId, projectId, 20);
      dispatch({ type: 'HISTORY_LOADED', pipelines: list });
    } catch (err) {
      console.error('Failed to reload pipeline history:', err);
      dispatch({ type: 'HISTORY_LOADED', pipelines: [] });
    }
  }, [instanceId, projectId, dispatch]);

  const handleCancelPipeline = useCallback(
    async (cancelPipelineId: number) => {
      dispatch({ type: 'PIPELINE_ACTION_START', pipelineId: cancelPipelineId });
      try {
        const updated = await cancelPipeline(instanceId, projectId, cancelPipelineId);
        dispatch({ type: 'UPDATE_PIPELINE', pipeline: updated });
      } catch (err) {
        console.error('Failed to cancel pipeline:', err);
      } finally {
        dispatch({ type: 'PIPELINE_ACTION_END', pipelineId: cancelPipelineId });
        setTimeout(() => {
          reloadHistory();
          loadJobs();
        }, 1500);
      }
    },
    [instanceId, projectId, reloadHistory, loadJobs, dispatch]
  );

  const handleNavigateToJob = useCallback(
    (job: PipelineJob, navigate: (path: string) => void, params: { projectName: string; pipelineRef: string; pipelineWebUrl: string }) => {
      const searchParams = new URLSearchParams({
        instance: String(instanceId),
        name: job.name,
        status: job.status,
        stage: job.stage,
        project: params.projectName,
        ref: params.pipelineRef,
      });
      if (job.duration != null) {
        searchParams.set('duration', String(job.duration));
      }
      if (params.pipelineWebUrl) {
        searchParams.set('url', params.pipelineWebUrl);
      }
      if (job.webUrl) {
        searchParams.set('jobUrl', job.webUrl);
      }
      navigate(`/pipelines/${projectId}/${pipelineId}/jobs/${job.id}?${searchParams.toString()}`);
    },
    [instanceId, projectId, pipelineId]
  );

  return {
    loadJobs,
    loadPipelineStatus,
    loadHistory,
    handlePlayJob,
    handleRetryJob,
    handleCancelJob,
    handleCancelPipeline,
    handleNavigateToJob,
  };
}
