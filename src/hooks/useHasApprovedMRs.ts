/**
 * Hook that tracks whether any of the user's MRs are fully approved.
 *
 * Checks across all configured instances and refreshes on mr-updated events.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listInstances } from '../services/gitlab';
import { listMyMergeRequests } from '../services/tauri';
import { tauriListen } from '../services/transport';

export default function useHasApprovedMRs(): boolean {
  const [hasApproved, setHasApproved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkApproved = useCallback(async () => {
    try {
      const instances = await listInstances();
      for (const instance of instances) {
        const mrs = await listMyMergeRequests(instance.id);
        if (mrs.some((mr) => mr.approvalStatus === 'approved')) {
          setHasApproved(true);
          return;
        }
      }
      setHasApproved(false);
    } catch {
      // Non-critical — dot just won't show
    }
  }, []);

  // Check on mount
  useEffect(() => {
    checkApproved();
  }, [checkApproved]);

  // Re-check on mr-updated events (debounced) — only in Tauri
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    tauriListen<{ mr_id: number }>('mr-updated', () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => checkApproved(), 500);
    }).then((fn) => { unlisten = fn; });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      unlisten?.();
    };
  }, [checkApproved]);

  return hasApproved;
}
