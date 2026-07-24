import { useState, useEffect } from 'react';
import { isTauri } from '../../services/transport';
import type { UpdateCheckerState } from '../../hooks/useUpdateChecker';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

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
    <SettingsGroup>
      <SettingsRow
        label="Current version"
        description={
          available && version ? (
            <span className="update-badge">{version} available</span>
          ) : (
            "You're up to date"
          )
        }
      >
        <span className="update-current-version"><strong>{appVersion}</strong></span>
        {!available && !installing && (
          <button
            className="update-check-button"
            onClick={checkForUpdate}
            disabled={checking}
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
        )}
      </SettingsRow>

      {available && body && (
        <SettingsRow label="Release notes" vertical>
          <pre className="update-release-notes">{body}</pre>
        </SettingsRow>
      )}

      {available && !installing && (
        <SettingsRow label="Install update" description="The app restarts after installing">
          <button className="update-install-button" onClick={installUpdate}>
            Download & Install
          </button>
        </SettingsRow>
      )}

      {installing && downloadProgress !== null && (
        <SettingsRow vertical>
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
        </SettingsRow>
      )}

      {error && (
        <SettingsRow vertical>
          <div className="update-error">
            {error}
            <button className="update-retry-button" onClick={checkForUpdate}>
              Retry
            </button>
          </div>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
