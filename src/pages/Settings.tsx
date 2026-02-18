/**
 * Settings page component.
 *
 * Displays GitLab instance management and application settings.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import BackButton from '../components/BackButton';
import { isTauri } from '../services/transport';
import InstanceSetup from '../components/InstanceSetup/InstanceSetup';
import {
  listInstances,
  removeInstance,
  type GitLabInstanceWithStatus,
} from '../services/gitlab';
import { formatRelativeTime } from '../services/storage';
import { invoke, getTokenInfo, updateInstanceToken, getCollapsePatterns, updateCollapsePatterns, getNotificationSettings, updateNotificationSettings, sendNativeNotification, getCompanionSettings, getCompanionQrSvg, updateCompanionSettings, regenerateCompanionPin, revokeCompanionDevice, startCompanionServer, stopCompanionServer } from '../services/tauri';
import type { TokenInfo, NotificationSettings, Theme, CompanionServerSettings } from '../types';
import { useToast } from '../components/Toast';
import type { UpdateCheckerState } from '../hooks/useUpdateChecker';
import useTheme from '../hooks/useTheme';
import { THEME_PRESETS, UI_FONTS } from '../components/ThemeProvider';
import { deriveTheme } from '../themes/deriveTheme';
import useCustomShortcuts from '../hooks/useCustomShortcuts';
import { COMPANION_STATUS_CHANGED } from '../hooks/useCompanionStatus';
import {
  defaultShortcuts,
  categoryLabels,
  formatKey,
  type ShortcutCategory,
} from '../config/shortcuts';
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

interface SettingsProps {
  updateChecker?: UpdateCheckerState;
}

/**
 * Settings page for managing GitLab instances.
 */
