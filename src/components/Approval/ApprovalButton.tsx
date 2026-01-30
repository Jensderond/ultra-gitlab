/**
 * Approval button component for MR approval/unapproval.
 *
 * Provides optimistic updates - the UI updates immediately
 * while the action is queued for sync to GitLab.
 */

import { useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { invoke } from '../../services/tauri';
import './ApprovalButton.css';

/** Methods exposed via ref */
export interface ApprovalButtonRef {
  toggle: () => void;
}

interface ApprovalButtonProps {
  /** Merge request ID */
  mrId: number;
  /** Project ID for API calls */
  projectId: number;
  /** MR IID for API calls */
  mrIid: number;
  /** Current approval status */
  approvalStatus: 'approved' | 'pending' | 'changes_requested' | null;
  /** Current number of approvals */
  approvalsCount: number;
  /** Number of approvals required */
  approvalsRequired: number;
  /** Whether the current user has approved */
  hasApproved?: boolean;
  /** Called when approval state changes */
  onApprovalChange?: (approved: boolean, newCount: number) => void;
}

/**
 * Approval button component.
 */
const ApprovalButton = forwardRef<ApprovalButtonRef, ApprovalButtonProps>(function ApprovalButton({
  mrId,
  projectId,
  mrIid,
  approvalStatus,
  approvalsCount,
  approvalsRequired,
  hasApproved = false,
  onApprovalChange,
}, ref) {
  const [isApproved, setIsApproved] = useState(hasApproved);
  const [count, setCount] = useState(approvalsCount);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle approve/unapprove
  const handleClick = useCallback(async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    // Optimistic update
    const newApproved = !isApproved;
    const newCount = newApproved ? count + 1 : Math.max(0, count - 1);
    setIsApproved(newApproved);
    setCount(newCount);
    onApprovalChange?.(newApproved, newCount);

    try {
      if (newApproved) {
        await invoke('approve_mr', {
          input: { mrId, projectId, mrIid },
        });
      } else {
        await invoke('unapprove_mr', {
          input: { mrId, projectId, mrIid },
        });
      }
    } catch (err) {
      // Rollback on error
      setIsApproved(isApproved);
      setCount(count);
      onApprovalChange?.(isApproved, count);
      setError(err instanceof Error ? err.message : 'Failed to update approval');
    } finally {
      setIsSubmitting(false);
    }
  }, [isApproved, count, isSubmitting, mrId, projectId, mrIid, onApprovalChange]);

  // Expose toggle method via ref
  useImperativeHandle(ref, () => ({
    toggle: handleClick,
  }), [handleClick]);

  // Determine button state
  const isFullyApproved = count >= approvalsRequired;
  const buttonClass = isApproved
    ? 'approval-button approved'
    : 'approval-button';

  return (
    <div className="approval-container">
      <button
        type="button"
        className={buttonClass}
        onClick={handleClick}
        disabled={isSubmitting}
        title={isApproved ? 'Remove your approval' : 'Approve this MR'}
      >
        {isSubmitting ? (
          'Updating...'
        ) : isApproved ? (
          <>
            <span className="approval-icon">✓</span>
            Approved
          </>
        ) : (
          <>
            <span className="approval-icon">○</span>
            Approve
          </>
        )}
      </button>

      <div className="approval-status">
        <span className={`approval-count ${isFullyApproved ? 'complete' : ''}`}>
          {count}/{approvalsRequired}
        </span>
        {approvalStatus === 'changes_requested' && (
          <span className="approval-changes">Changes requested</span>
        )}
      </div>

      {error && <div className="approval-error">{error}</div>}
    </div>
  );
});

export default ApprovalButton;
