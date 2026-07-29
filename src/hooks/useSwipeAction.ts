import { useCallback, useEffect, useRef, useState } from 'react';
import { hapticImpact } from '../services/haptics';

/** Leftward drag distance (px) required before release triggers the action. */
const TRIGGER_THRESHOLD = 72;
/** Visual cap on how far the row can be dragged out. */
const MAX_DRAG = 96;
/** Damping applied past the trigger threshold, so overdrag rubber-bands. */
const OVERDRAG_RESISTANCE = 0.3;
/** Movement (px) before the gesture commits to horizontal vs vertical. */
const INTENT_THRESHOLD = 8;
/** Must match the snap-back transition duration in the consumer's CSS. */
const SETTLE_MS = 220;

interface UseSwipeActionOptions {
  /** Called when the user releases a drag past the threshold. */
  onTrigger: () => void;
  disabled?: boolean;
}

interface UseSwipeActionResult<T extends HTMLElement> {
  /** Attach to the element that should follow the finger (ref callback). */
  containerRef: (node: T | null) => void | (() => void);
  /** Current leftward drag distance in px (0 when idle). */
  offset: number;
  /** Drag distance as a fraction of the trigger threshold, clamped to 0…1. */
  progress: number;
  /** True while the finger is down and the gesture has claimed the touch. */
  dragging: boolean;
  /** True while the row animates back after release. */
  settling: boolean;
  /** True when releasing right now would fire `onTrigger`. */
  pastThreshold: boolean;
}

/**
 * Swipe-left action for a list row (iOS-Mail style). The row follows the
 * finger once horizontal intent is established; releasing past the threshold
 * fires `onTrigger` and the row snaps back. Vertical scrolling is never
 * hijacked — the gesture only claims the touch when horizontal movement
 * dominates.
 */
export function useSwipeAction<T extends HTMLElement>({
  onTrigger,
  disabled = false,
}: UseSwipeActionOptions): UseSwipeActionResult<T> {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);

  const onTriggerRef = useRef(onTrigger);
  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  // Mutable gesture state — outside React state so the touch handlers can
  // read/write it synchronously (same pattern as usePullToRefresh).
  const gesture = useRef({
    startX: 0,
    startY: 0,
    tracking: false, // finger down, intent not yet decided
    armed: false, // gesture claimed the touch (horizontal intent)
    distance: 0,
    crossed: false, // distance is currently past TRIGGER_THRESHOLD
  });
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useCallback(
    (node: T | null) => {
      if (!node || disabled) return;
      const s = gesture.current;

      function release(fire: boolean) {
        if (s.armed) {
          if (fire && s.distance >= TRIGGER_THRESHOLD) onTriggerRef.current();
          setDragging(false);
          setSettling(true);
          setOffset(0);
          if (settleTimer.current) clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS);
        }
        s.tracking = false;
        s.armed = false;
        s.distance = 0;
        s.crossed = false;
      }

      function handleTouchStart(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        s.startX = e.touches[0].clientX;
        s.startY = e.touches[0].clientY;
        s.tracking = true;
        s.armed = false;
        s.distance = 0;
        s.crossed = false;
      }

      function handleTouchMove(e: TouchEvent) {
        if (!s.tracking) return;
        const dx = e.touches[0].clientX - s.startX;
        const dy = e.touches[0].clientY - s.startY;

        if (!s.armed) {
          if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > INTENT_THRESHOLD) {
            // Vertical scroll — hand the touch back for good.
            s.tracking = false;
            return;
          }
          if (dx > INTENT_THRESHOLD) {
            // Rightward drag — not ours.
            s.tracking = false;
            return;
          }
          if (dx <= -INTENT_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            s.armed = true;
            // A new gesture can arm while the previous release is still
            // settling (within SETTLE_MS) — clear it so `is-settling` never
            // coexists with `is-swiping` (their transitions conflict).
            if (settleTimer.current) {
              clearTimeout(settleTimer.current);
              settleTimer.current = null;
            }
            setSettling(false);
            setDragging(true);
          } else {
            return; // intent not decided yet
          }
        }

        const raw = Math.max(0, -dx);
        s.distance =
          raw <= TRIGGER_THRESHOLD
            ? raw
            : Math.min(
                TRIGGER_THRESHOLD + (raw - TRIGGER_THRESHOLD) * OVERDRAG_RESISTANCE,
                MAX_DRAG,
              );
        setOffset(s.distance);
        if (e.cancelable) e.preventDefault();

        // Haptic on the upward threshold crossing only — sequenced after
        // preventDefault so the IPC call never sits in front of the scroll
        // lock, and fired here rather than from an effect on `pastThreshold`
        // to save a render frame (perceptible for a tap). Dragging back below
        // re-arms it, so a deliberate re-cross buzzes again while holding the
        // finger at the boundary does not.
        const past = s.distance >= TRIGGER_THRESHOLD;
        if (past !== s.crossed) {
          s.crossed = past;
          if (past) void hapticImpact();
        }
      }

      const handleTouchEnd = () => release(true);
      const handleTouchCancel = () => release(false);

      node.addEventListener('touchstart', handleTouchStart, { passive: true });
      node.addEventListener('touchmove', handleTouchMove, { passive: false });
      node.addEventListener('touchend', handleTouchEnd);
      node.addEventListener('touchcancel', handleTouchCancel);

      // React 19 ref-cleanup: called when the node detaches or this callback
      // identity changes (e.g. `disabled` flips), so add/remove always share
      // one closure. Always return to idle here — otherwise a mid-gesture
      // detach/disable can leave `settling` stuck true forever, and the
      // consumer's click guard (`if (dragging || settling) return`) would
      // then swallow every future tap.
      return () => {
        node.removeEventListener('touchstart', handleTouchStart);
        node.removeEventListener('touchmove', handleTouchMove);
        node.removeEventListener('touchend', handleTouchEnd);
        node.removeEventListener('touchcancel', handleTouchCancel);
        if (settleTimer.current) {
          clearTimeout(settleTimer.current);
          settleTimer.current = null;
        }
        s.tracking = false;
        s.armed = false;
        s.distance = 0;
        s.crossed = false;
        setDragging(false);
        setSettling(false);
        setOffset(0);
      };
    },
    [disabled],
  );

  return {
    containerRef,
    offset,
    progress: Math.min(1, offset / TRIGGER_THRESHOLD),
    dragging,
    settling,
    pastThreshold: dragging && offset >= TRIGGER_THRESHOLD,
  };
}
