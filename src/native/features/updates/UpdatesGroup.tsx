/** Settings → General → Updates: the running version and a manual check. */

import { isTauri } from '../../api/client';
import { useQuery } from '../../data/query';
import { ago } from '../../lib/format';
import { Button, toast } from '../../ui/components';
import { Group, Row } from '../settings/form';
import { checkForUpdate, getUpdateState, installUpdate, retryUpdate, useUpdateState } from './updater';

async function appVersion(): Promise<string> {
  if (!isTauri) return 'browser';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

export function UpdatesGroup() {
  const { data: current } = useQuery(['app-version'], appVersion, { staleTime: Infinity });
  const { phase, version, progress, error, lastChecked } = useUpdateState();

  const check = async () => {
    const found = await checkForUpdate({ manual: true });
    // A failed check shows its error in the row instead.
    if (!found && getUpdateState().phase === 'idle') toast("You're on the latest version.");
  };

  const status = (() => {
    switch (phase) {
      case 'checking':
        return 'Checking for updates…';
      case 'downloading':
        return `Downloading ${version}${progress === null ? '' : ` · ${Math.round(progress * 100)}%`}`;
      case 'ready':
        return `${version} is ready to install.`;
      case 'installing':
        return `Installing ${version}…`;
      case 'error':
        return <span className="st-warn-text">{error}</span>;
      default:
        return lastChecked ? `Up to date · checked ${ago(lastChecked)}` : 'Updates download automatically.';
    }
  })();

  const action = (() => {
    if (phase === 'ready' || phase === 'installing') {
      return (
        <Button size="sm" variant="primary" busy={phase === 'installing'} onClick={() => void installUpdate()}>
          Restart to update
        </Button>
      );
    }
    if (phase === 'error') {
      return (
        <Button size="sm" onClick={retryUpdate}>
          Try again
        </Button>
      );
    }
    return (
      <Button size="sm" busy={phase === 'checking' || phase === 'downloading'} disabled={!isTauri} onClick={() => void check()}>
        Check for updates
      </Button>
    );
  })();

  return (
    <Group title="Updates" footer="New versions download in the background; restart from the sidebar when it turns green.">
      <Row label={current ? `Ultra GitLab ${current}` : 'Ultra GitLab'} description={status}>
        {action}
      </Row>
    </Group>
  );
}
