/**
 * Hook that wires notification events (Tauri + DOM) to in-app toasts
 * and native OS notifications, respecting user settings.
 */

import { useEffect, useRef } from 'react';
import { useToast } from '../components/Toast';
import { isTauri, tauriListen, getNotificationSettings, sendNativeNotification } from '../services';

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

function pipelineToastType(status: string): 'pipeline-success' | 'pipeline-failed' | 'pipeline-running' {
  if (status === 'success') return 'pipeline-success';
  if (status === 'failed') return 'pipeline-failed';
  return 'pipeline-running';
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function useNotifications() {
  const { addToast } = useToast();
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  useEffect(() => {
    let cancelled = false;

    const mrReadyPromise = tauriListen<MrReadyPayload>('notification:mr-ready', async (event) => {
      if (cancelled) return;
      try {
        const settings = await getNotificationSettings();
        if (!settings.mrReadyToMerge) return;

        const { title, projectName, webUrl, mrId } = event.payload;
        const route = `/my-mrs/${mrId}`;

        addToastRef.current({
          type: 'mr-ready',
          title: 'MR Ready to Merge',
          body: `${title} in ${projectName}`,
          url: webUrl,
          route,
        });

        if (isTauri && settings.nativeNotificationsEnabled) {
          sendNativeNotification(
            'MR Ready to Merge',
            `${title} in ${projectName}`,
            route
          ).catch(console.error);
        }
      } catch (err) {
        console.error('Failed to handle MR ready notification:', err);
      }
    });

    const pipelinePromise = tauriListen<PipelineChangedPayload>('notification:pipeline-changed', async (event) => {
      if (cancelled) return;
      try {
        const settings = await getNotificationSettings();
        if (!settings.pipelineStatusPinned) return;

        const { projectName, newStatus, refName, webUrl, instanceId, projectId, pipelineId } = event.payload;
        const statusTitle = `Pipeline ${capitalize(newStatus)}`;
        const params = new URLSearchParams({
          instance: String(instanceId),
          project: projectName,
          ref: refName,
          url: webUrl,
        });
        const route = `/pipelines/${projectId}/${pipelineId}?${params.toString()}`;

        addToastRef.current({
          type: pipelineToastType(newStatus),
          title: statusTitle,
          body: `${projectName} (${refName})`,
          url: webUrl,
          route,
        });

        if (isTauri && settings.nativeNotificationsEnabled) {
          sendNativeNotification(
            statusTitle,
            `${projectName} (${refName})`,
            route
          ).catch(console.error);
        }
      } catch (err) {
        console.error('Failed to handle pipeline notification:', err);
      }
    });

    const autoRunPromise = tauriListen<AutoRunPayload>('notification:auto-run', async (event) => {
      if (cancelled) return;
      try {
        const { played, jobName, refName, projectName, webUrl, instanceId, projectId, pipelineId } = event.payload;
        const title = played ? 'Manual Job Started' : 'Auto-run Cancelled';
        const refSuffix = refName ? ` (${refName})` : '';
        const body = played
          ? `${jobName}${refSuffix} in ${projectName}`
          : `${jobName}${refSuffix} in ${projectName} — pipeline did not succeed`;
        const params = new URLSearchParams({
          instance: String(instanceId),
          project: projectName,
          ref: refName ?? '',
          url: webUrl ?? '',
        });
        const route = `/pipelines/${projectId}/${pipelineId}?${params.toString()}`;

        addToastRef.current({
          type: played ? 'pipeline-running' : 'pipeline-failed',
          title,
          body,
          url: webUrl ?? undefined,
          route,
        });

        // No settings gate for the toast: the user explicitly armed this
        // job, so the outcome is always worth surfacing. Native OS
        // notifications still respect the global toggle.
        const settings = await getNotificationSettings();
        if (isTauri && settings.nativeNotificationsEnabled) {
          sendNativeNotification(title, body, route).catch(console.error);
        }
      } catch (err) {
        console.error('Failed to handle auto-run notification:', err);
      }
    });

    return () => {
      cancelled = true;
      mrReadyPromise.then((unlisten) => unlisten());
      pipelinePromise.then((unlisten) => unlisten());
      autoRunPromise.then((unlisten) => unlisten());
    };
  }, []);
}
