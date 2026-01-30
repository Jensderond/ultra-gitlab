/**
 * Sync status bar component.
 *
 * Displays sync status, last sync time, pending actions,
 * and provides a manual sync trigger button.
 */

import { useState, useEffect, useCallback } from 'react';
import useSyncStatus from '../../hooks/useSyncStatus';
import SyncLogPanel from './SyncLogPanel';
import './SyncStatusBar.css';

interface SyncStatusBarProps {
  /** Additional CSS class */
  className?: string;
}

/**
 * Format a Unix timestamp as relative time.
 */
function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Never';

  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Sync status bar component.
 */
export default function SyncStatusBar({ className = '' }: SyncStatusBarProps) {
  const {
    isSyncing,
    pendingCount,
    failedCount,
    lastSyncTime,
    lastSyncMrCount,
    error,
    newMrsCount,
    recentLogs,
    triggerSync,
    retryAllActions,
    clearNewMrsNotification,
  } = useSyncStatus();

  const [showLogPanel, setShowLogPanel] = useState(false);
  const [relativeTime, setRelativeTime] = useState(() => formatRelativeTime(lastSyncTime));

  // Update relative time every minute
  useEffect(() => {
    setRelativeTime(formatRelativeTime(lastSyncTime));

    const interval = setInterval(() => {
      setRelativeTime(formatRelativeTime(lastSyncTime));
    }, 60000);

    return () => clearInterval(interval);
  }, [lastSyncTime]);

  // Handle Cmd+R shortcut for sync
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r' && !e.shiftKey) {
        e.preventDefault();
        triggerSync();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerSync]);

  // Handle clicking the new MRs badge
  const handleNewMrsClick = useCallback(() => {
    clearNewMrsNotification();
    // Optionally navigate to MR list or refresh
  }, [clearNewMrsNotification]);

  const totalPending = pendingCount + failedCount;

  return (
    <div className={`sync-status-bar ${className}`}>
      <div className="sync-status-left">
        {/* Sync status indicator */}
        {isSyncing ? (
          <div className="sync-status syncing">
            <span className="sync-spinner" />
            <span>Syncing...</span>
          </div>
        ) : error ? (
          <div className="sync-status error" title={error}>
            <span className="sync-icon error-icon">!</span>
            <span>Sync error</span>
          </div>
        ) : (
          <div className="sync-status idle">
            <span className="sync-icon">↻</span>
            <span>Last sync: {relativeTime}</span>
            {lastSyncMrCount > 0 && (
              <span className="sync-mr-count">({lastSyncMrCount} MRs)</span>
            )}
          </div>
        )}
      </div>

      <div className="sync-status-center">
        {/* New MRs notification */}
        {newMrsCount > 0 && (
          <button
            type="button"
            className="new-mrs-badge"
            onClick={handleNewMrsClick}
            title="New merge requests available"
          >
            {newMrsCount} new MR{newMrsCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      <div className="sync-status-right">
        {/* Pending actions indicator */}
        {totalPending > 0 && (
          <div className="pending-actions">
            {pendingCount > 0 && (
              <span className="pending-badge">{pendingCount} pending</span>
            )}
            {failedCount > 0 && (
              <button
                type="button"
                className="failed-badge"
                onClick={retryAllActions}
                title="Click to retry failed actions"
              >
                {failedCount} failed
              </button>
            )}
          </div>
        )}

        {/* Sync button */}
        <button
          type="button"
          className="sync-button"
          onClick={triggerSync}
          disabled={isSyncing}
          title="Sync now (Cmd+R)"
        >
          {isSyncing ? 'Syncing...' : 'Sync'}
        </button>

        {/* Log panel toggle */}
        <button
          type="button"
          className="log-toggle"
          onClick={() => setShowLogPanel(!showLogPanel)}
          title="View sync log"
        >
          {showLogPanel ? '▼' : '▲'}
        </button>
      </div>

      {/* Expandable log panel */}
      {showLogPanel && (
        <SyncLogPanel logs={recentLogs} onClose={() => setShowLogPanel(false)} />
      )}
    </div>
  );
}
