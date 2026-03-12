import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  visitPipelineProject,
  togglePinPipelineProject,
  removePipelineProject,
} from '../../services/tauri';
import type { PipelineProject, PipelineStatus, ProjectSearchResult } from '../../types';
import { useInstancesQuery } from '../../hooks/queries/useInstancesQuery';
import { usePipelineProjectsQuery } from '../../hooks/queries/usePipelineProjectsQuery';
import { usePipelineStatusesQuery } from '../../hooks/queries/usePipelineStatusesQuery';
import { queryClient } from '../../lib/queryClient';
import { queryKeys } from '../../lib/queryKeys';

export default function usePipelinesData() {
  const navigate = useNavigate();

  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];

  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);

  // Auto-select default or first instance when instances load
  useEffect(() => {
    if (selectedInstanceId === null && instances.length > 0) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [selectedInstanceId, instances]);

  const projectsQuery = usePipelineProjectsQuery(selectedInstanceId);
  const projects = projectsQuery.data ?? [];

  const projectIds = useMemo(() => projects.map((p) => p.projectId), [projects]);

  const statusesQuery = usePipelineStatusesQuery(selectedInstanceId, projectIds);
  const statusList = statusesQuery.data ?? [];
  const statuses = useMemo(
    () => new Map(statusList.map((s) => [s.projectId, s])),
    [statusList]
  );

  const lastFetched = statusesQuery.dataUpdatedAt
    ? new Date(statusesQuery.dataUpdatedAt)
    : null;

  // Emit window events for pinned project status changes (skips first load)
  const prevStatusesRef = useRef<Map<number, PipelineStatus> | null>(null);
  useEffect(() => {
    if (statuses.size === 0) return;

    // Skip first successful load — just record the baseline
    if (prevStatusesRef.current === null) {
      prevStatusesRef.current = statuses;
      return;
    }

    const pinnedIds = new Set(projects.filter((p) => p.pinned).map((p) => p.projectId));
    for (const [projectId, newStatus] of statuses) {
      if (!pinnedIds.has(projectId)) continue;
      const oldStatus = prevStatusesRef.current.get(projectId);
      if (!oldStatus || oldStatus.status === newStatus.status) continue;

      const project = projects.find((p) => p.projectId === projectId);
      window.dispatchEvent(
        new CustomEvent('notification:pipeline-changed', {
          detail: {
            projectName: project?.nameWithNamespace ?? `Project ${projectId}`,
            oldStatus: oldStatus.status,
            newStatus: newStatus.status,
            refName: newStatus.refName,
            webUrl: newStatus.webUrl,
          },
        })
      );
    }
    prevStatusesRef.current = statuses;
  }, [statuses, projects]);

  const handleSelectResult = useCallback(
    async (result: ProjectSearchResult) => {
      if (!selectedInstanceId) return;
      try {
        await visitPipelineProject(selectedInstanceId, result.id);
        queryClient.removeQueries({ queryKey: ['pipelineStatuses'] });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineProjects(String(selectedInstanceId)),
        });
      } catch (error) {
        console.error('Failed to add project:', error);
      }
    },
    [selectedInstanceId]
  );

  const handleTogglePin = useCallback(
    async (projectId: number) => {
      if (!selectedInstanceId) return;
      try {
        await togglePinPipelineProject(selectedInstanceId, projectId);
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineProjects(String(selectedInstanceId)),
        });
      } catch (error) {
        console.error('Failed to toggle pin:', error);
      }
    },
    [selectedInstanceId]
  );

  const handleRemoveProject = useCallback(
    async (projectId: number) => {
      if (!selectedInstanceId) return;
      try {
        await removePipelineProject(selectedInstanceId, projectId);
        queryClient.removeQueries({ queryKey: ['pipelineStatuses'] });
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineProjects(String(selectedInstanceId)),
        });
      } catch (error) {
        console.error('Failed to remove project:', error);
      }
    },
    [selectedInstanceId]
  );

  const handleOpenDetail = useCallback(
    (project: PipelineProject, status: PipelineStatus) => {
      const params = new URLSearchParams({
        instance: String(project.instanceId),
        project: project.nameWithNamespace,
        ref: status.refName,
        url: status.webUrl,
      });
      navigate(`/pipelines/${project.projectId}/${status.id}?${params.toString()}`);
    },
    [navigate]
  );

  const handleSelectInstance = useCallback((id: number) => {
    setSelectedInstanceId(id);
    queryClient.removeQueries({ queryKey: ['pipelineStatuses'] });
    prevStatusesRef.current = null;
  }, []);

  return {
    instances,
    selectedInstanceId,
    projects,
    statuses,
    loading: projectsQuery.isLoading,
    statusesLoading: statusesQuery.isFetching,
    lastFetched,
    handleSelectResult,
    handleTogglePin,
    handleRemoveProject,
    handleOpenDetail,
    handleSelectInstance,
  };
}
