/** Settings → General: background sync, what the My MRs list includes, updates and the UI beta. */

import { useState } from 'react';
import { api } from '../../api/client';
import { useSettings } from '../../data/hooks';
import { invalidate, setData, useQuery } from '../../data/query';
import type { Settings } from '../../api/types';
import { ago } from '../../lib/format';
import { Button, Spinner, Switch, toast } from '../../ui/components';
import { switchUiVariant } from '../../../uiVariant';
import { UpdatesGroup } from '../updates/UpdatesGroup';
import { Group, Row, Select } from './form';

const INTERVALS = [
  { value: 60, label: 'Every minute' },
  { value: 120, label: 'Every 2 minutes' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 600, label: 'Every 10 minutes' },
  { value: 900, label: 'Every 15 minutes' },
  { value: 1800, label: 'Every 30 minutes' },
];

/** Optimistically change settings, then persist; roll back on failure. */
export async function updateSettings(patch: Partial<Settings>, alsoInvalidate: unknown[][] = []) {
  setData<Settings | undefined>(['settings'], (prev) => (prev ? { ...prev, ...patch } : prev));
  try {
    await api.updateSettings(patch);
    alsoInvalidate.forEach((k) => void invalidate(k));
  } catch (e) {
    toast(`Couldn't save the setting: ${(e as Error).message}`, { tone: 'error' });
  }
  await invalidate(['settings']);
}

export function GeneralPane() {
  const { data: settings, error, refetch } = useSettings();
  const status = useQuery(['sync-status'], api.syncStatus, { refetchInterval: 15_000, staleTime: 5_000 });
  const [syncing, setSyncing] = useState(false);

  if (!settings) {
    return error ? (
      <p className="st-error">
        Couldn't load settings. <Button size="sm" variant="ghost" onClick={() => void refetch()}>Try again</Button>
      </p>
    ) : (
      <div className="st-loading">
        <Spinner />
      </div>
    );
  }

  const interval = settings.sync?.interval_secs ?? 300;
  const intervals = INTERVALS.some((o) => o.value === interval)
    ? INTERVALS
    : [...INTERVALS, { value: interval, label: `Every ${Math.round(interval / 60)} minutes` }].sort((a, b) => a.value - b.value);

  const changeInterval = async (secs: number) => {
    const sync = { ...settings.sync, interval_secs: secs };
    setData<Settings | undefined>(['settings'], (prev) => (prev ? { ...prev, sync } : prev));
    try {
      await api.updateSyncSettings(sync);
    } catch (e) {
      toast(`Couldn't change the sync interval: ${(e as Error).message}`, { tone: 'error' });
    }
    void invalidate(['settings']);
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await api.triggerSync(false);
      await invalidate();
    } catch (e) {
      toast(`Sync failed: ${(e as Error).message}`, { tone: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  const last = status.data?.lastSyncTime;
  const failed = status.data?.failedActions ?? 0;

  return (
    <>
      <Group title="Sync">
        <Row
          label="Check GitLab for changes"
          description="Ultra GitLab keeps a local copy and refreshes it in the background."
          htmlFor="st-interval"
        >
          <Select id="st-interval" value={interval} onChange={(e) => void changeInterval(Number(e.target.value))}>
            {intervals.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row
          label="Last synced"
          description={
            <>
              {status.data?.isSyncing || syncing ? 'Syncing now…' : last ? ago(last) : 'Not yet'}
              {failed > 0 && <span className="st-warn-text"> · {failed} change{failed === 1 ? '' : 's'} failed to sync</span>}
            </>
          }
        >
          <Button size="sm" busy={syncing} onClick={() => void syncNow()} shortcut="mod+r">
            Sync now
          </Button>
        </Row>
      </Group>

      <Group title="My merge requests">
        <Row label="Show drafts" description="Include merge requests you haven't marked ready yet.">
          <Switch
            label="Show drafts"
            checked={settings.showDraftMrs}
            onChange={(v) => void updateSettings({ showDraftMrs: v }, [['mrs']])}
          />
        </Row>
        <Row label="Show recently merged" description="Keep merge requests merged in the last 24 hours in the list.">
          <Switch
            label="Show recently merged"
            checked={settings.showRecentlyMergedMrs}
            onChange={(v) => void updateSettings({ showRecentlyMergedMrs: v }, [['mrs']])}
          />
        </Row>
      </Group>

      <UpdatesGroup />

      <Group title="Interface">
        <Row
          label="Native UI (beta)"
          description="You're trying the new native interface. Your accounts and settings stay the same if you switch back."
        >
          <Button size="sm" onClick={() => void switchUiVariant('classic')}>
            Switch to classic UI
          </Button>
        </Row>
      </Group>

      <p className="st-footnote">
        Ultra GitLab follows your Mac's appearance and text settings. Change them in System Settings → Appearance.
      </p>
    </>
  );
}
