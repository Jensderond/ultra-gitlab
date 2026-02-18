import type { GitLabInstanceWithStatus } from '../../services/gitlab';
import type { PipelineProject, PipelineStatus } from '../../types';

export interface PipelinesState {
  instances: GitLabInstanceWithStatus[];
  selectedInstanceId: number | null;
  projects: PipelineProject[];
  statuses: Map<number, PipelineStatus>;
  loading: boolean;
  statusesLoading: boolean;
  lastFetched: Date | null;
}

export type PipelinesAction =
  | { type: 'SET_INSTANCES'; instances: GitLabInstanceWithStatus[]; autoSelectId: number | null }
  | { type: 'SELECT_INSTANCE'; id: number }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_PROJECTS'; projects: PipelineProject[] }
  | { type: 'SET_STATUSES'; statuses: Map<number, PipelineStatus> }
  | { type: 'SET_STATUSES_LOADING'; loading: boolean }
  | { type: 'PROJECTS_LOADED'; projects: PipelineProject[]; statuses: Map<number, PipelineStatus> }
  | { type: 'REMOVE_PROJECT'; projectId: number };

export function pipelinesReducer(state: PipelinesState, action: PipelinesAction): PipelinesState {
  switch (action.type) {
    case 'SET_INSTANCES':
      return {
        ...state,
        instances: action.instances,
        selectedInstanceId: state.selectedInstanceId ?? action.autoSelectId,
      };
    case 'SELECT_INSTANCE':
      return { ...state, selectedInstanceId: action.id };
    case 'SET_LOADING':
      return { ...state, loading: action.loading };
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects };
    case 'SET_STATUSES':
      return { ...state, statuses: action.statuses, lastFetched: new Date() };
    case 'SET_STATUSES_LOADING':
      return { ...state, statusesLoading: action.loading };
    case 'PROJECTS_LOADED':
      return {
        ...state,
        projects: action.projects,
        statuses: action.statuses,
        loading: false,
        statusesLoading: false,
        lastFetched: new Date(),
      };
    case 'REMOVE_PROJECT':
      return {
        ...state,
        projects: state.projects.filter((p) => p.projectId !== action.projectId),
      };
    default:
      return state;
  }
}

export const initialPipelinesState: PipelinesState = {
  instances: [],
  selectedInstanceId: null,
  projects: [],
  statuses: new Map(),
  loading: true,
  statusesLoading: false,
  lastFetched: null,
};
