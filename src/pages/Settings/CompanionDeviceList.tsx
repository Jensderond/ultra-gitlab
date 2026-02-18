import type { CompanionServerSettings } from '../../types';

interface CompanionDeviceListProps {
  devices: CompanionServerSettings['authorizedDevices'];
  saving: boolean;
  onRevoke: (deviceId: string) => void;
}

function formatDeviceTime(isoStr: string): string {
  try {
    const date = new Date(isoStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

/**
 * Authorized devices sub-list for the companion server section.
 */
export default function CompanionDeviceList({ devices, saving, onRevoke }: CompanionDeviceListProps) {
  return (
    <div className="companion-devices">
      <label className="companion-devices-label">
        Authorized Devices
        {devices.length > 0 && (
          <span className="companion-devices-count">{devices.length}</span>
        )}
      </label>
      {devices.length === 0 ? (
        <p className="companion-devices-empty">No devices connected yet</p>
      ) : (
        <ul className="companion-device-list">
          {devices.map((device) => (
            <li key={device.id} className="companion-device-item">
              <div className="companion-device-info">
                <span className="companion-device-name">{device.name}</span>
                <span className="companion-device-meta">
                  Last active: {formatDeviceTime(device.lastActive)}
                </span>
              </div>
              <button
                className="companion-device-revoke"
                onClick={() => onRevoke(device.id)}
                disabled={saving}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
