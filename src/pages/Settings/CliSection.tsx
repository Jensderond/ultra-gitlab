import { useState, useEffect } from 'react';
import { downloadAndInstallCli, cliStatus } from '../../services/tauri';
import type { CliStatus as CliStatusType } from '../../types';
import { useToast } from '../../components/Toast';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

/**
 * CLI install section — lets users download the `ultra` terminal client
 * to ~/.local/bin so it can be invoked from any shell.
 */
export default function CliSection() {
  const { addToast } = useToast();
  const [status, setStatus] = useState<CliStatusType | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    cliStatus().then(setStatus).catch(() => {});
  }, []);

  async function handleInstall() {
    try {
      setInstalling(true);
      const result = await downloadAndInstallCli();
      setStatus({ installed: true, path: result.path });
      addToast({ type: 'info', title: 'CLI Installed', body: result.message });
    } catch (err) {
      addToast({
        type: 'info',
        title: 'CLI Install Failed',
        body: err instanceof Error ? err.message : 'Failed to install CLI',
      });
    } finally {
      setInstalling(false);
    }
  }

  return (
    <SettingsGroup
      footer={
        status?.installed ? (
          <>
            If <code>ultra</code> isn't found in your shell, make sure{' '}
            <code>{status.path.replace(/\/ultra$/, '')}</code> is on your <code>$PATH</code>.
          </>
        ) : (
          <>
            Install the <code>ultra</code> terminal client to <code>~/.local/bin</code> so you can
            review MRs from your shell.
          </>
        )
      }
    >
      <SettingsRow
        label="Terminal client"
        description={
          status
            ? status.installed
              ? `Installed at ${status.path}`
              : 'Not installed'
            : 'Checking…'
        }
      >
        <button
          className="update-check-button"
          onClick={handleInstall}
          disabled={installing}
        >
          {installing ? 'Installing…' : status?.installed ? 'Reinstall' : 'Install'}
        </button>
      </SettingsRow>
    </SettingsGroup>
  );
}
