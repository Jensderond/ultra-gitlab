import { useState, useEffect } from 'react';
import { isTauri } from '../../services/transport';
import type { UpdateCheckerState } from '../../hooks/useUpdateChecker';

/**
 * Updates section showing current version and available updates.
 */
export default function UpdatesSection({ updateChecker }: { updateChecker: UpdateCheckerState }) {
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    if (!isTauri) { setAppVersion('browser'); return; }
    import('@tauri-apps/api/app').then(({ getVersion }) =>
      getVersion().then(setAppVersion)
    ).catch(() => setAppVersion('unknown'));
  }, []);

  const {
    available,
    checking,
    version,
    body,
    downloadProgress,
    installing,
    error,
    checkForUpdate,
    installUpdate,
  } = updateChecker;

  return (
    <section className="settings-section">
      <h2>Updates</h2>

      <div className="update-version-row">
        <span className="update-current-version">
          Current version: <strong>{appVersion}</strong>
        </span>
        {available && version ? (
          <span className="update-badge">{version} available</span>
        ) : (
          <span className="update-up-to-date">You're up to date</span>
        )}
        {!available && !installing && (
          <button
            className="update-check-button"
            onClick={checkForUpdate}
            disabled={checking}
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        )}
      </div>

      {available && body && (
        <pre className="update-release-notes">{body}</pre>
      )}

      {available && !installing && (
        <button className="update-install-button" onClick={installUpdate}>
          Download & Install
        </button>
      )}

      {installing && downloadProgress !== null && (
        <div className="update-progress">
          <div className="update-progress-bar">
            <div
              className="update-progress-fill"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <span className="update-progress-text">
            {downloadProgress < 100 ? `Downloading... ${downloadProgress}%` : 'Installing...'}
          </span>
        </div>
      )}

      {error && (
        <div className="update-error">
          {error}
          <button className="update-retry-button" onClick={checkForUpdate}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
