import { useState, useEffect } from 'react';
import { downloadAndInstallCli, cliStatus } from '../../services/tauri';
import type { CliStatus as CliStatusType } from '../../types';
import { useToast } from '../../components/Toast';

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
    <section className="settings-section">
      <h2>Command Line</h2>
      <p className="settings-section-description">
        Install the <code>ultra</code> terminal client to <code>~/.local/bin</code> so you can
        review MRs from your shell.
      </p>

      {status && (
        <div className="update-version-row">
          {status.installed ? (
            <>
              <span className="update-current-version">
                Installed at: <strong>{status.path}</strong>
              </span>
              <span className="update-up-to-date" style={{ display: 'inline' }}>
                If <code>ultra</code> isn't found in your shell, make sure{' '}
                <code>{status.path.replace(/\/ultra$/, '')}</code> is on your <code>$PATH</code>.
              </span>
            </>
          ) : (
            <span className="update-up-to-date">Not installed</span>
          )}
        </div>
      )}

      <button
        className="update-install-button"
        onClick={handleInstall}
        disabled={installing}
      >
        {installing ? 'Installing…' : 'Download & install CLI to PATH'}
      </button>
    </section>
  );
}
