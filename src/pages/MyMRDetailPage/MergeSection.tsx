/**
 * Merge section — merge status display, merge/rebase actions.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mergeMR, checkMergeStatus, rebaseMR, undraftMR } from '../../services/tauri';
import { useToast } from '../../components/Toast/ToastContext';
import { queryKeys } from '../../lib/queryKeys';
import { pendingMerges } from '../../lib/pendingMerges';
import { useAutoMerge } from '../../hooks/useAutoMerge';
import type { MergeRequest } from '../../types';
import type { MergeState, MergeAction } from './mergeReducer';

function autoMergeStatusLabel(status: string | null): string {
  switch (status) {
    case null:
      return 'Waiting for first status check...';
    case 'mergeable':
      return 'Mergeable — merging on next sync';
    case 'need_rebase':
      return 'Needs rebase — rebasing on next sync';
    case 'ci_must_pass':
      return 'Waiting for pipeline';
    case 'checking':
    case 'unchecked':
      return 'GitLab is checking mergeability';
    case 'discussions_not_resolved':
      return 'Waiting for discussions to resolve';
    case 'draft_status':
      return 'Waiting — MR is draft';
    case 'not_approved':
      return 'Waiting for approval';
    case 'requested_changes':
      return 'Waiting — changes requested';
    case 'conflict':
      return 'Has conflicts — cannot auto-merge';
    default:
      return `Waiting — ${status.replace(/_/g, ' ')}`;
  }
}

export interface MergeActions {
  merge: (() => void) | null;
  rebase: (() => void) | null;
  undraft: (() => void) | null;
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
  const isDraft = mrTitle.startsWith('Draft:') || mrTitle.startsWith('WIP:');

  const { claim: autoMergeClaim, isClaimed: autoMergeOn, toggle: toggleAutoMerge } = useAutoMerge(mrId);

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
    if (isDraft) return;
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
      async () => {
        if (instanceId) {
          try {
            await queryClient.refetchQueries({ queryKey: queryKeys.myMRList(String(instanceId)) });
          } catch {
            // ignore — we still want to clear the pending flag below
          }
        }
        pendingMerges.remove(mrId);
      },
      async (err) => {
        const message = err instanceof Error ? err.message : 'Merge failed';
        if (instanceId) {
          try {
            await queryClient.refetchQueries({ queryKey: queryKeys.myMRList(String(instanceId)) });
          } catch {
            // ignore
          }
        }
        pendingMerges.remove(mrId);
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

  const handleUndraft = useCallback(async () => {
    try {
      const newTitle = await undraftMR(mrId);
      setMr((prev) => (prev ? { ...prev, title: newTitle } : prev));
      // Re-check mergeability now that the draft block is gone.
      fetchMergeStatus();
      queryClient.invalidateQueries({ queryKey: queryKeys.mr(mrId) });
      if (instanceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.myMRList(String(instanceId)) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark ready';
      addToast({
        type: 'info',
        title: `Failed to mark !${mrIid} ready`,
        body: `${mrTitle} — ${message}`,
      });
    }
  }, [mrId, setMr, fetchMergeStatus, queryClient, instanceId, mrIid, mrTitle, addToast]);

  // Treat an unresolved merge status (still loading or not yet fetched) as
  // optimistically mergeable when the MR is approved, so the user does not
  // wait on GitLab before clicking Merge. A failed merge surfaces via toast.
  const optimisticallyMergeable =
    mergeStatus === 'mergeable' || (mergeStatus === null && mr.approvalStatus === 'approved');

  // Expose available actions to parent for keyboard shortcuts.
  // Rebase is only offered when GitLab's `detailed_merge_status` is
  // `need_rebase` — matches the GitLab web UI, which hides the button when
  // the source branch is already up to date with target.
  const canMerge = !isDraft && mr.state === 'opened' && optimisticallyMergeable && mr.approvalStatus === 'approved' && !merging;
  const canRebase = !isDraft && mr.state === 'opened' && mergeStatus === 'need_rebase' && !rebasing;
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        merge: canMerge ? handleMerge : null,
        rebase: canRebase ? handleRebase : null,
        undraft: isDraft && mr.state === 'opened' ? handleUndraft : null,
      };
    }
  }, [actionsRef, canMerge, canRebase, handleMerge, handleRebase, isDraft, mr.state, handleUndraft]);

  if (mr.state === 'merged') {
    return (
      <section className="my-mr-merge-section">
        <h3>Merge</h3>
        <span className="my-mr-state-badge merged">Merged</span>
      </section>
    );
  }

  if (mr.state !== 'opened') return null;

  const autoMergeLabel = autoMergeClaim
    ? autoMergeStatusLabel(autoMergeClaim.lastStatus)
    : null;

  return (
    <section className="my-mr-merge-section">
      <h3>Merge</h3>
      {autoMergeOn ? (
        <div className="my-mr-auto-merge-active">
          <div className="my-mr-auto-merge-status">
            <span className="my-mr-auto-merge-dot" />
            <div className="my-mr-auto-merge-text">
              <strong>Auto-merge enabled</strong>
              <span className="my-mr-auto-merge-detail">{autoMergeLabel}</span>
              {autoMergeClaim?.lastError && (
                <span className="my-mr-auto-merge-error">{autoMergeClaim.lastError}</span>
              )}
            </div>
          </div>
          <button className="my-mr-merge-cancel" onClick={toggleAutoMerge}>
            Cancel auto-merge
          </button>
        </div>
      ) : isDraft || mergeStatus === 'draft_status' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status draft">Draft</span>
          <button className="my-mr-action-btn rebase" onClick={handleUndraft}>
            Mark ready <span className="shortcut-tag"><span className="shortcut-mod">⌘</span>+↵</span>
          </button>
        </div>
      ) : optimisticallyMergeable && mr.approvalStatus === 'approved' ? (
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
      ) : mergeStatus === 'not_approved' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status not-approved">Not yet approved</span>
        </div>
      ) : mergeStatus === 'checking' ? (
        <p className="my-mr-merge-status-text">GitLab is checking mergeability...</p>
      ) : mergeStatus === 'mergeable' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status mergeable">Mergeable</span>
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
      {!autoMergeOn && (
        <label className="my-mr-auto-merge-toggle">
          <input type="checkbox" checked={false} onChange={toggleAutoMerge} />
          <span>Auto-merge when ready</span>
          <span className="my-mr-auto-merge-hint">
            Background sync rebases if needed and merges once GitLab reports the MR as mergeable.
          </span>
        </label>
      )}
    </section>
  );
}
