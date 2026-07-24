import type { RefObject } from 'react';
import { ShortcutBar } from '../../components/ShortcutBar';
import type { ShortcutDef } from '../../components/ShortcutBar';
import { ApprovalButton, type ApprovalButtonRef } from '../../components/Approval';
import { CaretLeftIcon, CaretRightIcon, CheckIcon } from '../../components/icons';
import type { MergeRequest } from '../../types';

interface MRFooterProps {
  /** 0-based index of the selected file among navigable files, or null if none selected. */
  fileIndex: number | null;
  fileCount: number;
  onPrevFile: () => void;
  onNextFile: () => void;
  isCurrentFileViewed: boolean;
  onMarkViewed: () => void;
  mr: MergeRequest;
  mrId: number;
  isSmallScreen: boolean;
  approvalButtonRef: RefObject<ApprovalButtonRef | null>;
  onApproved: (trigger: 'button' | 'keyboard') => void;
  onUnapproved?: (trigger: 'button' | 'keyboard') => void;
  /** Hide approval button for merged/closed MRs */
  hideApproval?: boolean;
}

const shortcuts: ShortcutDef[] = [
  { key: 'c', label: 'comment' },
  { key: 's', label: 'suggest' },
  { key: 'y', label: 'yank link' },
  { key: '?', label: 'help' },
];

export default function MRFooter({
  fileIndex,
  fileCount,
  onPrevFile,
  onNextFile,
  isCurrentFileViewed,
  onMarkViewed,
  mr,
  mrId,
  isSmallScreen,
  approvalButtonRef,
  onApproved,
  onUnapproved,
  hideApproval,
}: MRFooterProps) {
  return (
    <footer className="mr-detail-footer">
      <ShortcutBar shortcuts={shortcuts} variant="detail" />

      {/* Touch-only file navigation — no keyboard on iOS, so n/p/arrows need a tap equivalent. */}
      {fileCount > 0 && (
        <div className="mr-footer-mobile-nav">
          <button
            type="button"
            className="mr-footer-nav-btn"
            onClick={onPrevFile}
            aria-label="Previous file"
          >
            <CaretLeftIcon size={18} />
          </button>

          <button
            type="button"
            className={`mr-footer-viewed-btn${isCurrentFileViewed ? ' mr-footer-viewed-btn--active' : ''}`}
            onClick={onMarkViewed}
            aria-pressed={isCurrentFileViewed}
            aria-label={isCurrentFileViewed ? 'File marked as viewed' : 'Mark file as viewed'}
          >
            <CheckIcon size={14} />
            <span className="mr-footer-file-count">{fileIndex != null ? fileIndex + 1 : '–'} / {fileCount}</span>
          </button>

          <button
            type="button"
            className="mr-footer-nav-btn"
            onClick={onNextFile}
            aria-label="Next file"
          >
            <CaretRightIcon size={18} />
          </button>
        </div>
      )}

      {isSmallScreen && !hideApproval && (
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
    </footer>
  );
}
