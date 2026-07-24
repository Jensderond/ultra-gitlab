import { useEffect, useRef } from 'react';
import { registerManualRefreshHandler } from '../services/manualRefresh';

/**
 * Registers `handler` as the target of the global manual-refresh action
 * (Mod+R / command palette "Trigger sync") while the component is mounted.
 */
export function useManualRefreshHandler(handler: () => Promise<void> | void, enabled = true) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    return registerManualRefreshHandler(() => handlerRef.current());
  }, [enabled]);
}
