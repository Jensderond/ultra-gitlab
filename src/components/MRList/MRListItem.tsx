/**
 * Single merge request item component.
 *
 * Displays a compact view of an MR with key information.
 */

import { forwardRef } from 'react';
import { Clock } from '@phosphor-icons/react';
import type { MergeRequest, ApprovalStatus } from '../../types';
import UserAvatar from '../UserAvatar/UserAvatar';
import HighlightText from '../HighlightText/HighlightText';
import SnoozeMenu from './SnoozeMenu';
import { isSnoozed, formatSnoozeUntil } from '../../lib/snooze';
import { splitProjectName } from '../../lib/projectName';
import './MRListItem.css';

/**
 * Root group hidden from the label outright rather than just dimmed — the one
 * local convention here. Every other group still shows, so an instance that
 * doesn't use this layout loses nothing.
 */
const HIDDEN_ROOT_GROUP = /^customers$/i;

interface MRListItemProps {
  /** The merge request data */
  mr: MergeRequest;
  /** Whether this item is currently selected */
  selected?: boolean;
  /** Whether this item is newly added */
  isNew?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Optional search query to highlight matching text */
  highlightQuery?: string;
  /** Render the compact single-line layout */
  condensed?: boolean;
  /** Whether the snooze preset menu is open for this row */
  snoozeMenuOpen?: boolean;
  /** Open/close the snooze preset menu */
  onSnoozeMenuOpenChange?: (open: boolean) => void;
  /** Snooze this MR until a Unix timestamp (seconds) */
  onSnooze?: (until: number) => void;
  /** Clear this MR's snooze */
  onUnsnooze?: () => void;
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

/** Icon-only glyph for the approval status used in condensed mode. Pending renders as a CSS ring. */
function approvalGlyph(mr: MergeRequest): string {
  if (mr.userHasApproved) return '✓';
  switch (mr.approvalStatus) {
    case 'approved': return '✓';
    case 'changes_requested': return '✕';
    case 'pending': return '';
    default: return '';
  }
}

function isPendingApproval(mr: MergeRequest): boolean {
  return !mr.userHasApproved && (mr.approvalStatus === 'pending' || mr.approvalStatus == null);
}

function approvalTitle(mr: MergeRequest): string {
  if (mr.userHasApproved) return 'You approved';
  switch (mr.approvalStatus) {
    case 'approved': return 'Approved';
    case 'changes_requested': return 'Changes requested';
    case 'pending': return 'Pending';
    default: return '';
  }
}

function condensedApprovalClass(mr: MergeRequest): string {
  if (mr.userHasApproved) return 'approval-user-approved';
  return getApprovalClass(mr.approvalStatus);
}

/** Clock icon for the snooze button. */
function SnoozeIcon() {
  return <Clock size={14} weight="bold" />;
}

/**
 * Single merge request list item.
 */
const MRListItem = forwardRef<HTMLDivElement, MRListItemProps>(
  function MRListItem(
    {
      mr,
      selected,
      isNew,
      onClick,
      highlightQuery,
      condensed,
      snoozeMenuOpen,
      onSnoozeMenuOpenChange,
      onSnooze,
      onUnsnooze,
    },
    ref
  ) {
    const snoozed = isSnoozed(mr);
    const classNames = ['mr-list-item'];
    if (condensed) classNames.push('mr-list-item--condensed');
    if (selected) classNames.push('selected');
    if (isNew) classNames.push('is-new');

    // The leading group is shared by nearly every project, so a filter never
    // matches it (see lib/projectName). It's still shown — dimmed, so the row
    // reads as "this part isn't what you searched" — unless it's the one root
    // group that's on literally every row.
    const { namespace, rest: projectLabel } = splitProjectName(mr.projectName);
    const projectNamespace = HIDDEN_ROOT_GROUP.test(namespace) ? '' : namespace;

    const projectText = (
      <>
        {projectNamespace && (
          <span className="mr-project-namespace">{projectNamespace} / </span>
        )}
        {highlightQuery ? (
          <HighlightText text={projectLabel} query={highlightQuery} />
        ) : (
          projectLabel
        )}
      </>
    );

    // MRs you already approved live in their own tab — snoozing them adds
    // nothing, so drop the control. An already-snoozed row keeps it so the
    // unsnooze affordance never disappears.
    const canSnooze = !mr.userHasApproved || snoozed;

    const snoozeControl = canSnooze && onSnoozeMenuOpenChange && onSnooze && (
      <span className="mr-snooze-control">
        {snoozed ? (
          <button
            className="mr-snooze-button mr-snooze-button--active"
            title={`Snoozed until ${formatSnoozeUntil(mr.snoozedUntil!)} — click to unsnooze`}
            aria-label="Unsnooze merge request"
            onClick={(e) => {
              e.stopPropagation();
              onUnsnooze?.();
            }}
          >
            <SnoozeIcon />
          </button>
        ) : (
          <button
            className="mr-snooze-button"
            title="Snooze"
            aria-label="Snooze merge request"
            aria-expanded={snoozeMenuOpen}
            onClick={(e) => {
              e.stopPropagation();
              onSnoozeMenuOpenChange(!snoozeMenuOpen);
            }}
          >
            <SnoozeIcon />
          </button>
        )}
        {snoozeMenuOpen && !snoozed && (
          <SnoozeMenu
            onSnooze={(until) => {
              onSnooze(until);
              onSnoozeMenuOpenChange(false);
            }}
            onClose={() => onSnoozeMenuOpenChange(false)}
          />
        )}
      </span>
    );

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
      {condensed ? (
        <div className="mr-condensed">
          <div className="mr-condensed-top">
            {projectLabel && (
              <span className="mr-condensed-project">{projectText}</span>
            )}
            <span className="mr-condensed-time">{formatRelativeTime(mr.updatedAt)}</span>
          </div>
          <div className="mr-condensed-main">
            <UserAvatar
              instanceId={mr.instanceId}
              username={mr.authorUsername}
              size={18}
              className="mr-condensed-avatar"
            />
            <span className="mr-iid">!{mr.iid}</span>
            <span className="mr-condensed-title">
              {highlightQuery ? <HighlightText text={mr.title} query={highlightQuery} /> : mr.title}
            </span>
            <span
              className={`mr-condensed-approval ${condensedApprovalClass(mr)}${isPendingApproval(mr) ? ' mr-condensed-approval--ring' : ''}`}
              title={approvalTitle(mr)}
              aria-label={approvalTitle(mr)}
            >
              {approvalGlyph(mr)}
            </span>
            <span className="mr-condensed-author">
              {highlightQuery ? <HighlightText text={mr.authorUsername} query={highlightQuery} /> : mr.authorUsername}
            </span>
            {snoozeControl}
          </div>
        </div>
      ) : (
        <>
          <div className="mr-item-header">
            <span className="mr-iid">!{mr.iid}</span>
            {mr.projectName && (
              <span className="mr-project">{projectText}</span>
            )}
            <span className="mr-time">{formatRelativeTime(mr.updatedAt)}</span>
            {snoozeControl}
          </div>

          <h4 className="mr-title">
            {highlightQuery ? <HighlightText text={mr.title} query={highlightQuery} /> : mr.title}
          </h4>

          <div className="mr-item-meta">
            <span className="mr-author">
              <UserAvatar instanceId={mr.instanceId} username={mr.authorUsername} size={20} className="mr-author-avatar" />
              {highlightQuery ? <HighlightText text={mr.authorUsername} query={highlightQuery} /> : mr.authorUsername}
            </span>
            <span className="mr-branches">
              {mr.sourceBranch} → {mr.targetBranch}
            </span>
          </div>

          <div className="mr-item-footer">
            {snoozed && (
              <span className="mr-snoozed-badge" title="Hidden from the list until then">
                Snoozed until {formatSnoozeUntil(mr.snoozedUntil!)}
              </span>
            )}
            {mr.userHasApproved && (
              <span className="mr-approval approval-user-approved">✓ You approved</span>
            )}
            {mr.approvalStatus && !mr.userHasApproved && (
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
        </>
      )}
    </div>
  );
  }
);

export default MRListItem;
