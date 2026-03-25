/**
 * Approval button component for MR approval/unapproval.
 *
 * Provides optimistic updates - the UI updates immediately
 * while the action is queued for sync to GitLab.
 */

import { useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useApproveMRMutation } from '../../hooks/queries/useApproveMRMutation';
import './ApprovalButton.css';

/** Methods exposed via ref */
export interface ApprovalButtonRef {
  toggle: () => void;
}

interface ApprovalButtonProps {
  /** Merge request ID */
  mrId: number;
  /** Current approval status */
  approvalStatus: 'approved' | 'pending' | 'changes_requested' | null;
  /** Current number of approvals */
  approvalsCount: number;
  /** Number of approvals required */
  approvalsRequired: number;
  /** Whether the current user has approved */
  hasApproved?: boolean;
  /** Called when approval state changes */
  onApprovalChange?: (approved: boolean, newCount: number, trigger: 'button' | 'keyboard') => void;
}

/**
 * Approval button component.
 */
const ApprovalButton = forwardRef<ApprovalButtonRef, ApprovalButtonProps>(function ApprovalButton({
  mrId,
  approvalStatus,
  approvalsCount,
  approvalsRequired,
  hasApproved = false,
  onApprovalChange,
}, ref) {
  const [isApproved, setIsApproved] = useState(hasApproved);
  const [count, setCount] = useState(approvalsCount);
  const [error, setError] = useState<string | null>(null);

  // Sync local state when props change (e.g., from TQ background refetch)
  useEffect(() => { setIsApproved(hasApproved); }, [hasApproved]);
  useEffect(() => { setCount(approvalsCount); }, [approvalsCount]);

  const { approve, unapprove } = useApproveMRMutation(mrId);
  const isSubmitting = approve.isPending || unapprove.isPending;

  // Handle approve/unapprove
  const handleClick = useCallback((trigger: 'button' | 'keyboard' = 'button') => {
    if (isSubmitting) return;
    setError(null);

    // Optimistic update
    const newApproved = !isApproved;
    const newCount = newApproved ? count + 1 : Math.max(0, count - 1);
    setIsApproved(newApproved);
    setCount(newCount);
    onApprovalChange?.(newApproved, newCount, trigger);

    const mutation = newApproved ? approve : unapprove;
    mutation.mutate(undefined, {
      onError: (err) => {
        // Rollback on error
        setIsApproved(isApproved);
        setCount(count);
        onApprovalChange?.(isApproved, count, trigger);
        setError(err instanceof Error ? err.message : 'Failed to update approval');
      },
    });
  }, [isApproved, count, isSubmitting, approve, unapprove, onApprovalChange]);

  // Expose toggle method via ref
  useImperativeHandle(ref, () => ({
    toggle: () => handleClick('keyboard'),
  }), [handleClick]);

  const isFullyApproved = count >= approvalsRequired;
  const label = isApproved ? 'Approved' : 'Approve';

  return (
    <div className="approval-container">
      <button
        type="button"
        className={`approval-btn ${isApproved ? 'approved' : ''} ${isFullyApproved ? 'fully-approved' : ''}`}
        onClick={() => handleClick('button')}
        disabled={isSubmitting}
        title={isApproved ? 'Remove your approval (A)' : 'Approve this MR (A)'}
      >
        {isSubmitting ? (
          <span className="approval-text">Updating...</span>
        ) : (
          <>
            {isApproved && <span className="approval-check">✓</span>}
            <span className="approval-text">{label}</span>
            <span className="approval-count">{count}/{approvalsRequired}</span>
            <kbd className="approval-kbd">A</kbd>
          </>
        )}
      </button>
      {approvalStatus === 'changes_requested' && (
        <span className="approval-changes">Changes requested</span>
      )}
      {error && <div className="approval-error">{error}</div>}
    </div>
  );
});

export default ApprovalButton;
