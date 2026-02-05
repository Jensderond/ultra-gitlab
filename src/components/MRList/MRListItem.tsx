/**
 * Single merge request item component.
 *
 * Displays a compact view of an MR with key information.
 */

import { forwardRef } from 'react';
import type { MergeRequest, ApprovalStatus, MRState } from '../../types';
import './MRListItem.css';

interface MRListItemProps {
  /** The merge request data */
  mr: MergeRequest;
  /** Whether this item is currently selected */
  selected?: boolean;
  /** Whether this item is newly added */
  isNew?: boolean;
  /** Click handler */
  onClick?: () => void;
}

/**
 * Format a Unix timestamp as a relative time string.
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Get status indicator class for approval status.
 */
function getApprovalClass(status: ApprovalStatus | null): string {
  switch (status) {
    case 'approved':
      return 'approval-approved';
    case 'changes_requested':
      return 'approval-changes';
    case 'pending':
    default:
      return 'approval-pending';
  }
}

/**
 * Get status indicator class for MR state.
 */
function getStateClass(state: MRState): string {
  switch (state) {
    case 'merged':
      return 'state-merged';
    case 'closed':
      return 'state-closed';
    case 'opened':
    default:
      return 'state-open';
  }
}

/**
 * Single merge request list item.
 */
const MRListItem = forwardRef<HTMLDivElement, MRListItemProps>(
  function MRListItem({ mr, selected, isNew, onClick }, ref) {
    const classNames = ['mr-list-item'];
    if (selected) classNames.push('selected');
    if (isNew) classNames.push('is-new');

    return (
      <div
        ref={ref}
        className={classNames.join(' ')}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClick?.();
          }
        }}
      >
      <div className="mr-item-header">
        <span className={`mr-state ${getStateClass(mr.state)}`}>
          {mr.state === 'opened' ? 'Open' : mr.state}
        </span>
        <span className="mr-iid">!{mr.iid}</span>
        {mr.projectName && (
          <span className="mr-project">{mr.projectName}</span>
        )}
        <span className="mr-time">{formatRelativeTime(mr.updatedAt)}</span>
      </div>

      <h4 className="mr-title">{mr.title}</h4>

      <div className="mr-item-meta">
        <span className="mr-author">{mr.authorUsername}</span>
        <span className="mr-branches">
          {mr.sourceBranch} → {mr.targetBranch}
        </span>
      </div>

      <div className="mr-item-footer">
        {mr.approvalStatus && (
          <span className={`mr-approval ${getApprovalClass(mr.approvalStatus)}`}>
            {mr.approvalStatus === 'approved' && '✓ Approved'}
            {mr.approvalStatus === 'pending' && '○ Pending'}
            {mr.approvalStatus === 'changes_requested' && '✕ Changes'}
          </span>
        )}
        {mr.labels.length > 0 && (
          <span className="mr-labels">
            {mr.labels.slice(0, 3).map((label) => (
              <span key={label} className="mr-label">
                {label}
              </span>
            ))}
            {mr.labels.length > 3 && (
              <span className="mr-label-more">+{mr.labels.length - 3}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
  }
);

export default MRListItem;
