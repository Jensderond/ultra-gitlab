import { useReducer } from 'react';

export interface ViewState {
  selectedFile: string | null;
  fileFocusIndex: number;
  viewMode: 'unified' | 'split';
  collapseState: 'collapsed' | 'expanded' | 'partial';
  mobileSidebarOpen: boolean;
  viewedPaths: Set<string>;
  hideGenerated: boolean;
  changedSinceApprovalPaths: Set<string>;
  filterToChangedOnly: boolean;
  bannerDismissed: boolean;
}

type ViewAction =
  | { type: 'SELECT_FILE'; path: string; index: number; hasSavedState: boolean }
  | { type: 'SET_VIEW_MODE'; mode: 'unified' | 'split' }
  | { type: 'SET_COLLAPSE'; state: 'collapsed' | 'expanded' | 'partial' }
  | { type: 'TOGGLE_MOBILE_SIDEBAR' }
  | { type: 'CLOSE_MOBILE_SIDEBAR' }
  | { type: 'MARK_VIEWED'; path: string }
  | { type: 'TOGGLE_HIDE_GENERATED' }
  | { type: 'SET_CHANGED_SET'; paths: string[] }
  | { type: 'TOGGLE_CHANGED_FILTER' }
  | { type: 'DISMISS_BANNER' }
  | { type: 'RESET_CHANGED_SET' };

export const initialViewState: ViewState = {
  selectedFile: null,
  fileFocusIndex: 0,
  viewMode: 'unified',
  collapseState: 'collapsed',
  mobileSidebarOpen: false,
  viewedPaths: new Set(),
  hideGenerated: true,
  changedSinceApprovalPaths: new Set(),
  filterToChangedOnly: false,
  bannerDismissed: false,
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
    case 'SET_CHANGED_SET':
      return { ...state, changedSinceApprovalPaths: new Set(action.paths) };
    case 'TOGGLE_CHANGED_FILTER':
      return { ...state, filterToChangedOnly: !state.filterToChangedOnly };
    case 'DISMISS_BANNER':
      return { ...state, bannerDismissed: true };
    case 'RESET_CHANGED_SET':
      return {
        ...state,
        changedSinceApprovalPaths: new Set(),
        filterToChangedOnly: false,
        bannerDismissed: false,
      };
  }
}

export const viewReducerForTest = viewReducer;

export function useViewReducer() {
  return useReducer(viewReducer, initialViewState);
}
