/** Settings → Notifications: what to be told about, and how. */

import { useState } from 'react';
import { api, invoke, isTauri, openExternal } from '../../api/client';
import { paths } from '../../app/router';
import { invalidate, setData, useQuery } from '../../data/query';
import type { NotificationSettings } from '../../api/types';
import { Button, Spinner, Switch, toast } from '../../ui/components';
import { WarningIcon } from '../../ui/icons';
import { Group, Row } from './form';

const KEY = ['settings', 'notifications'];

export function NotificationsPane() {
  const { data: settings, error, refetch } = useQuery(KEY, api.notificationSettings);
  const permission = useQuery(['settings', 'notification-permission'], api.notificationPermission, {
    staleTime: 0,
  });
  const [requesting, setRequesting] = useState(false);

  if (!settings) {
    return error ? (
      <p className="st-error">
        Couldn't load notification settings.{' '}
        <Button size="sm" variant="ghost" onClick={() => void refetch()}>
          Try again
        </Button>
      </p>
    ) : (
      <div className="st-loading">
        <Spinner />
      </div>
    );
  }

  const set = async (patch: Partial<NotificationSettings>) => {
    const next = { ...settings, ...patch };
    setData(KEY, next);
    try {
      await api.updateNotificationSettings(next);
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`, { tone: 'error' });
      void invalidate(KEY);
    }
  };

  const request = async () => {
    setRequesting(true);
    try {
      const granted = await api.requestNotificationPermission();
      if (!granted) toast('Notifications are off for Ultra GitLab. Turn them on in System Settings → Notifications.');
    } catch {
      toast('Turn on notifications for Ultra GitLab in System Settings → Notifications.');
    } finally {
      setRequesting(false);
      void invalidate(['settings', 'notification-permission']);
    }
  };

  const openSystemSettings = () =>
    openExternal('x-apple.systempreferences:com.apple.Notifications-Settings.extension').catch(() =>
      toast('Open System Settings → Notifications → Ultra GitLab.'),
    );

  const test = () => {
    const title = 'Ready to merge';
    const body = 'This is what a notification from Ultra GitLab looks like.';
    toast(`${title} — ${body}`, { tone: 'success' });
    if (isTauri && settings.nativeNotificationsEnabled) {
      invoke('send_native_notification', { title, body, route: paths.inbox('mine') }).catch((e: Error) =>
        toast(`macOS didn't accept the notification: ${e.message}`, { tone: 'error' }),
      );
    }
  };

  const perm = permission.data;
  const blocked = settings.nativeNotificationsEnabled && (perm === 'denied' || perm === 'not_determined');

  return (
    <>
      {blocked && (
        <div className="st-banner" role="status">
          <WarningIcon size={16} />
          <div className="st-banner__text">
            <strong>{perm === 'denied' ? 'macOS is blocking notifications' : 'Notifications need your permission'}</strong>
            <span>
              {perm === 'denied'
                ? 'Allow Ultra GitLab in System Settings → Notifications to see alerts outside the app.'
                : 'Allow Ultra GitLab to show alerts in Notification Center.'}
            </span>
          </div>
          {perm === 'denied' ? (
            <Button size="sm" onClick={() => void openSystemSettings()}>
              Open System Settings
            </Button>
          ) : (
            <Button size="sm" variant="primary" busy={requesting} onClick={() => void request()}>
              Allow notifications…
            </Button>
          )}
        </div>
      )}

      <Group title="Tell me when">
        <Row label="My merge request is ready to merge" description="It has the approvals it needs and its pipeline passed.">
          <Switch
            label="My merge request is ready to merge"
            checked={settings.mrReadyToMerge}
            onChange={(v) => void set({ mrReadyToMerge: v })}
          />
        </Row>
        <Row label="A pinned project's pipeline changes status" description="Pin projects on the Pipelines screen.">
          <Switch
            label="A pinned project's pipeline changes status"
            checked={settings.pipelineStatusPinned}
            onChange={(v) => void set({ pipelineStatusPinned: v })}
          />
        </Row>
      </Group>

      <Group
        title="Delivery"
        footer="Jobs you armed to auto-run always tell you how it went."
      >
        <Row
          label="Show macOS notifications"
          description="Otherwise you only see banners inside Ultra GitLab while it's open."
        >
          <Switch
            label="Show macOS notifications"
            checked={settings.nativeNotificationsEnabled}
            onChange={(v) => void set({ nativeNotificationsEnabled: v })}
          />
        </Row>
        <Row label="Try it out">
          <Button size="sm" onClick={test}>
            Send test notification
          </Button>
        </Row>
      </Group>
    </>
  );
}
