/**
 * Merge section — merge status display, merge/rebase actions.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mergeMR, checkMergeStatus, rebaseMR } from '../../services/tauri';
import { useToast } from '../../components/Toast/ToastContext';
import { queryKeys } from '../../lib/queryKeys';
import { pendingMerges } from '../../lib/pendingMerges';
import type { MergeRequest } from '../../types';
import type { MergeState, MergeAction } from './mergeReducer';

export interface MergeActions {
  merge: (() => void) | null;
  rebase: (() => void) | null;
}

interface MergeSectionProps {
  mr: MergeRequest;
  mergeState: MergeState;
  mergeDispatch: React.Dispatch<MergeAction>;
  mrId: number;
  setMr: React.Dispatch<React.SetStateAction<MergeRequest | null>>;
  actionsRef?: React.MutableRefObject<MergeActions>;
  onMerged?: () => void;
}

export function MergeSection({ mr, mergeState, mergeDispatch, mrId, setMr, actionsRef, onMerged }: MergeSectionProps) {
  const { merging, mergeError, mergeConfirm, mergeStatus, mergeStatusLoading, rebasing } = mergeState;
  const rebaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const instanceId = mr.instanceId;
  const mrTitle = mr.title;
  const mrIid = mr.iid;

  useEffect(() => {
    return () => {
      if (rebaseTimerRef.current !== null) {
        clearTimeout(rebaseTimerRef.current);
      }
    };
  }, []);

  const fetchMergeStatus = useCallback(async () => {
    if (mr.state !== 'opened') return;
    mergeDispatch({ type: 'START_MERGE_STATUS_CHECK' });
    try {
      const status = await checkMergeStatus(mrId);
      mergeDispatch({ type: 'MERGE_STATUS_RESULT', status });
    } catch {
      mergeDispatch({ type: 'MERGE_STATUS_RESULT', status: null });
    }
  }, [mr.state, mrId, mergeDispatch]);

  // Fetch merge status on mount / when MR state changes
  useEffect(() => {
    fetchMergeStatus();
  }, [fetchMergeStatus]);

  const handleMerge = useCallback(() => {
    if (merging) return;
    if (!mergeConfirm) {
      mergeDispatch({ type: 'REQUEST_MERGE' });
      return;
    }
    mergeDispatch({ type: 'CONFIRM_MERGE' });
    setMr((prev) => prev ? { ...prev, state: 'merged' } : prev);
    pendingMerges.add(mrId);
    onMerged?.();

    mergeMR(mrId).then(
      () => {
        pendingMerges.remove(mrId);
      },
      (err) => {
        pendingMerges.remove(mrId);
        const message = err instanceof Error ? err.message : 'Merge failed';
        if (instanceId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.myMRList(String(instanceId)) });
        }
        addToast({
          type: 'info',
          title: `Failed to merge !${mrIid}`,
          body: `${mrTitle} — ${message}`,
        });
      },
    );
  }, [mrId, merging, mergeConfirm, mergeDispatch, setMr, onMerged, instanceId, mrIid, mrTitle, queryClient, addToast]);

  const handleRebase = useCallback(async () => {
    if (rebasing) return;
    mergeDispatch({ type: 'START_REBASE' });
    try {
      await rebaseMR(mrId);
      rebaseTimerRef.current = setTimeout(() => fetchMergeStatus(), 3000);
      mergeDispatch({ type: 'REBASE_DONE' });
    } catch (err) {
      mergeDispatch({ type: 'REBASE_ERROR', error: err instanceof Error ? err.message : 'Rebase failed' });
    }
  }, [mrId, rebasing, mergeDispatch, fetchMergeStatus]);

  // Treat an unresolved merge status (still loading or not yet fetched) as
  // optimistically mergeable when the MR is approved, so the user does not
  // wait on GitLab before clicking Merge. A failed merge surfaces via toast.
  const optimisticallyMergeable =
    mergeStatus === 'mergeable' || (mergeStatus === null && mr.approvalStatus === 'approved');

  // Expose available actions to parent for keyboard shortcuts
  const canMerge = mr.state === 'opened' && optimisticallyMergeable && mr.approvalStatus === 'approved' && !merging;
  const canRebase = mr.state === 'opened' && mergeStatus === 'need_rebase' && !rebasing;
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        merge: canMerge ? handleMerge : null,
        rebase: canRebase ? handleRebase : null,
      };
    }
  }, [actionsRef, canMerge, canRebase, handleMerge, handleRebase]);

  if (mr.state === 'merged') {
    return (
      <section className="my-mr-merge-section">
        <h3>Merge</h3>
        <span className="my-mr-state-badge merged">Merged</span>
      </section>
    );
  }

  if (mr.state !== 'opened') return null;

  return (
    <section className="my-mr-merge-section">
      <h3>Merge</h3>
      {optimisticallyMergeable && mr.approvalStatus === 'approved' ? (
        <div className="my-mr-merge-actions">
          <button
            className={`my-mr-action-btn merge ${mergeConfirm ? 'confirm' : ''}`}
            onClick={handleMerge}
            disabled={merging}
          >
            {merging ? 'Merging...' : mergeConfirm ? <>Confirm merge <span className="shortcut-tag"><span className="shortcut-mod">⌘</span>+↵</span></> : <>Merge <span className="shortcut-tag"><span className="shortcut-mod">⌘</span>+↵</span></>}
          </button>
          {mergeConfirm && (
            <button
              className="my-mr-merge-cancel"
              onClick={() => mergeDispatch({ type: 'CANCEL_CONFIRM' })}
            >
              Cancel
            </button>
          )}
        </div>
      ) : mergeStatus === 'need_rebase' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status need-rebase">Needs rebase</span>
          <button
            className="my-mr-action-btn rebase"
            onClick={handleRebase}
            disabled={rebasing}
          >
            {rebasing ? 'Rebasing...' : <>Rebase <span className="shortcut-tag"><span className="shortcut-mod">⌘</span>+↵</span></>}
          </button>
        </div>
      ) : mergeStatus === 'conflict' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status conflict">Has conflicts</span>
        </div>
      ) : mergeStatus === 'ci_must_pass' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status ci-pending">Pipeline must pass</span>
        </div>
      ) : mergeStatus === 'discussions_not_resolved' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status discussions">Unresolved discussions</span>
        </div>
      ) : mergeStatus === 'draft_status' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status draft">Draft</span>
        </div>
      ) : mergeStatus === 'not_approved' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status not-approved">Not yet approved</span>
        </div>
      ) : mergeStatus === 'checking' ? (
        <p className="my-mr-merge-status-text">GitLab is checking mergeability...</p>
      ) : mergeStatus === 'mergeable' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status not-approved">Not yet approved</span>
        </div>
      ) : mergeStatus ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status">{mergeStatus.replace(/_/g, ' ')}</span>
        </div>
      ) : mergeStatusLoading ? (
        <p className="my-mr-merge-status-text">Checking merge status...</p>
      ) : null}
      {mergeError && (
        <p className="my-mr-merge-error">{mergeError}</p>
      )}
    </section>
  );
}
