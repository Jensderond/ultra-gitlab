import { useState } from 'react';
import { switchUiVariant } from '../../uiVariant';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

/**
 * Opt-in to the native UI beta. Both UIs ship in this build; switching
 * stores the choice and restarts the app into the other one. Accounts,
 * settings and the local cache are shared, and the native UI has a button
 * to switch back.
 */
export default function NativeUiSection() {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tryNative = async () => {
    setSwitching(true);
    setError(null);
    try {
      await switchUiVariant('native');
    } catch (e) {
      setSwitching(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsGroup footer="Your accounts, settings and cached merge requests carry over. You can switch back from Settings → General at any time.">
      <SettingsRow
        label="Try the native UI"
        description="A new interface built to look and feel like a Mac app: faster review, a unified toolbar and automatic updates. The app restarts to switch."
      >
        <button className="update-install-button" onClick={() => void tryNative()} disabled={switching}>
          {switching ? 'Restarting…' : 'Switch to native UI'}
        </button>
      </SettingsRow>
      {error && (
        <SettingsRow vertical>
          <div className="update-error">Couldn't switch: {error}</div>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}