export default function Settings({ updateChecker }: SettingsProps) {
  const { addToast } = useToast();
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // Edit token state
  const [editingTokenId, setEditingTokenId] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenSuccess, setTokenSuccess] = useState<string | null>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  // Token info state
  const [tokenInfoMap, setTokenInfoMap] = useState<Record<number, TokenInfo | 'error'>>({});

  // Sync settings state
  const [syncSettings, setSyncSettings] = useState<SyncConfig | null>(null);
  const [syncSettingsLoading, setSyncSettingsLoading] = useState(true);
  const [syncSettingsSaving, setSyncSettingsSaving] = useState(false);

  // Notification settings state
  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);
  const [notifSettingsLoading, setNotifSettingsLoading] = useState(true);
  const [notifSettingsSaving, setNotifSettingsSaving] = useState(false);

  // Load instances on mount
  useEffect(() => {
    loadInstances();
    loadSyncSettings();
    loadNotificationSettings();
  }, []);

  async function loadInstances() {
    try {
      setLoading(true);
      setError(null);
      const result = await listInstances();
      setInstances(result);
      loadTokenInfos(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }

  async function loadTokenInfos(insts: GitLabInstanceWithStatus[]) {
    const results = await Promise.allSettled(
      insts.filter((i) => i.hasToken).map(async (inst) => {
        const info = await getTokenInfo(inst.id);
        return { id: inst.id, info };
      })
    );
    const map: Record<number, TokenInfo | 'error'> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        map[result.value.id] = result.value.info;
      } else {
        // Can't recover instance id from rejected promise easily, skip
      }
    }
    setTokenInfoMap(map);
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

  async function loadNotificationSettings() {
    try {
      setNotifSettingsLoading(true);
      const settings = await getNotificationSettings();
      setNotifSettings(settings);
    } catch (err) {
      console.error('Failed to load notification settings:', err);
    } finally {
      setNotifSettingsLoading(false);
    }
  }

  async function handleNotifToggle(field: keyof NotificationSettings, checked: boolean) {
    if (!notifSettings) return;
    const newSettings = { ...notifSettings, [field]: checked };
    setNotifSettings(newSettings);
    try {
      setNotifSettingsSaving(true);
      await updateNotificationSettings(newSettings);
    } catch (err) {
      console.error('Failed to save notification settings:', err);
      setNotifSettings(notifSettings);
    } finally {
      setNotifSettingsSaving(false);
    }
  }

  function handleTestNotification() {
    addToast({
      type: 'mr-ready',
      title: 'MR Ready to Merge',
      body: 'feat: add notifications — My Project',
      url: 'https://gitlab.com',
    });
    if (notifSettings?.nativeNotificationsEnabled) {
      sendNativeNotification('MR Ready to Merge', 'feat: add notifications — My Project').catch(() => {});
    }
  }

  function startEditToken(instanceId: number) {
    setEditingTokenId(instanceId);
    setTokenInput('');
    setTokenError(null);
    setTokenSuccess(null);
    // Auto-focus happens via useEffect on ref
    setTimeout(() => tokenInputRef.current?.focus(), 0);
  }

  function cancelEditToken() {
    setEditingTokenId(null);
    setTokenInput('');
    setTokenError(null);
    setTokenSuccess(null);
  }

  async function handleSaveToken(instanceId: number) {
    if (!tokenInput.trim()) return;
    try {
      setTokenSaving(true);
      setTokenError(null);
      const username = await updateInstanceToken(instanceId, tokenInput.trim());
      setTokenSuccess(`Token updated (${username})`);
      setTokenInput('');
      setTimeout(() => {
        cancelEditToken();
        loadInstances();
      }, 1500);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'Invalid token');
    } finally {
      setTokenSaving(false);
    }
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

  function formatExpiration(info: TokenInfo): { text: string; daysLeft: number | null } {
    if (!info.expiresAt) return { text: 'No expiration', daysLeft: null };
    const expires = new Date(info.expiresAt);
    const now = new Date();
    const diffMs = expires.getTime() - now.getTime();
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const formatted = expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (daysLeft < 0) {
      return { text: `Expired ${formatted}`, daysLeft };
    }
    return { text: `Expires ${formatted} — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, daysLeft };
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <BackButton to="/mrs" title="Back to MRs" />
        <h1>Settings</h1>
      </header>

      <main className="settings-content">
        {isTauri && updateChecker && (
          <UpdatesSection updateChecker={updateChecker} />
        )}

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
                    {tokenInfoMap[inst.id] && tokenInfoMap[inst.id] !== 'error' && (() => {
                      const { text, daysLeft } = formatExpiration(tokenInfoMap[inst.id] as TokenInfo);
                      return (
                        <span className="instance-expiration">
                          {text}
                          {daysLeft !== null && daysLeft < 0 && (
                            <span className="token-badge token-badge-expired">Expired</span>
                          )}
                          {daysLeft !== null && daysLeft >= 0 && daysLeft < 30 && (
                            <span className="token-badge token-badge-warning">Expiring soon</span>
                          )}
                        </span>
                      );
                    })()}
                    {editingTokenId === inst.id ? (
                      <div className="edit-token-form">
                        <input
                          ref={tokenInputRef}
                          type="password"
                          className="edit-token-input"
                          value={tokenInput}
                          onChange={(e) => setTokenInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveToken(inst.id);
                            if (e.key === 'Escape') cancelEditToken();
                          }}
                          placeholder="glpat-..."
                          disabled={tokenSaving}
                          autoFocus
                        />
                        <div className="edit-token-actions">
                          <button
                            className="edit-token-save"
                            onClick={() => handleSaveToken(inst.id)}
                            disabled={tokenSaving || !tokenInput.trim()}
                          >
                            {tokenSaving ? 'Validating...' : 'Save'}
                          </button>
                          <button
                            className="edit-token-cancel"
                            onClick={cancelEditToken}
                            disabled={tokenSaving}
                          >
                            Cancel
                          </button>
                        </div>
                        {tokenError && (
                          <span className="edit-token-error">{tokenError}</span>
                        )}
                        {tokenSuccess && (
                          <span className="edit-token-success">{tokenSuccess}</span>
                        )}
                      </div>
                    ) : (
                      <button
                        className="edit-token-button"
                        onClick={() => startEditToken(inst.id)}
                      >
                        Edit Token
                      </button>
                    )}
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

        {isTauri && (
          <section className="settings-section">
            <CompanionServerSection />
          </section>
        )}

        <section className="settings-section">
          <AppearanceSection />
        </section>

        {isTauri && (
          <section className="settings-section">
            <div className="section-header">
              <h2>Notifications</h2>
              <button
                className="add-button"
                onClick={handleTestNotification}
              >
                Test Notification
              </button>
            </div>

            {notifSettingsLoading ? (
              <p className="loading">Loading settings...</p>
            ) : notifSettings ? (
              <div className="sync-settings-form">
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={notifSettings.mrReadyToMerge}
                      onChange={(e) => handleNotifToggle('mrReadyToMerge', e.target.checked)}
                      disabled={notifSettingsSaving}
                    />
                    <span>
                      MR ready to merge
                      <span className="checkbox-description">Notify when your MR has all approvals and pipeline passed</span>
                    </span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={notifSettings.pipelineStatusPinned}
                      onChange={(e) => handleNotifToggle('pipelineStatusPinned', e.target.checked)}
                      disabled={notifSettingsSaving}
                    />
                    <span>
                      Pipeline status (pinned projects)
                      <span className="checkbox-description">Notify when a pinned project pipeline status changes</span>
                    </span>
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={notifSettings.nativeNotificationsEnabled}
                      onChange={(e) => handleNotifToggle('nativeNotificationsEnabled', e.target.checked)}
                      disabled={notifSettingsSaving}
                    />
                    <span>
                      Native OS notifications
                      <span className="checkbox-description">Show notifications in macOS Notification Center</span>
                    </span>
                  </label>
                </div>

                {notifSettingsSaving && (
                  <p className="saving-indicator">Saving...</p>
                )}
              </div>
            ) : (
              <p className="error-message">Failed to load notification settings</p>
            )}
          </section>
        )}

        {isTauri && (
          <section className="settings-section">
            <CollapsePatternsEditor />
          </section>
        )}

        {isTauri && (
          <section className="settings-section">
            <ShortcutEditor />
          </section>
        )}
      </main>
    </div>
  );
}

/**
 * Companion server settings section.
 * Allows enabling/disabling the embedded HTTP server for mobile access.
 */
function CompanionServerSection() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<CompanionServerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [portInput, setPortInput] = useState('');
  const [portError, setPortError] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
    // Re-poll every 15s so newly authorized devices appear without manual refresh
    const interval = setInterval(loadSettings, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch QR code SVG via Tauri command when server is enabled
  useEffect(() => {
    if (settings?.enabled && settings.port) {
      getCompanionQrSvg()
        .then(setQrSvg)
        .catch(() => setQrSvg(null));
    } else {
      setQrSvg(null);
    }
  }, [settings?.enabled, settings?.port, settings?.pin]);

  const initialLoadDone = useRef(false);

  async function loadSettings() {
    try {
      // Only show loading spinner on initial load, not on re-polls
      if (!initialLoadDone.current) setLoading(true);
      const s = await getCompanionSettings();
      setSettings(s);
      setPortInput((prev) => {
        // Don't overwrite user's in-progress edits
        const currentPort = String(s.port);
        return prev === '' || prev === currentPort ? currentPort : prev;
      });
      initialLoadDone.current = true;
    } catch (err) {
      console.error('Failed to load companion settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(enabled: boolean) {
    if (!settings) return;
    const updated = { ...settings, enabled };
    try {
      setSaving(true);
      await updateCompanionSettings(updated);
      if (enabled) {
        await startCompanionServer();
        addToast({ type: 'info', title: 'Companion Server', body: `Server started on port ${settings.port}` });
      } else {
        await stopCompanionServer();
        addToast({ type: 'info', title: 'Companion Server', body: 'Server stopped' });
      }
      setSettings(updated);
      window.dispatchEvent(new Event(COMPANION_STATUS_CHANGED));
    } catch (err) {
      console.error('Failed to toggle companion server:', err);
      addToast({ type: 'info', title: 'Error', body: err instanceof Error ? err.message : 'Failed to toggle server' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePortBlur() {
    if (!settings) return;
    const port = parseInt(portInput, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      setPortError('Port must be between 1024 and 65535');
      return;
    }
    setPortError(null);
    if (port === settings.port) return;

    const updated = { ...settings, port };
    try {
      setSaving(true);
      await updateCompanionSettings(updated);
      setSettings(updated);
      // If server is running, restart it on the new port
      if (settings.enabled) {
        await stopCompanionServer();
        await startCompanionServer();
      }
    } catch (err) {
      console.error('Failed to update port:', err);
      setPortInput(String(settings.port));
    } finally {
      setSaving(false);
    }
  }

  async function handleRegeneratePin() {
    try {
      setSaving(true);
      const newPin = await regenerateCompanionPin();
      setSettings((prev) => prev ? { ...prev, pin: newPin, authorizedDevices: [] } : prev);
      addToast({ type: 'info', title: 'PIN Regenerated', body: 'All devices have been disconnected' });
    } catch (err) {
      console.error('Failed to regenerate PIN:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    try {
      setSaving(true);
      await revokeCompanionDevice(deviceId);
      setSettings((prev) => prev ? {
        ...prev,
        authorizedDevices: prev.authorizedDevices.filter((d) => d.id !== deviceId),
      } : prev);
    } catch (err) {
      console.error('Failed to revoke device:', err);
    } finally {
      setSaving(false);
    }
  }

  function formatDeviceTime(isoStr: string): string {
    try {
      const date = new Date(isoStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch {
      return isoStr;
    }
  }

  if (loading) {
    return (
      <>
        <h2>Companion Server <span className="beta-badge">Beta</span></h2>
        <p className="loading">Loading settings...</p>
      </>
    );
  }

  if (!settings) {
    return (
      <>
        <h2>Companion Server <span className="beta-badge">Beta</span></h2>
        <p className="error-message">Failed to load companion settings</p>
      </>
    );
  }

  return (
    <>
      <h2>Companion Server <span className="beta-badge">Beta</span></h2>
      <p className="companion-description">
        Access MR reviews from your phone. Enable the companion server to serve the review UI on your local network.
      </p>

      <div className="companion-settings-form">
        {/* Enable/disable toggle */}
        <div className="companion-toggle-row">
          <label className="companion-toggle-label">
            <button
              className={`companion-toggle ${settings.enabled ? 'active' : ''}`}
              onClick={() => handleToggle(!settings.enabled)}
              disabled={saving}
              role="switch"
              aria-checked={settings.enabled}
            >
              <span className="companion-toggle-knob" />
            </button>
            <span className={`companion-toggle-text ${settings.enabled ? 'active' : ''}`}>
              {settings.enabled ? 'Running' : 'Off'}
            </span>
          </label>
        </div>

        {/* Port input — always visible so it can be set before enabling */}
        <div className="setting-row">
          <label htmlFor="companion-port">Port</label>
          <div className="companion-port-row">
            <input
              id="companion-port"
              type="number"
              className="companion-port-input"
              value={portInput}
              onChange={(e) => { setPortInput(e.target.value); setPortError(null); }}
              onBlur={handlePortBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              min={1024}
              max={65535}
              disabled={saving}
            />
            {portError && <span className="companion-port-error">{portError}</span>}
          </div>
        </div>

        {/* Remaining options only visible when server is enabled */}
        {settings.enabled && (
          <>
            {/* Server URL and QR code */}
            <div className="companion-connection-info">
              {qrSvg ? (
                <div className="companion-qr-container">
                  <img
                    className="companion-qr-code"
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`}
                    alt="QR code to connect your phone"
                  />
                  <p className="companion-qr-hint">Scan with your phone camera</p>
                </div>
              ) : (
                <p className="companion-url-hint">
                  Open on your phone: <code>http://{'<your-ip>'}:{settings.port}</code>
                </p>
              )}
            </div>

            {/* PIN display */}
            <div className="companion-pin-row">
              <label className="companion-pin-label">PIN Code</label>
              <div className="companion-pin-display">
                <code className="companion-pin-value">{settings.pin}</code>
                <button
                  className="companion-pin-regenerate"
                  onClick={handleRegeneratePin}
                  disabled={saving}
                >
                  Regenerate
                </button>
              </div>
              <span className="companion-pin-hint">Devices must enter this PIN to connect</span>
            </div>

            {/* Authorized devices */}
            <div className="companion-devices">
              <label className="companion-devices-label">
                Authorized Devices
                {settings.authorizedDevices.length > 0 && (
                  <span className="companion-devices-count">{settings.authorizedDevices.length}</span>
                )}
              </label>
              {settings.authorizedDevices.length === 0 ? (
                <p className="companion-devices-empty">No devices connected yet</p>
              ) : (
                <ul className="companion-device-list">
                  {settings.authorizedDevices.map((device) => (
                    <li key={device.id} className="companion-device-item">
                      <div className="companion-device-info">
                        <span className="companion-device-name">{device.name}</span>
                        <span className="companion-device-meta">
                          Last active: {formatDeviceTime(device.lastActive)}
                        </span>
                      </div>
                      <button
                        className="companion-device-revoke"
                        onClick={() => handleRevokeDevice(device.id)}
                        disabled={saving}
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {saving && <p className="saving-indicator">Saving...</p>}
    </>
  );
}

/**
 * Editor for generated file collapse patterns.
 */
function CollapsePatternsEditor() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPatterns();
  }, []);

  async function loadPatterns() {
    try {
      setLoading(true);
      const result = await getCollapsePatterns();
      setPatterns(result);
    } catch (err) {
      console.error('Failed to load collapse patterns:', err);
      setPatterns([]);
    } finally {
      setLoading(false);
    }
  }

  async function savePatterns(newPatterns: string[]) {
    try {
      setSaving(true);
      await updateCollapsePatterns(newPatterns);
      setPatterns(newPatterns);
    } catch (err) {
      console.error('Failed to save collapse patterns:', err);
    } finally {
      setSaving(false);
    }
  }

  function handlePatternChange(index: number, value: string) {
    const updated = [...patterns];
    updated[index] = value;
    setPatterns(updated);
  }

  function handlePatternBlur(index: number) {
    const trimmed = patterns[index].trim();
    if (trimmed === '') {
      // Remove empty patterns on blur
      const updated = patterns.filter((_, i) => i !== index);
      savePatterns(updated);
    } else {
      const updated = [...patterns];
      updated[index] = trimmed;
      savePatterns(updated);
    }
  }

  function handlePatternKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleRemove(index: number) {
    const updated = patterns.filter((_, i) => i !== index);
    savePatterns(updated);
  }

  function handleAdd() {
    setPatterns([...patterns, '']);
  }

  if (loading) {
    return (
      <>
        <h2>Generated File Patterns</h2>
        <p className="loading">Loading patterns...</p>
      </>
    );
  }

  return (
    <>
      <h2>Generated File Patterns</h2>
      <p className="collapse-patterns-description">
        Files matching these glob patterns will be dimmed in the file tree.
        Patterns from <code>.gitattributes</code> (linguist-generated) are also used automatically.
      </p>

      <div className="collapse-patterns-list">
        {patterns.map((pattern, index) => (
          <div key={index} className="collapse-pattern-row">
            <input
              type="text"
              className="collapse-pattern-input"
              value={pattern}
              onChange={(e) => handlePatternChange(index, e.target.value)}
              onBlur={() => handlePatternBlur(index)}
              onKeyDown={handlePatternKeyDown}
              placeholder="e.g. *.lock"
              disabled={saving}
              autoFocus={pattern === ''}
            />
            <button
              className="collapse-pattern-remove"
              onClick={() => handleRemove(index)}
              disabled={saving}
              title="Remove pattern"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button
        className="collapse-pattern-add"
        onClick={handleAdd}
        disabled={saving}
      >
        + Add pattern
      </button>

      {saving && <p className="saving-indicator">Saving...</p>}
    </>
  );
}

/**
 * Updates section showing current version and available updates.
 */
function UpdatesSection({ updateChecker }: { updateChecker: UpdateCheckerState }) {
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

/**
 * Shortcut editor component for customizing keyboard shortcuts.
 */
function ShortcutEditor() {
  const {
    customBindings,
    loading,
    setBinding,
    resetBinding,
    resetAllBindings,
    isKeyInUse,
  } = useCustomShortcuts();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Group shortcuts by category
  const groupedShortcuts = useCallback(() => {
    const groups = new Map<ShortcutCategory, typeof defaultShortcuts>();
    const categoryOrder: ShortcutCategory[] = [
      'global',
      'navigation',
      'list',
      'diff',
      'review',
      'sync',
    ];

    for (const category of categoryOrder) {
      groups.set(category, []);
    }

    for (const shortcut of defaultShortcuts) {
      const group = groups.get(shortcut.category);
      if (group) {
        group.push(shortcut);
      }
    }

    return groups;
  }, []);

  // Start editing a shortcut
  const startEditing = (shortcutId: string, currentKey: string) => {
    setEditingId(shortcutId);
    setEditValue(currentKey);
    setError(null);
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setEditValue('');
    setError(null);
  };

  // Handle key input for editing
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();

    if (e.key === 'Escape') {
      cancelEditing();
      return;
    }

    if (e.key === 'Enter' && editValue) {
      saveBinding();
      return;
    }

    // Build key string
    let key = '';
    if (e.metaKey || e.ctrlKey) key += e.metaKey ? 'Cmd+' : 'Ctrl+';
    if (e.altKey) key += 'Alt+';
    if (e.shiftKey && e.key !== 'Shift') key += 'Shift+';

    // Add the actual key if it's not just a modifier
    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
      key += e.key.length === 1 ? e.key.toUpperCase() : e.key;
    }

    if (key) {
      setEditValue(key);
      setError(null);
    }
  };

  // Save the current binding
  const saveBinding = async () => {
    if (!editingId || !editValue) return;

    // Check for conflicts
    if (isKeyInUse(editValue, editingId)) {
      setError('This key is already in use');
      return;
    }

    try {
      setSaving(true);
      await setBinding(editingId, editValue);
      setEditingId(null);
      setEditValue('');
    } catch (err) {
      setError('Failed to save shortcut');
    } finally {
      setSaving(false);
    }
  };

  // Reset a single shortcut
  const handleReset = async (shortcutId: string) => {
    try {
      setSaving(true);
      await resetBinding(shortcutId);
    } catch (err) {
      console.error('Failed to reset shortcut:', err);
    } finally {
      setSaving(false);
    }
  };

  // Reset all shortcuts
  const handleResetAll = async () => {
    if (!confirm('Reset all keyboard shortcuts to defaults?')) return;

    try {
      setSaving(true);
      await resetAllBindings();
    } catch (err) {
      console.error('Failed to reset all shortcuts:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <h2>Keyboard Shortcuts</h2>
        <p className="loading">Loading shortcuts...</p>
      </>
    );
  }

  const groups = groupedShortcuts();
  const hasCustomBindings = Object.keys(customBindings).length > 0;

  return (
    <>
      <div className="section-header">
        <h2>Keyboard Shortcuts</h2>
        {hasCustomBindings && (
          <button
            className="reset-all-button"
            onClick={handleResetAll}
            disabled={saving}
          >
            Reset All
          </button>
        )}
      </div>

      <div className="shortcuts-editor">
        {Array.from(groups.entries()).map(([category, categoryShortcuts]) => {
          if (categoryShortcuts.length === 0) return null;

          return (
            <div key={category} className="shortcut-category-section">
              <h3 className="shortcut-category-header">
                {categoryLabels[category]}
              </h3>
              <div className="shortcut-items">
                {categoryShortcuts.map((shortcut) => {
                  const currentKey = customBindings[shortcut.id] || shortcut.defaultKey;
                  const isEditing = editingId === shortcut.id;
                  const isCustom = !!customBindings[shortcut.id];

                  return (
                    <div
                      key={shortcut.id}
                      className={`shortcut-editor-item ${isEditing ? 'editing' : ''}`}
                    >
                      <span className="shortcut-description">
                        {shortcut.description}
                      </span>

                      {isEditing ? (
                        <div className="shortcut-edit-controls">
                          <input
                            type="text"
                            className="shortcut-input"
                            value={editValue}
                            onChange={() => {}} // Controlled by onKeyDown
                            onKeyDown={handleKeyDown}
                            onBlur={cancelEditing}
                            placeholder="Press a key..."
                            autoFocus
                          />
                          {error && (
                            <span className="shortcut-error">{error}</span>
                          )}
                        </div>
                      ) : (
                        <div className="shortcut-display-controls">
                          <kbd
                            className={`shortcut-key-display ${isCustom ? 'custom' : ''}`}
                            onClick={() => startEditing(shortcut.id, currentKey)}
                            title="Click to edit"
                          >
                            {formatKey(currentKey)}
                          </kbd>
                          {isCustom && (
                            <button
                              className="shortcut-reset-button"
                              onClick={() => handleReset(shortcut.id)}
                              disabled={saving}
                              title={`Reset to ${formatKey(shortcut.defaultKey)}`}
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="shortcut-hint">
        Click on a shortcut to edit. Press the new key combination, then Enter to save.
      </p>
    </>
  );
}

/**
 * Theme preset list for the appearance section.
 */
const PRESET_THEME_IDS: Theme[] = ['kanagawa-wave', 'kanagawa-light', 'loved'];

/**
 * Appearance section — theme selector with visual swatches + font selector + custom theme editor.
 */
function AppearanceSection() {
  const { theme, setThemeById, uiFont, setUiFont, customColors, previewCustomTheme, saveCustomTheme, deleteCustomTheme } = useTheme();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorBg, setEditorBg] = useState('#1f1f28');
  const [editorText, setEditorText] = useState('#dcd7ba');
  const [editorAccent, setEditorAccent] = useState('#7e9cd8');
  // Track the theme ID before we started editing, to revert on cancel
  const preEditThemeRef = useRef<Theme>('kanagawa-wave');

  // Background-load all Google Fonts when this section mounts (for previews)
  useEffect(() => {
    if (fontsLoaded) return;
    for (const font of UI_FONTS) {
      if (font.googleFont) {
        const id = `google-font-${font.googleFont.replace(/[^a-zA-Z0-9]/g, '-')}`;
        if (!document.getElementById(id)) {
          const link = document.createElement('link');
          link.id = id;
          link.rel = 'stylesheet';
          link.href = `https://fonts.googleapis.com/css2?family=${font.googleFont}&display=swap`;
          document.head.appendChild(link);
        }
      }
    }
    setFontsLoaded(true);
  }, [fontsLoaded]);

  // Live preview as user picks colors
  useEffect(() => {
    if (editing) {
      previewCustomTheme({ bg: editorBg, text: editorText, accent: editorAccent });
    }
  }, [editing, editorBg, editorText, editorAccent, previewCustomTheme]);

  // Derived swatch preview for saved custom theme
  const customSwatchDef = useMemo(() => {
    if (!customColors) return null;
    return deriveTheme(customColors.bg, customColors.text, customColors.accent);
  }, [customColors]);

  function handleCreateCustom() {
    preEditThemeRef.current = theme.id as Theme;
    // Start with current theme's key colors as defaults
    setEditorBg(theme.backgrounds.primary);
    setEditorText(theme.text.primary);
    setEditorAccent(theme.accent.color);
    setEditing(true);
  }

  function handleEditCustom() {
    if (!customColors) return;
    preEditThemeRef.current = 'custom';
    setEditorBg(customColors.bg);
    setEditorText(customColors.text);
    setEditorAccent(customColors.accent);
    setEditing(true);
  }

  function handleSave() {
    saveCustomTheme({ bg: editorBg, text: editorText, accent: editorAccent });
    setEditing(false);
  }

  function handleCancel() {
    setEditing(false);
    // Revert to the theme that was active before editing
    setThemeById(preEditThemeRef.current);
  }

  function handleDelete() {
    deleteCustomTheme();
    setEditing(false);
  }

  return (
    <>
      <h2>Appearance</h2>
      <div className="theme-swatches">
        {PRESET_THEME_IDS.map((id) => {
          const def = THEME_PRESETS[id];
          if (!def) return null;
          const isActive = theme.id === id && !editing;
          return (
            <button
              key={id}
              className={`theme-swatch ${isActive ? 'active' : ''}`}
              onClick={() => { setEditing(false); setThemeById(id); }}
              title={def.name}
            >
              <div
                className="theme-swatch-preview"
                style={{ background: def.backgrounds.primary }}
              >
                <span
                  className="theme-swatch-text"
                  style={{ color: def.text.primary }}
                >
                  Aa
                </span>
                <span
                  className="theme-swatch-accent"
                  style={{ background: def.accent.color }}
                />
              </div>
              <span className="theme-swatch-label">{def.name}</span>
            </button>
          );
        })}

        {/* Saved custom theme swatch */}
        {customColors && customSwatchDef && !editing && (
          <button
            className={`theme-swatch ${theme.id === 'custom' ? 'active' : ''}`}
            onClick={() => setThemeById('custom')}
            title="Custom"
          >
            <div
              className="theme-swatch-preview"
              style={{ background: customSwatchDef.backgrounds.primary }}
            >
              <span
                className="theme-swatch-text"
                style={{ color: customSwatchDef.text.primary }}
              >
                Aa
              </span>
              <span
                className="theme-swatch-accent"
                style={{ background: customSwatchDef.accent.color }}
              />
            </div>
            <span className="theme-swatch-label">Custom</span>
          </button>
        )}
      </div>

      {/* Custom theme editor */}
      {editing ? (
        <div className="custom-theme-editor">
          <div className="custom-theme-pickers">
            <label className="custom-theme-picker">
              <span className="custom-theme-picker-label">Background</span>
              <input
                type="color"
                value={editorBg}
                onChange={(e) => setEditorBg(e.target.value)}
              />
              <span className="custom-theme-picker-value">{editorBg}</span>
            </label>
            <label className="custom-theme-picker">
              <span className="custom-theme-picker-label">Text</span>
              <input
                type="color"
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
              />
              <span className="custom-theme-picker-value">{editorText}</span>
            </label>
            <label className="custom-theme-picker">
              <span className="custom-theme-picker-label">Accent</span>
              <input
                type="color"
                value={editorAccent}
                onChange={(e) => setEditorAccent(e.target.value)}
              />
              <span className="custom-theme-picker-value">{editorAccent}</span>
            </label>
          </div>
          <div className="custom-theme-actions">
            <button className="custom-theme-save" onClick={handleSave}>Save</button>
            <button className="custom-theme-cancel" onClick={handleCancel}>Cancel</button>
            {customColors && (
              <button className="custom-theme-delete" onClick={handleDelete}>Delete</button>
            )}
          </div>
        </div>
      ) : (
        <div className="custom-theme-controls">
          {customColors && theme.id === 'custom' ? (
            <button className="custom-theme-create" onClick={handleEditCustom}>Edit Custom Theme</button>
          ) : (
            <button className="custom-theme-create" onClick={handleCreateCustom}>Create Custom Theme</button>
          )}
        </div>
      )}

      <div className="font-selector">
        <label className="font-selector-label">UI Font</label>
        <div className="font-options">
          {UI_FONTS.map((font) => {
            const isActive = uiFont === font.id;
            return (
              <button
                key={font.id}
                className={`font-option ${isActive ? 'active' : ''}`}
                onClick={() => setUiFont(font.id)}
                style={{ fontFamily: font.family }}
              >
                {font.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
