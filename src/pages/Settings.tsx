/**
 * Settings page component.
 *
 * Displays GitLab instance management and application settings.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import InstanceSetup from '../components/InstanceSetup/InstanceSetup';
import {
  listInstances,
  removeInstance,
  type GitLabInstanceWithStatus,
} from '../services/gitlab';
import { formatRelativeTime } from '../services/storage';
import { invoke } from '../services/tauri';
import './Settings.css';

/** Sync configuration */
interface SyncConfig {
  interval_secs: number;
  sync_authored: boolean;
  sync_reviewing: boolean;
  max_mrs_per_sync: number;
}

/** Application settings */
interface AppSettings {
  sync: SyncConfig;
}

/** Predefined sync interval options */
const SYNC_INTERVALS = [
  { value: 60, label: '1 minute' },
  { value: 120, label: '2 minutes' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
];

/**
 * Settings page for managing GitLab instances.
 */
export default function Settings() {
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // Sync settings state
  const [syncSettings, setSyncSettings] = useState<SyncConfig | null>(null);
  const [syncSettingsLoading, setSyncSettingsLoading] = useState(true);
  const [syncSettingsSaving, setSyncSettingsSaving] = useState(false);

  // Load instances on mount
  useEffect(() => {
    loadInstances();
    loadSyncSettings();
  }, []);

  async function loadInstances() {
    try {
      setLoading(true);
      setError(null);
      const result = await listInstances();
      setInstances(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }

  async function loadSyncSettings() {
    try {
      setSyncSettingsLoading(true);
      const settings = await invoke<AppSettings>('get_settings');
      setSyncSettings(settings.sync);
    } catch (err) {
      console.error('Failed to load sync settings:', err);
      // Use defaults
      setSyncSettings({
        interval_secs: 300,
        sync_authored: true,
        sync_reviewing: true,
        max_mrs_per_sync: 100,
      });
    } finally {
      setSyncSettingsLoading(false);
    }
  }

  async function saveSyncSettings(newSettings: SyncConfig) {
    try {
      setSyncSettingsSaving(true);
      await invoke('update_sync_settings', { syncConfig: newSettings });
      setSyncSettings(newSettings);
    } catch (err) {
      console.error('Failed to save sync settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSyncSettingsSaving(false);
    }
  }

  function handleIntervalChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!syncSettings) return;
    const newSettings = { ...syncSettings, interval_secs: parseInt(e.target.value, 10) };
    saveSyncSettings(newSettings);
  }

  function handleScopeChange(scope: 'sync_authored' | 'sync_reviewing', checked: boolean) {
    if (!syncSettings) return;
    const newSettings = { ...syncSettings, [scope]: checked };
    saveSyncSettings(newSettings);
  }

  async function handleDelete(instanceId: number) {
    try {
      await removeInstance(instanceId);
      await loadInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete instance');
    }
  }

  function handleSetupComplete() {
    setShowSetup(false);
    loadInstances();
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <Link to="/mrs" className="back-link">
          ← Back to MRs
        </Link>
        <h1>Settings</h1>
      </header>

      <main className="settings-content">
        <section className="settings-section">
          <div className="section-header">
            <h2>GitLab Instances</h2>
            <button
              className="add-button"
              onClick={() => setShowSetup(true)}
              disabled={showSetup}
            >
              + Add Instance
            </button>
          </div>

          {error && <div className="error-message">{error}</div>}

          {showSetup && (
            <InstanceSetup
              onComplete={handleSetupComplete}
              onCancel={() => setShowSetup(false)}
            />
          )}

          {loading ? (
            <p className="loading">Loading instances...</p>
          ) : instances.length === 0 ? (
            <p className="empty-state">
              No GitLab instances configured.
              <br />
              Add one to start reviewing merge requests.
            </p>
          ) : (
            <ul className="instance-list">
              {instances.map((inst) => (
                <li key={inst.id} className="instance-item">
                  <div className="instance-info">
                    <span className="instance-name">
                      {inst.name || inst.url}
                    </span>
                    <span className="instance-url">{inst.url}</span>
                    <span className="instance-meta">
                      Added {formatRelativeTime(inst.createdAt)}
                      {!inst.hasToken && (
                        <span className="token-warning"> • Token missing</span>
                      )}
                    </span>
                  </div>
                  <button
                    className="delete-button"
                    onClick={() => handleDelete(inst.id)}
                    title="Remove instance"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-section">
          <h2>Sync Settings</h2>

          {syncSettingsLoading ? (
            <p className="loading">Loading settings...</p>
          ) : syncSettings ? (
            <div className="sync-settings-form">
              <div className="setting-row">
                <label htmlFor="sync-interval">Sync Interval</label>
                <select
                  id="sync-interval"
                  value={syncSettings.interval_secs}
                  onChange={handleIntervalChange}
                  disabled={syncSettingsSaving}
                >
                  {SYNC_INTERVALS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="setting-row">
                <label>Sync Scope</label>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={syncSettings.sync_authored}
                      onChange={(e) => handleScopeChange('sync_authored', e.target.checked)}
                      disabled={syncSettingsSaving}
                    />
                    MRs I authored
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={syncSettings.sync_reviewing}
                      onChange={(e) => handleScopeChange('sync_reviewing', e.target.checked)}
                      disabled={syncSettingsSaving}
                    />
                    MRs I'm reviewing
                  </label>
                </div>
              </div>

              {syncSettingsSaving && (
                <p className="saving-indicator">Saving...</p>
              )}
            </div>
          ) : (
            <p className="error-message">Failed to load sync settings</p>
          )}
        </section>

        <section className="settings-section">
          <h2>Keyboard Shortcuts</h2>
          <p className="coming-soon">
            Keyboard shortcut customization will be available in a future update.
          </p>
        </section>
      </main>
    </div>
  );
}
