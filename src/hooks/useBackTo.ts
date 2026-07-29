import { useCallback } from 'react';
import { useNavigate, useNavigationType } from 'react-router-dom';

/**
 * Leave a drill-in screen for the list it was opened from.
 *
 * Pops history when this screen was pushed, so the list is restored from its
 * own entry — tab, scroll offset and all — which is exactly what iOS's native
 * edge-swipe-back gesture does (`setAllowsBackForwardNavigationGestures`, see
 * `src-tauri/src/lib.rs`). Keeping the button and the gesture on the same path
 * is the point: a `replace()` would discard the entry the gesture would have
 * returned to *and* stack a duplicate list entry behind it, so the next swipe
 * back reads as a no-op.
 *
 * Deep links and reloads land here without an entry to return to, so those
 * fall back to replacing the current one with `fallbackPath`.
 */
export function useBackTo(fallbackPath: string): () => void {
  const navigate = useNavigate();
  const navigationType = useNavigationType();

  return useCallback(() => {
    if (navigationType === 'PUSH') navigate(-1);
    else navigate(fallbackPath, { replace: true });
  }, [navigate, navigationType, fallbackPath]);
}
