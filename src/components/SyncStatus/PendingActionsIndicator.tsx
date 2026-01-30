/**
 * Pending actions indicator component.
 *
 * Shows the number of pending and failed sync actions,
 * with retry/discard buttons for failed actions.
 */

import { useState } from 'react';
import useSyncStatus from '../../hooks/useSyncStatus';
import './PendingActionsIndicator.css';

interface PendingActionsIndicatorProps {
  /** Show as compact mode (icon only) */
  compact?: boolean;
}

/**
 * Pending actions indicator component.
 */
export default function PendingActionsIndicator({
  compact = false,
}: PendingActionsIndicatorProps) {
  const { pendingCount, failedCount, isSyncing, triggerSync, error } = useSyncStatus();
  const [expanded, setExpanded] = useState(false);

  const totalPending = pendingCount + failedCount;

  // Don't show if nothing pending
  if (totalPending === 0 && !isSyncing) {
    return null;
  }

  // Compact mode just shows an icon with count
  if (compact) {
    return (
      <button
        type="button"
        className={`sync-indicator-compact ${failedCount > 0 ? 'has-failed' : ''}`}
        onClick={() => setExpanded(!expanded)}
        title={`${pendingCount} pending, ${failedCount} failed`}
      >
        {isSyncing ? (
          <span className="sync-spinner" />
        ) : (
          <span className="sync-badge">{totalPending}</span>
        )}
      </button>
    );
  }

  return (
    <div className="pending-actions-indicator">
      <div className="sync-status-bar" onClick={() => setExpanded(!expanded)}>
        {isSyncing ? (
          <>
            <span className="sync-spinner" />
            <span className="sync-text">Syncing...</span>
          </>
        ) : (
          <>
            {pendingCount > 0 && (
              <span className="pending-count">
                {pendingCount} pending
              </span>
            )}
            {failedCount > 0 && (
              <span className="failed-count">
                {failedCount} failed
              </span>
            )}
          </>
        )}
      </div>

      {expanded && !isSyncing && (
        <div className="sync-actions-panel">
          {pendingCount > 0 && (
            <div className="sync-info">
              <p>{pendingCount} action(s) waiting to sync</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={triggerSync}
              >
                Sync Now
              </button>
            </div>
          )}

          {failedCount > 0 && (
            <div className="sync-failed">
              <p>{failedCount} action(s) failed to sync</p>
              {error && <p className="sync-error">{error}</p>}
              <div className="sync-failed-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={triggerSync}
                >
                  Retry All
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
