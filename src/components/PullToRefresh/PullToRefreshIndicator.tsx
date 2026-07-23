import './PullToRefreshIndicator.css';

const THRESHOLD = 64;

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  refreshing: boolean;
}

/** Renders as the first child of a pull-to-refresh scroll container. */
export function PullToRefreshIndicator({ pullDistance, refreshing }: PullToRefreshIndicatorProps) {
  if (pullDistance <= 0 && !refreshing) return null;

  const progress = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div
      className={`pull-refresh-indicator${refreshing ? ' pull-refresh-indicator--active' : ''}`}
      style={{ height: refreshing ? 40 : pullDistance }}
      aria-hidden="true"
    >
      <svg
        className="pull-refresh-spinner"
        style={refreshing ? undefined : { transform: `rotate(${progress * 360}deg)`, opacity: 0.4 + progress * 0.6 }}
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    </div>
  );
}
