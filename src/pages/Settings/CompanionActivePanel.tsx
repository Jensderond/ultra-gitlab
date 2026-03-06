import { useState } from 'react';
import type { CompanionServerSettings } from '../../types';
import CompanionDeviceList from './CompanionDeviceList';

interface CompanionActivePanelProps {
  settings: CompanionServerSettings;
  qrSvg: string | null;
  saving: boolean;
  onRegeneratePin: () => void;
  onSetPin: (pin: string) => void;
  onRevokeDevice: (deviceId: string) => void;
}

/**
 * Content shown when the companion server is enabled: QR code, PIN, and device list.
 */
export default function CompanionActivePanel({ settings, qrSvg, saving, onRegeneratePin, onSetPin, onRevokeDevice }: CompanionActivePanelProps) {
  const [editing, setEditing] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  function startEditing() {
    setPinInput(settings.pin);
    setPinError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setPinError(null);
  }

  function commitPin() {
    const trimmed = pinInput.trim();
    if (trimmed.length < 4 || trimmed.length > 8 || !/^\d+$/.test(trimmed)) {
      setPinError('PIN must be 4–8 digits');
      return;
    }
    if (trimmed === settings.pin) {
      setEditing(false);
      return;
    }
    setEditing(false);
    onSetPin(trimmed);
  }

  return (
    <>
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

      <div className="companion-pin-row">
        <span className="companion-pin-label">PIN Code</span>
        <div className="companion-pin-display">
          {editing ? (
            <>
              <input
                className="companion-pin-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pinInput}
                onChange={(e) => { setPinInput(e.target.value); setPinError(null); }}
                onBlur={commitPin}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') cancelEditing();
                }}
                autoFocus
                minLength={4}
                maxLength={8}
                disabled={saving}
              />
              {pinError && <span className="companion-pin-error">{pinError}</span>}
            </>
          ) : (
            <>
              <code className="companion-pin-value" onClick={startEditing} title="Click to edit">{settings.pin}</code>
              <button
                className="companion-pin-regenerate"
                onClick={onRegeneratePin}
                disabled={saving}
              >
                Regenerate
              </button>
            </>
          )}
        </div>
        <span className="companion-pin-hint">
          {editing ? 'Enter 4–8 digits, press Enter to save' : 'Click PIN to set your own, or Regenerate for a random one'}
        </span>
      </div>

      <CompanionDeviceList
        devices={settings.authorizedDevices}
        saving={saving}
        onRevoke={onRevokeDevice}
      />
    </>
  );
}
