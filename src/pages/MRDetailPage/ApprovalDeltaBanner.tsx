import './ApprovalDeltaBanner.css';

interface ApprovalDeltaBannerProps {
  count: number;
  onReviewChanges: () => void;
  onDismiss: () => void;
}

export default function ApprovalDeltaBanner({
  count,
  onReviewChanges,
  onDismiss,
}: ApprovalDeltaBannerProps) {
  return (
    <div className="approval-delta-banner" role="status">
      <span>
        {count} {count === 1 ? 'file has' : 'files have'} changed since you approved.
      </span>
      <div className="approval-delta-banner-actions">
        <button
          type="button"
          className="approval-delta-banner-btn primary"
          onClick={onReviewChanges}
        >
          Review changes
        </button>
        <button
          type="button"
          className="approval-delta-banner-btn"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
