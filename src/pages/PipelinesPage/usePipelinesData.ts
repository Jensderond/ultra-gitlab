import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  visitPipelineProject,
  togglePinPipelineProject,
  removePipelineProject,
  getNotificationPermissionStatus,
  requestNotificationPermission,
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

  const [permissionPrompt, setPermissionPrompt] = useState(false);
  const pendingPinRef = useRef<{ instanceId: number; projectId: number } | null>(null);
  const permissionStatusRef = useRef<string | null>(null);
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);

  const executePin = useCallback(
    async (instanceId: number, projectId: number) => {
      try {
        await togglePinPipelineProject(instanceId, projectId);
        queryClient.invalidateQueries({
          queryKey: queryKeys.pipelineProjects(String(instanceId)),
        });
      } catch (error) {
        console.error('Failed to toggle pin:', error);
      }
    },
    []
  );

  const handleTogglePin = useCallback(
    async (projectId: number) => {
      if (!selectedInstanceId) return;

      const project = projectsRef.current.find((p) => p.projectId === projectId);
      if (project?.pinned) {
        return executePin(selectedInstanceId, projectId);
      }

      try {
        if (permissionStatusRef.current === null) {
          permissionStatusRef.current = await getNotificationPermissionStatus();
        }
        if (permissionStatusRef.current === 'not_determined') {
          pendingPinRef.current = { instanceId: selectedInstanceId, projectId };
          setPermissionPrompt(true);
          return;
        }
      } catch {
        // If permission check fails, just pin anyway
      }

      return executePin(selectedInstanceId, projectId);
    },
    [selectedInstanceId, executePin]
  );

  const handlePermissionPromptAllow = useCallback(async () => {
    const pending = pendingPinRef.current;
    setPermissionPrompt(false);
    pendingPinRef.current = null;
    try {
      await requestNotificationPermission();
      permissionStatusRef.current = 'granted';
    } catch {
      // permission request failed, still pin
    }
    if (pending) {
      await executePin(pending.instanceId, pending.projectId);
    }
  }, [executePin]);

  const handlePermissionPromptSkip = useCallback(async () => {
    const pending = pendingPinRef.current;
    setPermissionPrompt(false);
    pendingPinRef.current = null;
    if (pending) {
      await executePin(pending.instanceId, pending.projectId);
    }
  }, [executePin]);

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
    permissionPrompt,
    handlePermissionPromptAllow,
    handlePermissionPromptSkip,
  };
}
