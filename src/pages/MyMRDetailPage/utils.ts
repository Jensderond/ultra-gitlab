/**
 * Utility functions for MyMRDetailPage sub-components.
 */

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

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
