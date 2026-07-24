import './SyncProgressBar.css';

/** Thin gradient bar pulsing from the center outwards — renders under a page header while a sync is in flight. */
export function SyncProgressBar() {
  return (
    <div className="sync-progress-bar" role="progressbar" aria-label="Syncing" aria-valuetext="Syncing">
      <div className="sync-progress-bar__pulse" />
    </div>
  );
}
