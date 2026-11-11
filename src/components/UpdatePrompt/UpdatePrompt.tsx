/**
 * UpdatePrompt component.
 *
 * Modal overlay shown when a new version is available, so nobody has to be
 * asked to update. "Update now" downloads, installs and relaunches; "Later"
 * (or Escape) hides it for an hour.
 */

import { useEffect, useRef } from 'react';
import { ArrowCircleDown } from '@phosphor-icons/react';
import type { UpdateCheckerState } from '../../hooks/useUpdateChecker';
import './UpdatePrompt.css';

export default function UpdatePrompt({ updateChecker }: { updateChecker: UpdateCheckerState }) {
  const { version, body, installing, downloadProgress, error, installUpdate, snoozeUpdate } = updateChecker;
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Take focus, and keep the app's keyboard shortcuts from firing underneath.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    primaryRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape' && !installing) snoozeUpdate();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, [installing, snoozeUpdate]);

  return (
    <div className="update-prompt-overlay" role="dialog" aria-modal="true" aria-labelledby="update-prompt-title">
      <div className="update-prompt-modal">
        <div className="update-prompt-icon">
          <ArrowCircleDown size={40} weight="regular" />
        </div>

        <h2 id="update-prompt-title" className="update-prompt-title">
          Update available
        </h2>

        <p className="update-prompt-message">
          Ultra GitLab {version} is ready to download. Updating takes a few seconds and restarts the app.
        </p>

        {body && <pre className="update-prompt-notes">{body}</pre>}

        {installing && (
          <div className="update-prompt-progress" role="status">
            <div className="update-prompt-progress-bar">
              <div className="update-prompt-progress-fill" style={{ width: `${downloadProgress ?? 0}%` }} />
            </div>
            <span className="update-prompt-progress-text">
              {(downloadProgress ?? 0) < 100 ? `Downloading… ${downloadProgress ?? 0}%` : 'Installing…'}
            </span>
          </div>
        )}

        {error && <p className="update-prompt-error">Update failed: {error}</p>}

        <div className="update-prompt-actions">
          <button
            ref={primaryRef}
            className="update-prompt-button primary"
            onClick={installUpdate}
            disabled={installing}
          >
            {error ? 'Try again' : 'Update now'}
          </button>
          <button className="update-prompt-button secondary" onClick={snoozeUpdate} disabled={installing}>
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
