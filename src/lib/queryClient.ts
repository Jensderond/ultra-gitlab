import { QueryClient, focusManager, type Query } from "@tanstack/react-query";
import { isIOS } from "../services/transport";

/**
 * Minimum time since a query's last fetch before regaining focus refetches it.
 * Without it every alt-tab refetched each stale query (staleTime is 15–30s for
 * the live GitLab reads), so switching back and forth kept hitting GitLab.
 * After a longer absence the first focus still refetches right away.
 */
export const FOCUS_REFETCH_COOLDOWN_MS = 60_000;

export function refetchOnFocusAfterCooldown(query: Query): boolean {
  const { isInvalidated, dataUpdatedAt, errorUpdatedAt } = query.state;
  // Count failed fetches too, so a failing endpoint isn't retried per alt-tab.
  const lastFetchAt = Math.max(dataUpdatedAt, errorUpdatedAt);
  return isInvalidated || Date.now() - lastFetchAt >= FOCUS_REFETCH_COOLDOWN_MS;
}

/**
 * Count the app as focused only while its window has focus AND is visible.
 * React Query's default listener only watches `visibilitychange`, so a
 * visible window behind another app counted as focused and interval queries
 * kept polling GitLab. iOS keeps the default: one full-screen webview whose
 * visibility already tracks foreground/background.
 */
export function trackWindowFocus(): void {
  if (isIOS || typeof window === "undefined" || !window.addEventListener) return;
  focusManager.setEventListener((setFocused) => {
    let windowFocused = document.hasFocus();
    const update = () =>
      setFocused(windowFocused && document.visibilityState !== "hidden");
    const onFocus = () => {
      windowFocused = true;
      update();
    };
    const onBlur = () => {
      windowFocused = false;
      update();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", update);
    };
  });
}

trackWindowFocus();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      // Still requires the query to be stale; the cooldown only thins it out.
      refetchOnWindowFocus: refetchOnFocusAfterCooldown,
      // Interval polling skips ticks while unfocused (see trackWindowFocus).
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
