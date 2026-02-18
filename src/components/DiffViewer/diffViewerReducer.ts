import type { DiffFileContent, DiffHunk, DiffFileMetadata } from '../../types';

export interface DiffViewerState {
  diffContent: DiffFileContent | null;
  metadata: DiffFileMetadata | null;
  loading: boolean;
  error: string | null;
  selectedHunk: number | null;
  selectedLine: number | null;
  isLargeDiff: boolean;
  hunks: (DiffHunk | null)[];
  loadingHunks: Set<number>;
  loadedRanges: Set<number>;
}

export type DiffViewerAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_METADATA'; metadata: DiffFileMetadata }
  | { type: 'LOAD_LARGE_INIT'; hunkCount: number }
  | { type: 'LOAD_CONTENT'; content: DiffFileContent }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'LOAD_DONE' }
  | { type: 'SELECT_LINE'; hunk: number; line: number }
  | { type: 'HUNKS_LOADING'; indices: number[] }
  | { type: 'HUNKS_LOADED'; startIndex: number; loadedHunks: DiffHunk[] }
  | { type: 'HUNKS_LOAD_DONE'; indices: number[] };

export const initialState: DiffViewerState = {
  diffContent: null,
  metadata: null,
  loading: true,
  error: null,
  selectedHunk: null,
  selectedLine: null,
  isLargeDiff: false,
  hunks: [],
  loadingHunks: new Set(),
  loadedRanges: new Set(),
};

export function diffViewerReducer(state: DiffViewerState, action: DiffViewerAction): DiffViewerState {
  switch (action.type) {
    case 'LOAD_START':
      return {
        ...state,
        loading: true,
        error: null,
        isLargeDiff: false,
        hunks: [],
        loadedRanges: new Set(),
      };

    case 'LOAD_METADATA':
      return { ...state, metadata: action.metadata };

    case 'LOAD_LARGE_INIT':
      return {
        ...state,
        isLargeDiff: true,
        hunks: new Array(action.hunkCount).fill(null),
      };

    case 'LOAD_CONTENT':
      return { ...state, diffContent: action.content };

    case 'LOAD_ERROR':
      return { ...state, error: action.error };

    case 'LOAD_DONE':
      return { ...state, loading: false };

    case 'SELECT_LINE':
      return { ...state, selectedHunk: action.hunk, selectedLine: action.line };

    case 'HUNKS_LOADING': {
      const next = new Set(state.loadingHunks);
      action.indices.forEach(i => next.add(i));
      return { ...state, loadingHunks: next };
    }

    case 'HUNKS_LOADED': {
      const nextHunks = [...state.hunks];
      action.loadedHunks.forEach((hunk, i) => {
        nextHunks[action.startIndex + i] = hunk;
      });
      const nextLoaded = new Set(state.loadedRanges);
      for (let i = action.startIndex; i < action.startIndex + action.loadedHunks.length; i++) {
        nextLoaded.add(i);
      }
      return { ...state, hunks: nextHunks, loadedRanges: nextLoaded };
    }

    case 'HUNKS_LOAD_DONE': {
      const next = new Set(state.loadingHunks);
      action.indices.forEach(i => next.delete(i));
      return { ...state, loadingHunks: next };
    }

    default:
      return state;
  }
}
