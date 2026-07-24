import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';

/** Quiet time after the last scroll/touch before a partial reveal is settled. */
const SETTLE_DELAY_MS = 120;
/** Positions this close to fully-open/fully-collapsed don't need settling. */
const SETTLE_TOLERANCE_PX = 2;

interface UseSearchRevealResult<T extends HTMLElement> {
  /** Attach to the scrollable list container (ref callback). */
  containerRef: (node: T | null) => void | (() => void);
  /** Attach to the wrapper around the search bar (first child of the container). */
  searchWrapRef: RefObject<HTMLDivElement | null>;
  /** Smooth-scroll the search bar fully into view. Never focuses it. */
  revealSearch: () => void;
  /** Smooth-scroll the search bar back out of view above the fold. */
  hideSearch: () => void;
}

/**
 * iOS-style collapsed search bar for a scrollable list.
 *
 * The search bar renders as the first child of the scroll container and is
 * hidden by an initial scroll offset — the same trick UIKit uses for a
 * UISearchController in a table view. Pulling down reveals it through plain
 * native scrolling (no custom drag gesture), and releasing with the bar
 * partially revealed settles it fully open or fully collapsed, whichever is
 * closer. Revealing never focuses the field, so the keyboard stays closed
 * until the user taps it.
 */
export function useSearchReveal<T extends HTMLElement>(
  enabled: boolean,
): UseSearchRevealResult<T> {
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const nodeRef = useRef<T | null>(null);

  // Scroll offset at which the search bar sits fully above the viewport
  // (content-space position of the wrapper's bottom edge). Measured on
  // demand so layout changes never leave a stale value behind.
  const collapsedOffset = useCallback(() => {
    const node = nodeRef.current;
    const wrap = searchWrapRef.current;
    if (!node || !wrap) return 0;
    return (
      wrap.getBoundingClientRect().bottom -
      node.getBoundingClientRect().top +
      node.scrollTop
    );
  }, []);

  const containerRef = useCallback(
    (node: T | null) => {
      nodeRef.current = node;
      if (!node || !enabled) return;

      // Start collapsed: the bar hides above the fold until pulled down.
      node.scrollTop = collapsedOffset();

      let touching = false;
      let settleTimer: number | null = null;

      function clearTimer() {
        if (settleTimer != null) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
      }

      function settle() {
        settleTimer = null;
        if (touching) return;
        const collapsed = collapsedOffset();
        const top = node!.scrollTop;
        if (top > SETTLE_TOLERANCE_PX && top < collapsed - SETTLE_TOLERANCE_PX) {
          node!.scrollTo({
            top: top < collapsed / 2 ? 0 : collapsed,
            behavior: 'smooth',
          });
        }
      }

      function scheduleSettle() {
        clearTimer();
        settleTimer = window.setTimeout(settle, SETTLE_DELAY_MS);
      }

      function handleTouchStart() {
        touching = true;
        clearTimer();
      }

      function handleTouchEnd() {
        touching = false;
        scheduleSettle();
      }

      function handleScroll() {
        // While the finger is down the position isn't final; settle only
        // once release momentum (or a programmatic scroll) has gone quiet.
        if (!touching) scheduleSettle();
      }

      node.addEventListener('touchstart', handleTouchStart, { passive: true });
      node.addEventListener('touchend', handleTouchEnd);
      node.addEventListener('touchcancel', handleTouchEnd);
      node.addEventListener('scroll', handleScroll, { passive: true });

      // Late layout shifts (web-font load, rotation) change the bar's height
      // after the initial hide — re-settle so it doesn't peek out.
      const resizeObserver = new ResizeObserver(() => scheduleSettle());
      if (searchWrapRef.current) resizeObserver.observe(searchWrapRef.current);

      return () => {
        clearTimer();
        resizeObserver.disconnect();
        node.removeEventListener('touchstart', handleTouchStart);
        node.removeEventListener('touchend', handleTouchEnd);
        node.removeEventListener('touchcancel', handleTouchEnd);
        node.removeEventListener('scroll', handleScroll);
      };
    },
    [enabled, collapsedOffset],
  );

  const revealSearch = useCallback(() => {
    nodeRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const hideSearch = useCallback(() => {
    nodeRef.current?.scrollTo({ top: collapsedOffset(), behavior: 'smooth' });
  }, [collapsedOffset]);

  return { containerRef, searchWrapRef, revealSearch, hideSearch };
}
