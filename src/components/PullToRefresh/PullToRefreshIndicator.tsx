import { ArrowsClockwise } from '@phosphor-icons/react';
import './PullToRefreshIndicator.css';

const THRESHOLD = 64;

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  refreshing: boolean;
}

/** Renders as the first child of a pull-to-refresh scroll container. */
export function PullToRefreshIndicator({ pullDistance, refreshing }: PullToRefreshIndicatorProps) {
  // Gesture-only: programmatic (desktop) refreshes keep pullDistance at 0 and
  // show their feedback in the page header instead, so nothing shifts.
  if (pullDistance <= 0) return null;

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const armed = !refreshing && progress >= 1;

  return (
    <div
      className={`pull-refresh-indicator${refreshing ? ' pull-refresh-indicator--active' : ''}`}
      style={{ height: refreshing ? 40 : pullDistance }}
      aria-hidden="true"
    >
      <ArrowsClockwise
        className="pull-refresh-spinner"
        style={refreshing ? undefined : { transform: `rotate(${progress * 360}deg)`, opacity: 0.4 + progress * 0.6 }}
        size={18}
        weight="bold"
      />
      <span
        className={`pull-refresh-label${armed ? ' pull-refresh-label--armed' : ''}`}
        style={refreshing ? undefined : { opacity: 0.4 + progress * 0.6 }}
      >
        {refreshing ? 'Refreshing' : armed ? 'Release to refresh' : 'Pull to refresh'}
      </span>
    </div>
  );
}
