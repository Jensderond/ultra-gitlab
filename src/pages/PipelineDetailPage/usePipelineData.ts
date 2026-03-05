import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getPipelineStatuses,
  getProjectPipelines,
  playPipelineJob,
  retryPipelineJob,
  cancelPipelineJob,
  cancelPipeline,
} from '../../services/tauri';
import type { PipelineJob } from '../../types';
import { usePipelineJobsQuery } from '../../hooks/queries/usePipelineJobsQuery';
import { queryClient } from '../../lib/queryClient';
import { queryKeys } from '../../lib/queryKeys';

interface UsePipelineDataOptions {
  instanceId: number;
  projectId: number;
  pipelineId: number;
}

export function usePipelineData({
  instanceId,
  projectId,
  pipelineId,
}: UsePipelineDataOptions) {
  const jobsQuery = usePipelineJobsQuery(instanceId, projectId, pipelineId);

  const [activeActions, setActiveActions] = useState<Set<number>>(new Set());
  const [pipelineActionLoading, setPipelineActionLoading] = useState<Set<number>>(new Set());

  // Pipeline overall status
  const statusesQuery = useQuery({
    queryKey: queryKeys.pipelineStatuses(String(instanceId), [projectId]),
    queryFn: () => getPipelineStatuses(instanceId, [projectId]),
    enabled: !!instanceId && !!projectId,
    staleTime: 30_000,
  });
  const pipelineStatus =
    statusesQuery.data?.find((s) => s.id === pipelineId)?.status ?? null;

  // History is lazy — only enabled when the History tab is opened
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const historyQuery = useQuery({
    queryKey: queryKeys.pipelineHistory(String(instanceId), projectId),
    queryFn: () => getProjectPipelines(instanceId, projectId, 20),
    enabled: historyEnabled && !!instanceId && !!projectId,
    staleTime: 30_000,
  });

  const loadHistory = useCallback(() => {
    setHistoryEnabled(true);
  }, []);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.pipelineJobs(String(instanceId), projectId, pipelineId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.pipelineStatuses(String(instanceId), [projectId]),
    });
  }, [instanceId, projectId, pipelineId]);

  // Job actions
  const handlePlayJob = useCallback(
    async (jobId: number) => {
      setActiveActions((prev) => new Set(prev).add(jobId));
      try {
        await playPipelineJob(instanceId, projectId, jobId);
      } catch (err) {
        console.error('Failed to play job:', err);
      } finally {
        setActiveActions((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineJobs(String(instanceId), projectId, pipelineId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineStatuses(String(instanceId), [projectId]),
        });
      }
    },
    [instanceId, projectId, pipelineId]
  );

  const handleRetryJob = useCallback(
    async (jobId: number) => {
      setActiveActions((prev) => new Set(prev).add(jobId));
      try {
        await retryPipelineJob(instanceId, projectId, jobId);
      } catch (err) {
        console.error('Failed to retry job:', err);
      } finally {
        setActiveActions((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineJobs(String(instanceId), projectId, pipelineId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineStatuses(String(instanceId), [projectId]),
        });
      }
    },
    [instanceId, projectId, pipelineId]
  );

  const handleCancelJob = useCallback(
    async (jobId: number) => {
      setActiveActions((prev) => new Set(prev).add(jobId));
      try {
        await cancelPipelineJob(instanceId, projectId, jobId);
      } catch (err) {
        console.error('Failed to cancel job:', err);
      } finally {
        setActiveActions((prev) => {
          const next = new Set(prev);
          next.delete(jobId);
          return next;
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineJobs(String(instanceId), projectId, pipelineId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineStatuses(String(instanceId), [projectId]),
        });
      }
    },
    [instanceId, projectId, pipelineId]
  );

  const handleCancelPipeline = useCallback(
    async (cancelPipelineId: number) => {
      setPipelineActionLoading((prev) => new Set(prev).add(cancelPipelineId));
      try {
        await cancelPipeline(instanceId, projectId, cancelPipelineId);
      } catch (err) {
        console.error('Failed to cancel pipeline:', err);
      } finally {
        setPipelineActionLoading((prev) => {
          const next = new Set(prev);
          next.delete(cancelPipelineId);
          return next;
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineHistory(String(instanceId), projectId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineJobs(String(instanceId), projectId, pipelineId),
        });
      }
    },
    [instanceId, projectId, pipelineId]
  );

  const handleNavigateToJob = useCallback(
    (
      job: PipelineJob,
      navigate: (path: string) => void,
      params: { projectName: string; pipelineRef: string; pipelineWebUrl: string }
    ) => {
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
    jobs: jobsQuery.data ?? [],
    loading: jobsQuery.isLoading,
    error: jobsQuery.error ? 'Failed to load pipeline jobs' : null,
    actionLoading: activeActions,
    pipelineStatus,
    pipelineActionLoading,
    pipelines: historyQuery.data ?? [],
    historyLoading: historyQuery.isLoading && historyEnabled,
    historyLoaded: historyEnabled && (historyQuery.isSuccess || historyQuery.isError),
    refresh,
    loadHistory,
    handlePlayJob,
    handleRetryJob,
    handleCancelJob,
    handleCancelPipeline,
    handleNavigateToJob,
  };
}
