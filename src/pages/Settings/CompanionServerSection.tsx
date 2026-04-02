import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getCompanionQrSvg, updateCompanionSettings, regenerateCompanionPin, setCompanionPin, revokeCompanionDevice, startCompanionServer, stopCompanionServer } from '../../services/tauri';
import type { CompanionServerSettings } from '../../types';
import { useToast } from '../../components/Toast';
import { useCompanionSettingsQuery } from '../../hooks/queries/useCompanionSettingsQuery';
import { queryKeys } from '../../lib/queryKeys';
import CompanionActivePanel from './CompanionActivePanel';

/**
 * Companion server settings section.
 * Allows enabling/disabling the embedded HTTP server for mobile access.
 */
export default function CompanionServerSection() {
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useCompanionSettingsQuery();

  const [saving, setSaving] = useState(false);
  const [portInput, setPortInput] = useState('');
  const [portError, setPortError] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  const settings = settingsQuery.data ?? null;

  const refreshQrSvg = useCallback((s: CompanionServerSettings) => {
    if (s.enabled && s.port) {
      getCompanionQrSvg().then(setQrSvg).catch(() => setQrSvg(null));
    } else {
      setQrSvg(null);
    }
  }, []);

  // Sync port input and QR when query data changes
  useEffect(() => {
    if (!settings) return;
    refreshQrSvg(settings);
    setPortInput((prev) => {
      const currentPort = String(settings.port);
      return prev === '' || prev === currentPort ? currentPort : prev;
    });
  }, [settings, refreshQrSvg]);

  const invalidateSettings = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.companionSettings() });
  }, [queryClient]);

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
      invalidateSettings();
      queryClient.invalidateQueries({ queryKey: queryKeys.companionStatus() });
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
      invalidateSettings();
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
      await regenerateCompanionPin();
      invalidateSettings();
      addToast({ type: 'info', title: 'PIN Regenerated', body: 'All devices have been disconnected' });
    } catch (err) {
      console.error('Failed to regenerate PIN:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetPin(pin: string) {
    try {
      setSaving(true);
      await setCompanionPin(pin);
      invalidateSettings();
      addToast({ type: 'info', title: 'PIN Updated', body: 'All devices have been disconnected' });
    } catch (err) {
      console.error('Failed to set PIN:', err);
      addToast({ type: 'info', title: 'Error', body: err instanceof Error ? err.message : 'PIN must be 4–8 digits' });
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeDevice(deviceId: string) {
    try {
      setSaving(true);
      await revokeCompanionDevice(deviceId);
      invalidateSettings();
    } catch (err) {
      console.error('Failed to revoke device:', err);
    } finally {
      setSaving(false);
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <>
        <p className="loading">Loading settings...</p>
      </>
    );
  }

  if (!settings) {
    return (
      <>
        <p className="error-message">Failed to load companion settings</p>
      </>
    );
  }

  return (
    <>
      <p className="companion-description">
        Access MR reviews from your phone. Enable the companion server to serve the review UI on your local network.
      </p>

      <div className="companion-settings-form">
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

        {settings.enabled && (
          <CompanionActivePanel
            settings={settings}
            qrSvg={qrSvg}
            saving={saving}
            onRegeneratePin={handleRegeneratePin}
            onSetPin={handleSetPin}
            onRevokeDevice={handleRevokeDevice}
          />
        )}
      </div>

      {saving && <p className="saving-indicator">Saving...</p>}
    </>
  );
}
