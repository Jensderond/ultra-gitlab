/**
 * Sync log panel component.
 *
 * Displays recent sync operations in an expandable panel.
 */

import type { SyncLogEntry } from '../../hooks/useSyncStatus';
import './SyncLogPanel.css';

interface SyncLogPanelProps {
  /** Log entries to display */
  logs: SyncLogEntry[];
  /** Close handler */
  onClose: () => void;
}

/**
 * Format a Unix timestamp as a time string.
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Get a human-readable label for an operation.
 */
function getOperationLabel(operation: string): string {
  const labels: Record<string, string> = {
    sync_complete: 'Sync complete',
    sync_mr: 'Synced MR',
    fetch_mrs: 'Fetched MRs',
    fetch_diff: 'Fetched diff',
    fetch_comments: 'Fetched comments',
    push_comment: 'Pushed comment',
    push_approval: 'Pushed approval',
    push_resolve: 'Resolved thread',
    purge_mrs: 'Purged MRs',
  };

  return labels[operation] || operation;
}

/**
 * Sync log panel component.
 */
export default function SyncLogPanel({ logs, onClose }: SyncLogPanelProps) {
  return (
    <div className="sync-log-panel">
      <div className="sync-log-header">
        <h3>Sync Log</h3>
        <button
          type="button"
          className="sync-log-close"
          onClick={onClose}
          title="Close"
        >
          ×
        </button>
      </div>

      <div className="sync-log-content">
        {logs.length === 0 ? (
          <div className="sync-log-empty">No sync activity yet</div>
        ) : (
          <ul className="sync-log-list">
            {logs.map((log) => (
              <li
                key={log.id}
                className={`sync-log-entry ${log.status === 'error' ? 'error' : ''}`}
              >
                <span className="log-time">{formatTime(log.timestamp)}</span>
                <span className={`log-status ${log.status}`}>
                  {log.status === 'success' ? '✓' : '✗'}
                </span>
                <span className="log-operation">
                  {getOperationLabel(log.operation)}
                  {log.mr_id && <span className="log-mr-id">!{log.mr_id}</span>}
                </span>
                {log.message && (
                  <span className="log-message" title={log.message}>
                    {log.message}
                  </span>
                )}
                {log.duration_ms !== null && (
                  <span className="log-duration">{log.duration_ms}ms</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
