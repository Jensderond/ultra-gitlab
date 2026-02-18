/**
 * Reducer for merge-related state in MyMRDetailPage.
 */

export interface MergeState {
  merging: boolean;
  mergeError: string | null;
  mergeConfirm: boolean;
  mergeStatus: string | null;
  mergeStatusLoading: boolean;
  rebasing: boolean;
}

export type MergeAction =
  | { type: 'START_MERGE_STATUS_CHECK' }
  | { type: 'MERGE_STATUS_RESULT'; status: string | null }
  | { type: 'REQUEST_MERGE' }
  | { type: 'CONFIRM_MERGE' }
  | { type: 'MERGE_SUCCESS' }
  | { type: 'MERGE_ERROR'; error: string }
  | { type: 'CANCEL_CONFIRM' }
  | { type: 'START_REBASE' }
  | { type: 'REBASE_DONE' }
  | { type: 'REBASE_ERROR'; error: string };

export const initialMergeState: MergeState = {
  merging: false,
  mergeError: null,
  mergeConfirm: false,
  mergeStatus: null,
  mergeStatusLoading: false,
  rebasing: false,
};

export function mergeReducer(state: MergeState, action: MergeAction): MergeState {
  switch (action.type) {
    case 'START_MERGE_STATUS_CHECK':
      return { ...state, mergeStatusLoading: true };
    case 'MERGE_STATUS_RESULT':
      return { ...state, mergeStatusLoading: false, mergeStatus: action.status };
    case 'REQUEST_MERGE':
      return { ...state, mergeConfirm: true, mergeError: null };
    case 'CONFIRM_MERGE':
      return { ...state, merging: true, mergeError: null, mergeConfirm: false };
    case 'MERGE_SUCCESS':
      return { ...state, merging: false };
    case 'MERGE_ERROR':
      return { ...state, merging: false, mergeError: action.error };
    case 'CANCEL_CONFIRM':
      return { ...state, mergeConfirm: false };
    case 'START_REBASE':
      return { ...state, rebasing: true, mergeError: null };
    case 'REBASE_DONE':
      return { ...state, rebasing: false };
    case 'REBASE_ERROR':
      return { ...state, rebasing: false, mergeError: action.error };
    default:
      return state;
  }
}
