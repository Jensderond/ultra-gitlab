import { useState, useEffect } from 'react';
import { invoke } from '../../services/tauri';

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
 * Sync settings section — interval and scope configuration.
 */
export default function SyncSettingsSection() {
  const [syncSettings, setSyncSettings] = useState<SyncConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSyncSettings();
  }, []);

  async function loadSyncSettings() {
    try {
      setLoading(true);
      const settings = await invoke<AppSettings>('get_settings');
      setSyncSettings(settings.sync);
    } catch (err) {
      console.error('Failed to load sync settings:', err);
      setSyncSettings({
        interval_secs: 300,
        sync_authored: true,
        sync_reviewing: true,
        max_mrs_per_sync: 100,
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveSyncSettings(newSettings: SyncConfig) {
    try {
      setSaving(true);
      await invoke('update_sync_settings', { syncConfig: newSettings });
      setSyncSettings(newSettings);
    } catch (err) {
      console.error('Failed to save sync settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
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

  return (
    <section className="settings-section">
      <h2>Sync Settings</h2>

      {loading ? (
        <p className="loading">Loading settings...</p>
      ) : syncSettings ? (
        <div className="sync-settings-form">
          <div className="setting-row">
            <label htmlFor="sync-interval">Sync Interval</label>
            <select
              id="sync-interval"
              value={syncSettings.interval_secs}
              onChange={handleIntervalChange}
              disabled={saving}
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
                  disabled={saving}
                />
                MRs I authored
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={syncSettings.sync_reviewing}
                  onChange={(e) => handleScopeChange('sync_reviewing', e.target.checked)}
                  disabled={saving}
                />
                MRs I'm reviewing
              </label>
            </div>
          </div>

          {saving && (
            <p className="saving-indicator">Saving...</p>
          )}

          {error && <div className="error-message">{error}</div>}
        </div>
      ) : (
        <p className="error-message">Failed to load sync settings</p>
      )}
    </section>
  );
}
