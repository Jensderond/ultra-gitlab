/**
 * Utility functions for MyMRDetailPage sub-components.
 */

export { formatRelativeTime } from '../../utils/formatRelativeTime';

export function reviewerStatusClass(status: string): string {
  switch (status) {
    case 'approved': return 'reviewer-approved';
    case 'changes_requested': return 'reviewer-changes';
    default: return 'reviewer-pending';
  }
}

export function reviewerStatusLabel(status: string): string {
  switch (status) {
    case 'approved': return 'Approved';
    case 'changes_requested': return 'Changes Requested';
    default: return 'Pending';
  }
}
