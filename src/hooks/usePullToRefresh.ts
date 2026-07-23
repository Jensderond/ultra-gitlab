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
        if (s.refreshing || node!.scrollTop > 0) {
          s.startY = null;
          return;
        }
        s.startY = e.touches[0].clientY;
        s.pulling = false;
      }

      function handleTouchMove(e: TouchEvent) {
        if (s.startY == null || s.refreshing) return;
        if (node!.scrollTop > 0) {
          s.startY = null;
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

      async function handleTouchEnd() {
        if (!s.pulling) {
          s.startY = null;
          return;
        }
        s.pulling = false;
        s.startY = null;
        if (s.distance >= PULL_THRESHOLD) {
          s.refreshing = true;
          setRefreshing(true);
          setPullDistance(PULL_THRESHOLD * 0.8);
          try {
            await onRefreshRef.current();
          } finally {
            s.refreshing = false;
            s.distance = 0;
            setRefreshing(false);
            setPullDistance(0);
          }
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
    [disabled],
  );

  return { containerRef, pullDistance, refreshing };
}
