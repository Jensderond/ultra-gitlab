/**
 * Settings page component.
 *
 * Displays GitLab instance management and application settings.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import InstanceSetup from '../components/InstanceSetup/InstanceSetup';
import {
  listInstances,
  removeInstance,
  type GitLabInstanceWithStatus,
} from '../services/gitlab';
import { formatRelativeTime } from '../services/storage';
import { invoke, updateInstanceToken } from '../services/tauri';
import useCustomShortcuts from '../hooks/useCustomShortcuts';
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

/**
 * Settings page for managing GitLab instances.
 */
export default function Settings() {
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

        <section className="settings-section">
          <ShortcutEditor />
        </section>
      </main>
    </div>
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
