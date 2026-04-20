import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  visitPipelineProject,
  togglePinPipelineProject,
  removePipelineProject,
  reorderPinnedPipelineProjects,
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

  const handleReorderPinned = useCallback(
    async (orderedPinnedIds: number[]) => {
      if (!selectedInstanceId) return;
      const key = queryKeys.pipelineProjects(String(selectedInstanceId));
      const previous = queryClient.getQueryData<PipelineProject[]>(key);
      if (previous) {
        const byId = new Map(previous.map((p) => [p.projectId, p]));
        const reorderedPinned = orderedPinnedIds
          .map((id) => byId.get(id))
          .filter((p): p is PipelineProject => !!p);
        const unpinned = previous.filter((p) => !p.pinned);
        queryClient.setQueryData<PipelineProject[]>(key, [...reorderedPinned, ...unpinned]);
      }
      try {
        await reorderPinnedPipelineProjects(selectedInstanceId, orderedPinnedIds);
      } catch (error) {
        console.error('Failed to reorder pinned projects:', error);
        if (previous) queryClient.setQueryData(key, previous);
      } finally {
        queryClient.invalidateQueries({ queryKey: key });
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
    handleReorderPinned,
    handleOpenDetail,
    handleSelectInstance,
  };
}
