/**
 * Hook that tracks whether any of the user's MRs are fully approved.
 *
 * Checks across all configured instances and refreshes on mr-updated events.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { listInstances } from '../services/gitlab';
import { listMyMergeRequests } from '../services/tauri';

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

  // Re-check on mr-updated events (debounced)
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<{ mr_id: number }>('mr-updated', () => {
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
