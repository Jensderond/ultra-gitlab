import type { RefObject } from 'react';
import { ApprovalButton, type ApprovalButtonRef } from '../../components/Approval';
import BackButton from '../../components/BackButton';
import UserAvatar from '../../components/UserAvatar/UserAvatar';
import type { MergeRequest } from '../../types';

interface MRHeaderProps {
  mr: MergeRequest;
  mrId: number;
  updateAvailable?: boolean;
  isSmallScreen: boolean;
  fileCount: number;
  approvalButtonRef: RefObject<ApprovalButtonRef | null>;
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
            {unresolvedCount > 0 && (
              <span className="activity-header-badge" data-testid="activity-badge">{unresolvedCount}</span>
            )}
          </button>
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
