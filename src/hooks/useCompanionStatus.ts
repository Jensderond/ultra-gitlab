/**
 * Hook to poll companion server status for the sidebar indicator.
 *
 * Returns enabled state and connected device count. Only polls when
 * running in Tauri (companion server is desktop-only).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { isTauri } from '../services/transport';
import { getCompanionStatus } from '../services/tauri';
import type { CompanionStatus } from '../types';

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/** Dispatch this event to trigger an immediate re-poll of companion status. */
export const COMPANION_STATUS_CHANGED = 'companion-status-changed';

export default function useCompanionStatus(): CompanionStatus {
  const [status, setStatus] = useState<CompanionStatus>({
    enabled: false,
    connectedDevices: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const s = await getCompanionStatus();
      setStatus(s);
    } catch {
      // Silently ignore — indicator just won't show
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    // Listen for manual re-poll requests from Settings
    const handleChanged = () => { poll(); };
    window.addEventListener(COMPANION_STATUS_CHANGED, handleChanged);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      window.removeEventListener(COMPANION_STATUS_CHANGED, handleChanged);
    };
  }, [poll]);

  return status;
}
