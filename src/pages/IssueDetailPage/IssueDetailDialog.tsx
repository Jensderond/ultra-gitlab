import { useCallback, useState, type AnimationEvent } from 'react';
import type { IssueRef } from '../../components/Markdown';
import IssueDetailView from './IssueDetailView';

interface Props {
  instanceId: number;
  projectId: number;
  issueIid: number;
  onClose: () => void;
  onOpenIssue: (ref: IssueRef) => void;
}

export function IssueDetailDialog({
  instanceId,
  projectId,
  issueIid,
  onClose,
  onOpenIssue,
}: Props) {
  const [isClosing, setIsClosing] = useState(false);

  const beginClose = useCallback(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      onClose();
      return;
    }
    setIsClosing(true);
  }, [onClose]);

  const handleAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (isClosing && e.animationName === 'issue-detail-overlay-out') {
      onClose();
    }
  };

  return (
    <div
      className={`issue-detail-dialog-overlay${isClosing ? ' is-closing' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) beginClose();
      }}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="issue-detail-dialog">
        <IssueDetailView
          instanceId={instanceId}
          projectId={projectId}
          issueIid={issueIid}
          isActive={!isClosing}
          onClose={beginClose}
          onOpenIssue={onOpenIssue}
        />
      </div>
    </div>
  );
}
