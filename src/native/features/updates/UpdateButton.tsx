/**
 * Footer pinned under the home sidebar while an update is in flight, like
 * the status footers in Mail and Xcode: a thin progress bar while it
 * downloads, then "Update ready" with a Restart button that installs and
 * relaunches. Hidden when there's nothing to do.
 */

import { useId } from 'react';
import { Button } from '../../ui/components';
import { WarningIcon } from '../../ui/icons';
import { installUpdate, retryUpdate, useUpdateState } from './updater';
import './updates.css';

const DownloadIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6.75" />
    <path d="M8 4.8v6M5.6 8.4 8 10.8l2.4-2.4" />
  </svg>
);

/** Filled variant of DownloadIcon: the download is done. */
const ReadyIcon = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7.5" fill="currentColor" />
    <path d="M8 4.6v6.2M5.5 8.4 8 10.9l2.5-2.5" fill="none" stroke="var(--text-on-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function UpdateButton() {
  const { phase, version, progress, error } = useUpdateState();
  const textId = useId();
  const v = version ? `Version ${version}` : '';

  if (phase === 'downloading') {
    const pct = progress === null ? null : Math.round(progress * 100);
    return (
      <div className="upd" role="status" aria-live="polite">
        <span className="upd__icon">
          <DownloadIcon />
        </span>
        <span className="upd__text">
          <span className="upd__title">Downloading update…</span>
          <span
            className="upd__track"
            role="progressbar"
            aria-label="Download progress"
            aria-valuenow={pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className={pct === null ? 'upd__fill is-indeterminate' : 'upd__fill'} style={pct === null ? undefined : { width: `${pct}%` }} />
          </span>
          <span className="upd__sub tabular">
            {v}
            {pct !== null && ` · ${pct}%`}
          </span>
        </span>
      </div>
    );
  }

  if (phase === 'ready' || phase === 'installing') {
    return (
      <div className="upd">
        <span className="upd__icon">
          <ReadyIcon />
        </span>
        <span className="upd__text" id={textId}>
          <span className="upd__title">Update ready</span>
          <span className="upd__sub tabular">{v}</span>
        </span>
        <Button
          size="sm"
          className="upd__action"
          onClick={() => void installUpdate()}
          busy={phase === 'installing'}
          aria-describedby={textId}
          title={`Install ${v.toLowerCase()} and restart Ultra GitLab`}
        >
          Restart
        </Button>
      </div>
    );
  }

  // Only failures of an actual update show here; a failed background check stays silent.
  if (phase === 'error' && version) {
    return (
      <div className="upd">
        <span className="upd__icon upd__icon--error">
          <WarningIcon size={16} />
        </span>
        <span className="upd__text" id={textId} title={error ?? undefined}>
          <span className="upd__title">Update failed</span>
          <span className="upd__sub tabular">{v}</span>
        </span>
        <Button size="sm" className="upd__action" onClick={retryUpdate} aria-describedby={textId}>
          Try again
        </Button>
      </div>
    );
  }

  return null;
}
