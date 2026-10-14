/**
 * App-wide background services. Call `useAppServices()` once (App does) and
 * mount `<AppServicesHost />` once for the UI they need (the re-auth sheet).
 *
 *  - `notification:mr-ready` / `notification:pipeline-changed` /
 *    `notification:auto-run` → in-app toast + native macOS notification,
 *    gated by the notification settings exactly like before:
 *      mr-ready needs `mrReadyToMerge`, pipeline-changed needs
 *      `pipelineStatusPinned`, auto-run always toasts; the native
 *      notification additionally needs `nativeNotificationsEnabled`.
 *  - `notification:clicked` → navigate (old-style routes are mapped).
 *  - `auth-expired` → "Your GitLab session expired" sheet with a token field.
 *  - `ultra-gitlab://open?url=…` deep links → open the MR / pipeline.
 */

import { useEffect } from 'react';
import { api, invoke, isTauri } from '../../api/client';
import { listen } from '../../api/events';
import { navigate, paths } from '../../app/router';
import type { NotificationSettings } from '../../api/types';
import { toast } from '../../ui/components';
import { openGitLabLink } from '../palette/jump';
import { parseDeepLink } from '../palette/rank';
import { reportAuthExpired } from './authStore';

export { AppServicesHost } from './AppServicesHost';

interface MrReadyPayload {
  title: string;
  projectName: string;
  webUrl: string;
  mrId: number;
}

interface PipelineChangedPayload {
  projectName: string;
  oldStatus: string;
  newStatus: string;
  refName: string;
  webUrl: string;
  instanceId: number;
  projectId: number;
  pipelineId: number;
}

interface AutoRunPayload {
  played: boolean;
  jobName: string;
  refName: string | null;
  projectName: string;
  webUrl: string | null;
  instanceId: number;
  projectId: number;
  pipelineId: number;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Map a notification route to a current path. Routes we send are already
 * current; older builds (and notifications still in Notification Center)
 * used `/mrs/:id`, `/my-mrs/:id` and `/pipelines/:projectId/:pipelineId?instance=`.
 */
export function mapRoute(route: string): string {
  let url: URL;
  try {
    url = new URL(route, 'http://app');
  } catch {
    return paths.inbox();
  }
  const s = url.pathname.split('/').filter(Boolean);
  const num = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  if (s[0] === 'mrs') return num(s[1]) ? paths.review(num(s[1])!) : paths.inbox();
  if (s[0] === 'my-mrs') return paths.inbox('mine', num(s[1]));
  if (s[0] === 'pipelines' && s.length === 3) {
    const instance = num(url.searchParams.get('instance') ?? undefined);
    const [projectId, pipelineId] = [num(s[1]), num(s[2])];
    if (instance && projectId && pipelineId) return paths.pipeline(instance, projectId, pipelineId);
    return paths.pipelines(projectId);
  }
  return url.pathname + url.search;
}

async function notify(
  gate: keyof NotificationSettings | null,
  title: string,
  body: string,
  route: string,
  tone: 'info' | 'error' | 'success' = 'info',
) {
  let settings: NotificationSettings;
  try {
    settings = await api.notificationSettings();
  } catch (e) {
    console.error('Failed to read notification settings:', e);
    return;
  }
  if (gate && !settings[gate]) return;
  toast(`${title} — ${body}`, {
    tone,
    action: { label: 'Show', run: () => navigate(route) },
    duration: 6000,
  });
  if (isTauri && settings.nativeNotificationsEnabled) {
    invoke('send_native_notification', { title, body, route }).catch(console.error);
  }
}

let deepLinksStarted = false;
const handledUrls = new Set<string>();

/** `live`: a fresh click (always handled); otherwise only URLs not seen yet (get_current repeats the cold-start URL). */
async function handleDeepLinks(urls: string[] | null | undefined, live = false) {
  for (const url of urls ?? []) {
    if (handledUrls.has(url) && !live) continue;
    handledUrls.add(url);
    const link = parseDeepLink(url);
    if (!link) continue;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
    } catch {
      /* not fatal */
    }
    await openGitLabLink(link);
  }
}

/** Register background listeners. Call once, near the root. */
export function useAppServices(): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Promise<() => void>[] = [];
    const on = <T>(event: string, handler: (payload: T) => void) =>
      unlisteners.push(listen<T>(event, (p) => !cancelled && handler(p)));

    on<{ route: string }>('notification:clicked', ({ route }) => navigate(mapRoute(route)));

    on<MrReadyPayload>('notification:mr-ready', ({ title, projectName, mrId }) => {
      void notify('mrReadyToMerge', 'Ready to merge', `${title} in ${projectName}`, paths.inbox('mine', mrId), 'success');
    });

    on<PipelineChangedPayload>('notification:pipeline-changed', (p) => {
      void notify(
        'pipelineStatusPinned',
        `Pipeline ${capitalize(p.newStatus)}`,
        `${p.projectName} (${p.refName})`,
        paths.pipeline(p.instanceId, p.projectId, p.pipelineId),
        p.newStatus === 'failed' ? 'error' : p.newStatus === 'success' ? 'success' : 'info',
      );
    });

    on<AutoRunPayload>('notification:auto-run', (p) => {
      const ref = p.refName ? ` (${p.refName})` : '';
      // No settings gate: the user explicitly armed this job, so the outcome is
      // always worth surfacing. The native notification still needs the toggle.
      void notify(
        null,
        p.played ? 'Manual job started' : 'Auto-run cancelled',
        p.played
          ? `${p.jobName}${ref} in ${p.projectName}`
          : `${p.jobName}${ref} in ${p.projectName} — the pipeline didn't succeed`,
        paths.pipeline(p.instanceId, p.projectId, p.pipelineId),
        p.played ? 'info' : 'error',
      );
    });

    // The backend sends snake_case here (no serde rename); accept both.
    on<Record<string, unknown>>('auth-expired', (p) => {
      const instanceId = Number(p.instance_id ?? p.instanceId);
      const instanceUrl = String(p.instance_url ?? p.instanceUrl ?? '');
      if (!instanceId) return;
      reportAuthExpired({ instanceId, instanceUrl, message: String(p.message ?? '') });
    });

    // Deep links: live ones arrive as an event; the cold-start URL (and URLs
    // that arrived while the window was hidden) are fetched explicitly.
    on<string[]>('deep-link://new-url', (urls) => void handleDeepLinks(urls, true));
    const checkPending = () => {
      if (!isTauri) return;
      invoke<string[] | null>('plugin:deep-link|get_current')
        .then((urls) => handleDeepLinks(urls))
        .catch(() => {});
    };
    if (!deepLinksStarted) {
      deepLinksStarted = true;
      checkPending();
    }
    window.addEventListener('focus', checkPending);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', checkPending);
      unlisteners.forEach((u) => void u.then((fn) => fn()));
    };
  }, []);
}
