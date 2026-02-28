import { useReducer, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listInstances } from '../../services/gitlab';
import {
  listPipelineProjects,
  getPipelineStatuses,
  visitPipelineProject,
  togglePinPipelineProject,
  removePipelineProject,
} from '../../services/tauri';
import type { PipelineProject, PipelineStatus, ProjectSearchResult } from '../../types';
import { pipelinesReducer, initialPipelinesState } from './pipelinesReducer';

export default function usePipelinesData() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(pipelinesReducer, initialPipelinesState);

  const statusesRef = useRef(state.statuses);
  statusesRef.current = state.statuses;
  const projectsRef = useRef(state.projects);
  projectsRef.current = state.projects;
  const firstLoadDoneRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedInstanceIdRef = useRef(state.selectedInstanceId);
  selectedInstanceIdRef.current = state.selectedInstanceId;

  /** Emit window events for pinned project status changes (skips first load). */
  const emitPipelineChanges = useCallback(
    (newStatusMap: Map<number, PipelineStatus>) => {
      if (!firstLoadDoneRef.current) {
        firstLoadDoneRef.current = true;
        return;
      }

      const oldStatuses = statusesRef.current;
      const currentProjects = projectsRef.current;
      const pinnedIds = new Set(
        currentProjects.filter((p) => p.pinned).map((p) => p.projectId)
      );

      for (const [projectId, newStatus] of newStatusMap) {
        if (!pinnedIds.has(projectId)) continue;
        const oldStatus = oldStatuses.get(projectId);
        if (!oldStatus || oldStatus.status === newStatus.status) continue;

        const project = currentProjects.find((p) => p.projectId === projectId);
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
    },
    []
  );

  // Load instances
  useEffect(() => {
    listInstances()
      .then((data) =>
        dispatch({
          type: 'SET_INSTANCES',
          instances: data,
          autoSelectId: data.length > 0 ? data[0].id : null,
        })
      )
      .catch((error) => console.error('Failed to load instances:', error));
  }, []);

  // Load projects and their pipeline statuses
  const loadProjects = useCallback(async () => {
    if (!state.selectedInstanceId) return;
    const requestedInstanceId = state.selectedInstanceId;
    try {
      dispatch({ type: 'SET_LOADING', loading: true });
      const projectList = await listPipelineProjects(requestedInstanceId);
      if (selectedInstanceIdRef.current !== requestedInstanceId) return;
      const projectIds = projectList.map((p) => p.projectId);

      if (projectIds.length > 0) {
        dispatch({ type: 'SET_STATUSES_LOADING', loading: true });
        const statusList = await getPipelineStatuses(requestedInstanceId, projectIds);
        if (selectedInstanceIdRef.current !== requestedInstanceId) return;
        const statusMap = new Map(statusList.map((s) => [s.projectId, s]));
        emitPipelineChanges(statusMap);
        dispatch({ type: 'PROJECTS_LOADED', projects: projectList, statuses: statusMap });
      } else {
        dispatch({ type: 'PROJECTS_LOADED', projects: projectList, statuses: new Map() });
      }
    } catch (error) {
      console.error('Failed to load pipeline projects:', error);
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.selectedInstanceId, emitPipelineChanges]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Refresh only pipeline statuses (used by polling)
  const refreshStatuses = useCallback(async () => {
    if (!state.selectedInstanceId || state.projects.length === 0) return;
    const requestedInstanceId = state.selectedInstanceId;
    try {
      const projectIds = state.projects.map((p) => p.projectId);
      const statusList = await getPipelineStatuses(requestedInstanceId, projectIds);
      if (selectedInstanceIdRef.current !== requestedInstanceId) return;
      const statusMap = new Map(statusList.map((s) => [s.projectId, s]));
      emitPipelineChanges(statusMap);
      dispatch({ type: 'SET_STATUSES', statuses: statusMap });
    } catch (error) {
      console.error('Failed to refresh pipeline statuses:', error);
    }
  }, [state.selectedInstanceId, state.projects, emitPipelineChanges]);

  // Auto-refresh polling with adaptive interval
  useEffect(() => {
    if (!state.selectedInstanceId || state.projects.length === 0) return;

    function getInterval() {
      const hasActive = Array.from(statusesRef.current.values()).some(
        (s) => s.status === 'running' || s.status === 'pending'
      );
      return hasActive ? 30_000 : 120_000;
    }

    function scheduleNextPoll() {
      pollTimerRef.current = setTimeout(async () => {
        if (document.visibilityState === 'visible') await refreshStatuses();
        scheduleNextPoll();
      }, getInterval());
    }

    function handleVisibilityChange() {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (document.visibilityState === 'visible') {
        refreshStatuses().then(scheduleNextPoll);
      }
    }

    scheduleNextPoll();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [state.selectedInstanceId, state.projects, refreshStatuses]);

  const handleSelectResult = useCallback(async (result: ProjectSearchResult) => {
    if (!state.selectedInstanceId) return;
    try {
      await visitPipelineProject(state.selectedInstanceId, result.id);
      loadProjects();
    } catch (error) { console.error('Failed to add project:', error); }
  }, [state.selectedInstanceId, loadProjects]);

  const handleTogglePin = useCallback(async (projectId: number) => {
    if (!state.selectedInstanceId) return;
    try {
      await togglePinPipelineProject(state.selectedInstanceId, projectId);
      const projectList = await listPipelineProjects(state.selectedInstanceId);
      dispatch({ type: 'SET_PROJECTS', projects: projectList });
    } catch (error) { console.error('Failed to toggle pin:', error); }
  }, [state.selectedInstanceId]);

  const handleRemoveProject = useCallback(async (projectId: number) => {
    if (!state.selectedInstanceId) return;
    try {
      await removePipelineProject(state.selectedInstanceId, projectId);
      dispatch({ type: 'REMOVE_PROJECT', projectId });
    } catch (error) { console.error('Failed to remove project:', error); }
  }, [state.selectedInstanceId]);

  const handleOpenDetail = useCallback((project: PipelineProject, status: PipelineStatus) => {
    const params = new URLSearchParams({
      instance: String(project.instanceId),
      project: project.nameWithNamespace,
      ref: status.refName,
      url: status.webUrl,
    });
    navigate(`/pipelines/${project.projectId}/${status.id}?${params.toString()}`);
  }, [navigate]);

  const handleSelectInstance = useCallback((id: number) => {
    dispatch({ type: 'SELECT_INSTANCE', id });
  }, []);

  return {
    ...state,
    handleSelectResult,
    handleTogglePin,
    handleRemoveProject,
    handleOpenDetail,
    handleSelectInstance,
  };
}
