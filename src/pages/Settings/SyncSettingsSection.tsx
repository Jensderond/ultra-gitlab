import { useState } from 'react';
import { useSyncSettingsQuery } from '../../hooks/queries/useSyncSettingsQuery';
import { useUpdateSyncSettingsMutation } from '../../hooks/queries/useUpdateSyncSettingsMutation';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

/** Sync configuration */
interface SyncConfig {
  interval_secs: number;
  max_mrs_per_sync: number;
  issue_interval_secs: number;
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

/** Predefined issue-sync interval options (issues change slower than MRs). */
const ISSUE_SYNC_INTERVALS = [
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 7200, label: '2 hours' },
];

/**
 * Sync settings section — interval and scope configuration.
 */
export default function SyncSettingsSection() {
  const [error, setError] = useState<string | null>(null);
  const syncQuery = useSyncSettingsQuery();
  const updateMutation = useUpdateSyncSettingsMutation();

  const syncSettings = syncQuery.data ?? null;
  const loading = syncQuery.isLoading;
  const saving = updateMutation.isPending;

  function saveSyncSettings(newSettings: SyncConfig) {
    updateMutation.mutate(newSettings, {
      onError: (err) => {
        console.error('Failed to save sync settings:', err);
        setError(err instanceof Error ? err.message : 'Failed to save settings');
      },
    });
  }

  function handleIntervalChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!syncSettings) return;
    const newSettings = { ...syncSettings, interval_secs: parseInt(e.target.value, 10) };
    saveSyncSettings(newSettings);
  }

  function handleIssueIntervalChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!syncSettings) return;
    const newSettings = {
      ...syncSettings,
      issue_interval_secs: parseInt(e.target.value, 10),
    };
    saveSyncSettings(newSettings);
  }

  return (
    <>
      {loading ? (
        <p className="loading">Loading settings...</p>
      ) : syncSettings ? (
        <>
          {error && <div className="error-message">{error}</div>}
          <SettingsGroup
            footer={saving ? <span className="saving-indicator">Saving...</span> : undefined}
          >
            <SettingsRow
              label="Sync interval"
              description="How often merge request data refreshes"
              htmlFor="sync-interval"
            >
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
            </SettingsRow>
            <SettingsRow
              label="Issue sync interval"
              description="Issues change slower, so they refresh less often"
              htmlFor="issue-sync-interval"
            >
              <select
                id="issue-sync-interval"
                value={syncSettings.issue_interval_secs}
                onChange={handleIssueIntervalChange}
                disabled={saving}
              >
                {ISSUE_SYNC_INTERVALS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </SettingsGroup>
        </>
      ) : (
        <p className="error-message">Failed to load sync settings</p>
      )}
    </>
  );
}
