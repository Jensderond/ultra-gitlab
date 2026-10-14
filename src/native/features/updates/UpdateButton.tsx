/**
 * Pinned to the bottom of the home sidebar while an update is in flight:
 * blue with progress while it downloads, green once it's ready — one click
 * installs it and relaunches. Hidden when there's nothing to do.
 */

import { cx, Spinner } from '../../ui/components';
import { RetryIcon } from '../../ui/icons';
import { installUpdate, retryUpdate, useUpdateState } from './updater';
import './updates.css';

const DownloadIcon = ({ size = 14 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
  </svg>
);

const UpIcon = ({ size = 14 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16.5v-9M8 11l4-4 4 4" />
  </svg>
);

export function UpdateButton() {
  const { phase, version, progress, error } = useUpdateState();
  const v = version ? `Version ${version}` : '';

  if (phase === 'downloading') {
    const pct = progress === null ? null : Math.round(progress * 100);
    return (
      <div className="upd upd--downloading" role="status" aria-live="polite" title={`Downloading ${v.toLowerCase()} in the background`}>
        <DownloadIcon />
        <span className="upd__text">
          <span className="upd__title">Downloading update…</span>
          <span className="upd__sub tabular">
            {v}
            {pct !== null && ` · ${pct}%`}
          </span>
        </span>
        <span className="upd__track" aria-hidden="true">
          <span className={cx('upd__fill', pct === null && 'is-indeterminate')} style={pct === null ? undefined : { width: `${pct}%` }} />
        </span>
      </div>
    );
  }

  if (phase === 'ready' || phase === 'installing') {
    const installing = phase === 'installing';
    return (
      <button
        type="button"
        className="upd upd--ready"
        onClick={() => void installUpdate()}
        disabled={installing}
        title={installing ? undefined : `Install ${v.toLowerCase()} and restart Ultra GitLab`}
      >
        {installing ? <Spinner size={14} /> : <UpIcon />}
        <span className="upd__text">
          <span className="upd__title">{installing ? 'Installing…' : 'Restart to update'}</span>
          <span className="upd__sub">{v}</span>
        </span>
      </button>
    );
  }

  // Only failures of an actual update show here; a failed background check stays silent.
  if (phase === 'error' && version) {
    return (
      <button type="button" className="upd upd--error" onClick={retryUpdate} title={error ?? undefined}>
        <RetryIcon size={14} />
        <span className="upd__text">
          <span className="upd__title">Update failed</span>
          <span className="upd__sub">Click to try again</span>
        </span>
      </button>
    );
  }

  return null;
}
