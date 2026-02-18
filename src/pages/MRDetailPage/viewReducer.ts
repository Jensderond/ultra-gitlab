import { useReducer } from 'react';

export interface ViewState {
  selectedFile: string | null;
  fileFocusIndex: number;
  viewMode: 'unified' | 'split';
  collapseState: 'collapsed' | 'expanded' | 'partial';
  mobileSidebarOpen: boolean;
  viewedPaths: Set<string>;
  hideGenerated: boolean;
}

type ViewAction =
  | { type: 'SELECT_FILE'; path: string; index: number; hasSavedState: boolean }
  | { type: 'SET_VIEW_MODE'; mode: 'unified' | 'split' }
  | { type: 'SET_COLLAPSE'; state: 'collapsed' | 'expanded' | 'partial' }
  | { type: 'TOGGLE_MOBILE_SIDEBAR' }
  | { type: 'CLOSE_MOBILE_SIDEBAR' }
  | { type: 'MARK_VIEWED'; path: string }
  | { type: 'TOGGLE_HIDE_GENERATED' };

export const initialViewState: ViewState = {
  selectedFile: null,
  fileFocusIndex: 0,
  viewMode: 'unified',
  collapseState: 'collapsed',
  mobileSidebarOpen: false,
  viewedPaths: new Set(),
  hideGenerated: true,
};

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'SELECT_FILE':
      return {
        ...state,
        selectedFile: action.path,
        fileFocusIndex: action.index,
        collapseState: action.hasSavedState ? 'partial' : 'collapsed',
        mobileSidebarOpen: false,
      };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };
    case 'SET_COLLAPSE':
      return { ...state, collapseState: action.state };
    case 'TOGGLE_MOBILE_SIDEBAR':
      return { ...state, mobileSidebarOpen: !state.mobileSidebarOpen };
    case 'CLOSE_MOBILE_SIDEBAR':
      return { ...state, mobileSidebarOpen: false };
    case 'MARK_VIEWED':
      return { ...state, viewedPaths: new Set(state.viewedPaths).add(action.path) };
    case 'TOGGLE_HIDE_GENERATED':
      return { ...state, hideGenerated: !state.hideGenerated };
  }
}

export function useViewReducer() {
  return useReducer(viewReducer, initialViewState);
}
