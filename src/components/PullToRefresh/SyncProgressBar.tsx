import './SyncProgressBar.css';

/** Thin animated gradient bar — renders under a page header while a sync is in flight. */
export function SyncProgressBar() {
  return (
    <div className="sync-progress-bar" role="progressbar" aria-label="Syncing" aria-valuetext="Syncing">
      <div className="sync-progress-bar__sweep" />
    </div>
  );
}
