import type { PipelineJob, PipelineStatus } from '../../types';

export interface PipelineDetailState {
  jobs: PipelineJob[];
  loading: boolean;
  error: string | null;
  actionLoading: Set<number>;
  pipelineStatus: string | null;
  pipelines: PipelineStatus[];
  historyLoading: boolean;
  historyLoaded: boolean;
}

export type PipelineDetailAction =
  | { type: 'JOBS_LOADING' }
  | { type: 'JOBS_LOADED'; jobs: PipelineJob[] }
  | { type: 'JOBS_ERROR'; error: string }
  | { type: 'PIPELINE_STATUS'; status: string }
  | { type: 'ACTION_START'; jobId: number }
  | { type: 'ACTION_END'; jobId: number }
  | { type: 'UPDATE_JOB'; job: PipelineJob }
  | { type: 'HISTORY_LOADING' }
  | { type: 'HISTORY_LOADED'; pipelines: PipelineStatus[] }
  | { type: 'RESET' };

export const initialState: PipelineDetailState = {
  jobs: [],
  loading: true,
  error: null,
  actionLoading: new Set(),
  pipelineStatus: null,
  pipelines: [],
  historyLoading: false,
  historyLoaded: false,
};

export function pipelineDetailReducer(
  state: PipelineDetailState,
  action: PipelineDetailAction
): PipelineDetailState {
  switch (action.type) {
    case 'JOBS_LOADING':
      return { ...state, loading: true };
    case 'JOBS_LOADED':
      return { ...state, jobs: action.jobs, loading: false, error: null };
    case 'JOBS_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'PIPELINE_STATUS':
      return { ...state, pipelineStatus: action.status };
    case 'ACTION_START': {
      const next = new Set(state.actionLoading);
      next.add(action.jobId);
      return { ...state, actionLoading: next };
    }
    case 'ACTION_END': {
      const next = new Set(state.actionLoading);
      next.delete(action.jobId);
      return { ...state, actionLoading: next };
    }
    case 'UPDATE_JOB':
      return {
        ...state,
        jobs: state.jobs.map((j) => (j.id === action.job.id ? action.job : j)),
      };
    case 'HISTORY_LOADING':
      return { ...state, historyLoading: true };
    case 'HISTORY_LOADED':
      return {
        ...state,
        pipelines: action.pipelines,
        historyLoading: false,
        historyLoaded: true,
      };
    case 'RESET':
      return { ...initialState };
  }
}
