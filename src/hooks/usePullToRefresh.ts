import { useEffect, useRef, useState, useCallback } from 'react';

/** Drag distance (px) required before releasing triggers a refresh. */
const PULL_THRESHOLD = 64;
/** Visual cap on how far the indicator can be dragged out. */
const MAX_PULL = 96;
/** Drag-to-visual-distance damping, so the gesture feels rubber-banded. */
const RESISTANCE = 0.5;

interface UsePullToRefreshOptions {
  /** Called when the user releases past the threshold. Awaited before the indicator resets. */
  onRefresh: () => Promise<void> | void;
  disabled?: boolean;
}

interface UsePullToRefreshResult<T extends HTMLElement> {
  /** Attach to the scrollable element the gesture should apply to (ref callback). */
  containerRef: (node: T | null) => void | (() => void);
  /** Current visual pull distance in px (0 when idle). */
  pullDistance: number;
  /** True while `onRefresh` is in flight. */
  refreshing: boolean;
  /**
   * Programmatically run the same refresh sequence a touch release triggers
   * (used by the desktop Mod+R shortcut). No-op while disabled or refreshing.
   */
  triggerRefresh: () => Promise<void>;
}

/**
 * Touch-driven pull-to-refresh for a scrollable container. Only arms when the
 * container is already scrolled to the top, so it never fights normal scrolling.
 */
export function usePullToRefresh<T extends HTMLElement>({
  onRefresh,
  disabled = false,
}: UsePullToRefreshOptions): UsePullToRefreshResult<T> {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // Mutable gesture state — kept out of React state so it can be read/written
  // synchronously inside the touch handlers without stale-closure issues.
  const gesture = useRef({ startY: null as number | null, pulling: false, refreshing: false, distance: 0 });

  // Shared by touch release and the programmatic desktop trigger, so the two
  // paths can't drift apart. `holdIndicator` keeps the inline indicator open
  // for gesture refreshes; the desktop trigger leaves pullDistance at 0 so
  // nothing shifts (the page header shows the feedback instead).
  const runRefresh = useCallback(async (holdIndicator: boolean) => {
    const s = gesture.current;
    if (s.refreshing) return;
    s.refreshing = true;
    setRefreshing(true);
    if (holdIndicator) setPullDistance(PULL_THRESHOLD * 0.8);
    try {
      await onRefreshRef.current();
    } finally {
      s.refreshing = false;
      s.distance = 0;
      setRefreshing(false);
      setPullDistance(0);
    }
  }, []);

  const triggerRefresh = useCallback(async () => {
    if (disabled) return;
    await runRefresh(false);
  }, [disabled, runRefresh]);

  const containerRef = useCallback(
    (node: T | null) => {
      if (!node || disabled) return;
      const s = gesture.current;

      function reset() {
        s.pulling = false;
        s.distance = 0;
        setPullDistance(0);
      }

      function handleTouchStart(e: TouchEvent) {
        if (s.refreshing) {
          s.startY = null;
          return;
        }
        s.startY = e.touches[0].clientY;
        s.pulling = false;
      }

      function handleTouchMove(e: TouchEvent) {
        if (s.startY == null || s.refreshing) return;
        if (node!.scrollTop > 0) {
          // Not at the top yet — let native scrolling run (e.g. revealing the
          // collapsed search bar) and keep re-anchoring so the pull measures
          // from the moment the container reaches the top, mid-gesture.
          s.startY = e.touches[0].clientY;
          if (s.pulling) reset();
          return;
        }
        const delta = e.touches[0].clientY - s.startY;
        if (delta <= 0) {
          if (s.pulling) reset();
          return;
        }
        s.pulling = true;
        s.distance = Math.min(delta * RESISTANCE, MAX_PULL);
        setPullDistance(s.distance);
        if (delta > 4 && e.cancelable) e.preventDefault();
      }

      function handleTouchEnd() {
        if (!s.pulling) {
          s.startY = null;
          return;
        }
        s.pulling = false;
        s.startY = null;
        if (s.distance >= PULL_THRESHOLD) {
          void runRefresh(true);
        } else {
          reset();
        }
      }

      node.addEventListener('touchstart', handleTouchStart, { passive: true });
      node.addEventListener('touchmove', handleTouchMove, { passive: false });
      node.addEventListener('touchend', handleTouchEnd);
      node.addEventListener('touchcancel', handleTouchEnd);

      // React 19 ref-cleanup: called when the node is detached or this
      // callback identity changes, so add/remove always share one closure.
      return () => {
        node.removeEventListener('touchstart', handleTouchStart);
        node.removeEventListener('touchmove', handleTouchMove);
        node.removeEventListener('touchend', handleTouchEnd);
        node.removeEventListener('touchcancel', handleTouchEnd);
      };
    },
    [disabled, runRefresh],
  );

  return { containerRef, pullDistance, refreshing, triggerRefresh };
}
