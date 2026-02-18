import type { RefObject } from 'react';
import { ApprovalButton, type ApprovalButtonRef } from '../../components/Approval';
import BackButton from '../../components/BackButton';
import type { MergeRequest } from '../../types';

interface MRHeaderProps {
  mr: MergeRequest;
  mrId: number;
  updateAvailable?: boolean;
  isSmallScreen: boolean;
  fileCount: number;
  approvalButtonRef: RefObject<ApprovalButtonRef | null>;
  onToggleMobileSidebar: () => void;
  onApproved: () => void;
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
          <ApprovalButton
            ref={approvalButtonRef}
            mrId={mrId}
            projectId={mr.projectId}
            mrIid={mr.iid}
            approvalStatus={mr.approvalStatus}
            approvalsCount={mr.approvalsCount ?? 0}
            approvalsRequired={mr.approvalsRequired ?? 1}
            hasApproved={mr.userHasApproved}
            onApprovalChange={(approved) => {
              if (approved) onApproved();
            }}
          />
        </div>
      </div>
      <div className="mr-header-bottom">
        <h1 className="mr-title">{mr.title}</h1>
        <div className="mr-detail-meta">
          <span className="mr-author">{mr.authorUsername}</span>
          <span className="mr-branches">
            {mr.sourceBranch} → {mr.targetBranch}
          </span>
        </div>
      </div>
    </header>
  );
}
