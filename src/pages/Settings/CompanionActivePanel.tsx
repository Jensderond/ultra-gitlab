import type { CompanionServerSettings } from '../../types';
import CompanionDeviceList from './CompanionDeviceList';

interface CompanionActivePanelProps {
  settings: CompanionServerSettings;
  qrSvg: string | null;
  saving: boolean;
  onRegeneratePin: () => void;
  onRevokeDevice: (deviceId: string) => void;
}

/**
 * Content shown when the companion server is enabled: QR code, PIN, and device list.
 */
export default function CompanionActivePanel({ settings, qrSvg, saving, onRegeneratePin, onRevokeDevice }: CompanionActivePanelProps) {
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
        <label className="companion-pin-label">PIN Code</label>
        <div className="companion-pin-display">
          <code className="companion-pin-value">{settings.pin}</code>
          <button
            className="companion-pin-regenerate"
            onClick={onRegeneratePin}
            disabled={saving}
          >
            Regenerate
          </button>
        </div>
        <span className="companion-pin-hint">Devices must enter this PIN to connect</span>
      </div>

      <CompanionDeviceList
        devices={settings.authorizedDevices}
        saving={saving}
        onRevoke={onRevokeDevice}
      />
    </>
  );
}
