import type { RefObject } from 'react';
import { ApprovalButton, type ApprovalButtonRef } from '../../components/Approval';
import SnoozeButton, { type SnoozeButtonRef } from '../../components/Snooze/SnoozeButton';
import BackButton from '../../components/BackButton';
import UserAvatar from '../../components/UserAvatar/UserAvatar';
import { FileIcon, ChatCircleIcon } from '../../components/icons';
import { isSnoozed } from '../../lib/snooze';
import type { MergeRequest } from '../../types';

interface MRHeaderProps {
  mr: MergeRequest;
  mrId: number;
  updateAvailable?: boolean;
  isSmallScreen: boolean;
  fileCount: number;
  approvalButtonRef: RefObject<ApprovalButtonRef | null>;
  snoozeButtonRef: RefObject<SnoozeButtonRef | null>;
  onToggleMobileSidebar: () => void;
  onApproved: (trigger: 'button' | 'keyboard') => void;
  onUnapproved?: (trigger: 'button' | 'keyboard') => void;
  /** Hide approval button for merged/closed MRs */
  hideApproval?: boolean;
  unresolvedCount: number;
  onToggleActivity: () => void;
}

export default function MRHeader({
  mr,
  mrId,
  updateAvailable,
  isSmallScreen,
  fileCount,
  approvalButtonRef,
  snoozeButtonRef,
  onToggleMobileSidebar,
  onApproved,
  onUnapproved,
  hideApproval,
  unresolvedCount,
  onToggleActivity,
}: MRHeaderProps) {
  return (
    <header className="mr-detail-header">
      <div className="mr-header-top">
        <BackButton to="/mrs" title="Back to MRs" />
        <span className="mr-iid">!{mr.iid}</span>
        {mr.projectName && (
          <span className="mr-project">{mr.projectName.replace(/^Customers\s*\/\s*/, '')}</span>
        )}
        <div className="mr-detail-actions">
          {isSmallScreen && fileCount > 0 && (
            <button
              className="mobile-files-toggle"
              onClick={onToggleMobileSidebar}
              title="Toggle file list"
            >
              <FileIcon size={18} />
              <span className="mobile-files-badge">{fileCount}</span>
            </button>
          )}
          {updateAvailable && (
            <span className="mr-update-tag">Update available</span>
          )}
          <button
            className="activity-header-toggle"
            onClick={onToggleActivity}
            title="Toggle activity (⌘D)"
            aria-label="Toggle activity"
            data-testid="activity-toggle"
          >
            <ChatCircleIcon size={18} />
            {unresolvedCount > 0 && (
              <span className="activity-header-badge" data-testid="activity-badge">{unresolvedCount}</span>
            )}
          </button>
          {/* Approve stays the rightmost, primary action. Snoozing an MR you've
              already approved adds nothing (it lives in its own tab), but a
              snoozed one always keeps the way back out. */}
          {!hideApproval && (!mr.userHasApproved || isSnoozed(mr)) && (
            <SnoozeButton ref={snoozeButtonRef} mr={mr} />
          )}
          {!hideApproval && !isSmallScreen && (
            <ApprovalButton
              ref={approvalButtonRef}
              mrId={mrId}
              approvalStatus={mr.approvalStatus}
              approvalsCount={mr.approvalsCount ?? 0}
              approvalsRequired={mr.approvalsRequired ?? 1}
              hasApproved={mr.userHasApproved}
              onApprovalChange={(approved, _count, trigger) => {
                if (approved) onApproved(trigger);
                else onUnapproved?.(trigger);
              }}
            />
          )}
        </div>
      </div>
      <div className="mr-header-bottom">
        <h1 className="mr-title">{mr.title}</h1>
        <div className="mr-detail-meta">
          <span className="mr-author">
            <UserAvatar instanceId={mr.instanceId} username={mr.authorUsername} size={20} className="mr-author-avatar" />
            {mr.authorUsername}
          </span>
          <span className="mr-branches">
            {mr.sourceBranch} → {mr.targetBranch}
          </span>
        </div>
      </div>
    </header>
  );
}
