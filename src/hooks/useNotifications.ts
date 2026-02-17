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
}

interface PipelineChangedPayload {
  projectName: string;
  oldStatus: string;
  newStatus: string;
  refName: string;
  webUrl: string;
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
    let unlistenMrReady: (() => void) | undefined;

    // Listen for Tauri event: notification:mr-ready (only fires in Tauri)
    tauriListen<MrReadyPayload>('notification:mr-ready', async (event) => {
      try {
        const settings = await getNotificationSettings();
        if (!settings.mrReadyToMerge) return;

        const { title, projectName, webUrl } = event.payload;

        addToastRef.current({
          type: 'mr-ready',
          title: 'MR Ready to Merge',
          body: `${title} in ${projectName}`,
          url: webUrl,
        });

        if (isTauri && settings.nativeNotificationsEnabled) {
          sendNativeNotification(
            'MR Ready to Merge',
            `${title} in ${projectName}`
          ).catch(console.error);
        }
      } catch (err) {
        console.error('Failed to handle MR ready notification:', err);
      }
    }).then((fn) => {
      unlistenMrReady = fn;
    });

    // Listen for DOM event: notification:pipeline-changed
    function handlePipelineChanged(e: Event) {
      const detail = (e as CustomEvent<PipelineChangedPayload>).detail;

      getNotificationSettings()
        .then((settings) => {
          if (!settings.pipelineStatusPinned) return;

          const { projectName, newStatus, refName, webUrl } = detail;
          const statusTitle = `Pipeline ${capitalize(newStatus)}`;

          addToastRef.current({
            type: pipelineToastType(newStatus),
            title: statusTitle,
            body: `${projectName} (${refName})`,
            url: webUrl,
          });

          if (isTauri && settings.nativeNotificationsEnabled) {
            sendNativeNotification(
              statusTitle,
              `${projectName} (${refName})`
            ).catch(console.error);
          }
        })
        .catch((err) => {
          console.error('Failed to handle pipeline notification:', err);
        });
    }

    window.addEventListener('notification:pipeline-changed', handlePipelineChanged);

    return () => {
      if (unlistenMrReady) unlistenMrReady();
      window.removeEventListener('notification:pipeline-changed', handlePipelineChanged);
    };
  }, []);
}
