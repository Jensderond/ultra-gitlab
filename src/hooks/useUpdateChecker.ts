/**
 * Hook for checking and installing app updates.
 *
 * Checks for updates on mount and every hour using the
 * Tauri updater plugin. Provides state for UI indicators
 * (update popup, sidebar badge, settings section) and actions to install.
 *
 * A found update opens the popup (UpdatePrompt). "Later" hides it for an
 * hour, then it comes back. It never opens over someone typing: it waits
 * until focus leaves the field.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { isTauri, isIOS } from '../services/transport';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
/** How long "Later" keeps the update popup away. */
const SNOOZE_MS = 60 * 60 * 1000;

const isTyping = () => {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'));
};

export interface UpdateCheckerState {
  /** Whether an update is available */
  available: boolean;
  /** Whether a check is in progress */
  checking: boolean;
  /** Version string of available update */
  version: string | null;
  /** Release notes / changelog body */
  body: string | null;
  /** Download + install progress (0-100) */
  downloadProgress: number | null;
  /** Whether we're currently installing */
  installing: boolean;
  /** Error message if check or install failed */
  error: string | null;
  /** Check for updates manually */
  checkForUpdate: () => Promise<void>;
  /** Download, install, and relaunch */
  installUpdate: () => Promise<void>;
  /** Dismiss the update notification */
  dismissUpdate: () => void;
  /** Whether the update popup is showing */
  promptOpen: boolean;
  /** Hide the update popup and bring it back in an hour */
  snoozeUpdate: () => void;
}

export default function useUpdateChecker(): UpdateCheckerState {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateRef = useRef<any>(null);

  const [promptOpen, setPromptOpen] = useState(false);
  const snoozeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Set while the popup is snoozed or waiting for a field to lose focus. */
  const promptHeld = useRef(false);

  // Open the popup, or wait for the field in use to lose focus first.
  // iOS updates through the App Store / TestFlight, so it never prompts.
  const raisePrompt = useCallback(() => {
    if (isIOS || !updateRef.current) return;
    if (isTyping()) {
      promptHeld.current = true;
      // focusout fires before focus lands on the next element; look again after it has.
      document.addEventListener('focusout', () => setTimeout(raisePrompt), { once: true });
      return;
    }
    promptHeld.current = false;
    setPromptOpen(true);
  }, []);

  const snoozeUpdate = useCallback(() => {
    setPromptOpen(false);
    promptHeld.current = true;
    clearTimeout(snoozeTimer.current);
    snoozeTimer.current = setTimeout(raisePrompt, SNOOZE_MS);
  }, [raisePrompt]);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri) return;
    try {
      setChecking(true);
      setError(null);
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        updateRef.current = update;
        setAvailable(true);
        setVersion(update.version);
        setBody(update.body ?? null);
        // A re-check while snoozed (or waiting on a field) leaves the popup alone.
        if (!promptHeld.current) raisePrompt();
      }
    } catch {
      // Silently swallow check errors (network issues, endpoint not yet live, etc.)
    } finally {
      setChecking(false);
    }
  }, [raisePrompt]);

  const installUpdate = useCallback(async () => {
    if (!isTauri) return;
    const update = updateRef.current;
    if (!update) return;

    try {
      setInstalling(true);
      setError(null);
      setDownloadProgress(0);

      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event: { event: string; data: { contentLength?: number; chunkLength: number } }) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setDownloadProgress(Math.round((downloaded / contentLength) * 100));
          }
        } else if (event.event === 'Finished') {
          setDownloadProgress(100);
        }
      });

      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      setInstalling(false);
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setAvailable(false);
    setVersion(null);
    setBody(null);
    updateRef.current = null;
    setPromptOpen(false);
    clearTimeout(snoozeTimer.current);
    promptHeld.current = false;
  }, []);

  // Check on mount + every hour
  useEffect(() => {
    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      clearTimeout(snoozeTimer.current);
    };
  }, [checkForUpdate]);

  return {
    available,
    checking,
    version,
    body,
    downloadProgress,
    installing,
    error,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
    promptOpen,
    snoozeUpdate,
  };
}
