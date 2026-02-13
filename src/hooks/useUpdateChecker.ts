/**
 * Hook for checking and installing app updates.
 *
 * Checks for updates on mount and every 4 hours using the
 * Tauri updater plugin. Provides state for UI indicators
 * (sidebar badge, settings section) and actions to install.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

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
}

export default function useUpdateChecker(): UpdateCheckerState {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      setChecking(true);
      setError(null);
      const update = await check();
      if (update) {
        updateRef.current = update;
        setAvailable(true);
        setVersion(update.version);
        setBody(update.body ?? null);
      }
    } catch {
      // Silently swallow check errors (network issues, endpoint not yet live, etc.)
    } finally {
      setChecking(false);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    try {
      setInstalling(true);
      setError(null);
      setDownloadProgress(0);

      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
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
  }, []);

  // Check on mount + every 4 hours
  useEffect(() => {
    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
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
  };
}
