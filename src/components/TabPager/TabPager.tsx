/**
 * Horizontal finger-tracking pager for tabbed views (touch).
 *
 * Renders its children side by side; `activeIndex` picks the visible pane and
 * horizontal swipes commit to a neighbour via `onCommit` — controlled, so the
 * parent can keep the active tab in the URL. Non-wrapping: dragging outward
 * at either end rubber-bands. Vertical scrolling is never hijacked, and
 * leftward drags that start on a swipe-enabled row (`[data-swipe-row]`) are
 * left to the row's own gesture.
 */

import { Children, useCallback, useRef, useState, type ReactNode } from 'react';
import './TabPager.css';

/** Movement (px) before the gesture commits to horizontal vs vertical. */
const INTENT_THRESHOLD = 8;
/** Fraction of the pane width a drag must cross to commit on release. */
const COMMIT_FRACTION = 0.4;
/** Release speed (px/ms) that commits regardless of distance (a flick). */
const FLICK_VELOCITY = 0.3;
/** Minimum finger travel (px) before a flick may commit — filters jitter. */
const FLICK_MIN_DRAG = 24;
/** Minimum time (ms) between samples to trust for a velocity reading. */
const MIN_VELOCITY_DT = 1;
/** Damping applied when dragging outward at either end (non-wrapping). */
const RUBBER_BAND = 0.3;

interface TabPagerProps {
  /** Which pane is showing — controlled by the parent (URL-derived). */
  activeIndex: number;
  /** Called when a swipe commits to a neighbouring pane. */
  onCommit: (index: number) => void;
  /** Disables the gesture (e.g. while filtering). Panes still render. */
  disabled?: boolean;
  /** The panes, in tab order. */
  children: ReactNode;
}

export default function TabPager({
  activeIndex,
  onCommit,
  disabled = false,
  children,
}: TabPagerProps) {
  const panes = Children.toArray(children);
  const count = panes.length;

  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Mirrors for the native handlers, which must read the latest values
  // without re-subscribing (same pattern as useSwipeAction).
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const countRef = useRef(count);
  countRef.current = count;

  const trackRef = useRef<HTMLDivElement | null>(null);

  // Mutable gesture state — outside React state so the touch handlers can
  // read/write it synchronously (same pattern as usePullToRefresh).
  const gesture = useRef({
    startX: 0,
    startY: 0,
    tracking: false, // finger down, intent not yet decided
    armed: false, // gesture claimed the touch (horizontal intent)
    rowOwnsLeft: false, // touch started on a swipe-enabled row
    seed: 0, // offset inherited from a grabbed mid-settle track
    fingerDx: 0, // actual finger travel, excluding the seed
    offset: 0, // rendered track offset (seed + travel, damped at ends)
    lastX: 0,
    lastT: 0,
    velocity: 0, // px/ms, sign matches drag direction
  });

  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || disabled) return;
      const s = gesture.current;
      const viewportNode = node; // Preserve narrowed type for closures

      function reset() {
        s.tracking = false;
        s.armed = false;
        s.rowOwnsLeft = false;
        s.seed = 0;
        s.fingerDx = 0;
        s.offset = 0;
        s.velocity = 0;
      }

      function handleTouchStart(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        reset();
        s.startX = e.touches[0].clientX;
        s.startY = e.touches[0].clientY;
        s.lastX = s.startX;
        s.lastT = e.timeStamp;
        s.tracking = true;
        s.rowOwnsLeft =
          e.target instanceof Element && e.target.closest('[data-swipe-row]') != null;

        // Grab a settling track mid-flight: seed the drag from where the
        // track visually is and skip the intent phase — horizontal motion is
        // already established and the finger should freeze it.
        const track = trackRef.current;
        const width = viewportNode.clientWidth;
        if (track && width > 0) {
          const t = getComputedStyle(track).transform;
          if (t !== 'none') {
            const offset =
              new DOMMatrixReadOnly(t).m41 + activeIndexRef.current * width;
            if (Math.abs(offset) > 1) {
              s.armed = true;
              s.seed = offset;
              s.offset = offset;
              setDragging(true);
              setDragOffset(offset);
            }
          }
        }
      }

      function handleTouchMove(e: TouchEvent) {
        if (!s.tracking) return;
        const x = e.touches[0].clientX;
        const dx = x - s.startX;
        const dy = e.touches[0].clientY - s.startY;

        if (!s.armed) {
          if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > INTENT_THRESHOLD) {
            // Vertical — scrolling and pull-to-refresh own it, for good.
            s.tracking = false;
            return;
          }
          if (Math.abs(dx) <= INTENT_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) {
            return; // intent not decided yet
          }
          if (dx < 0 && s.rowOwnsLeft) {
            // Leftward on a swipe-enabled row — the snooze gesture wins.
            s.tracking = false;
            return;
          }
          s.armed = true;
          setDragging(true);
        }

        const dt = e.timeStamp - s.lastT;
        // Browser touch timestamps are clamped to coarse buckets (Chrome
        // rounds to ~0.1ms), so a tiny nonzero dt is noise, not a fast
        // finger — dividing by it manufactures a velocity in the
        // hundreds-of-px/ms range from a few pixels of motion, clearing
        // FLICK_VELOCITY for gestures that never flicked. Real touch
        // sampling reports well above this floor (8ms+ between events),
        // so gating here never affects a genuine flick.
        if (dt >= MIN_VELOCITY_DT) s.velocity = (x - s.lastX) / dt;
        s.lastX = x;
        s.lastT = e.timeStamp;
        s.fingerDx = dx;

        const index = activeIndexRef.current;
        const raw = s.seed + dx;
        const outward =
          (index === 0 && raw > 0) || (index === countRef.current - 1 && raw < 0);
        s.offset = outward ? raw * RUBBER_BAND : raw;
        setDragOffset(s.offset);
        if (e.cancelable) e.preventDefault();
      }

      function release(fire: boolean) {
        if (s.armed) {
          const width = viewportNode.clientWidth || 1;
          const index = activeIndexRef.current;
          let next = index;
          if (fire) {
            // Nearest pane to where the track visually sits — this is what
            // makes a tap-to-stop mid-settle land somewhere sensible…
            next = Math.round(index - s.offset / width);
            // …while a deliberate drag or flick always reaches the
            // neighbour the finger was heading for, even short of halfway.
            const dragged = Math.abs(s.fingerDx) > width * COMMIT_FRACTION;
            const flicked =
              Math.abs(s.fingerDx) > FLICK_MIN_DRAG &&
              Math.abs(s.velocity) > FLICK_VELOCITY &&
              Math.sign(s.velocity) === Math.sign(s.fingerDx);
            if ((dragged || flicked) && next === index) {
              next += s.fingerDx < 0 ? 1 : -1;
            }
            // One pane per gesture, and never past the ends (non-wrapping).
            next = Math.max(index - 1, Math.min(index + 1, next));
            next = Math.max(0, Math.min(countRef.current - 1, next));
          }
          setDragging(false);
          setDragOffset(0);
          // The router update and the offset reset batch into one render, so
          // the track transitions straight from the finger position to the
          // committed pane without a snap-back frame.
          if (next !== index) onCommitRef.current(next);
        }
        reset();
      }

      const handleTouchEnd = () => release(true);
      const handleTouchCancel = () => release(false);

      viewportNode.addEventListener('touchstart', handleTouchStart, { passive: true });
      viewportNode.addEventListener('touchmove', handleTouchMove, { passive: false });
      viewportNode.addEventListener('touchend', handleTouchEnd);
      viewportNode.addEventListener('touchcancel', handleTouchCancel);

      // React 19 ref-cleanup: runs when the node detaches or `disabled`
      // flips, so a mid-gesture disable can never leave the track dragged.
      return () => {
        viewportNode.removeEventListener('touchstart', handleTouchStart);
        viewportNode.removeEventListener('touchmove', handleTouchMove);
        viewportNode.removeEventListener('touchend', handleTouchEnd);
        viewportNode.removeEventListener('touchcancel', handleTouchCancel);
        reset();
        setDragging(false);
        setDragOffset(0);
      };
    },
    [disabled],
  );

  return (
    <div ref={viewportRef} className="tab-pager">
      <div
        ref={trackRef}
        className={`tab-pager-track${dragging ? ' is-dragging' : ''}`}
        style={{
          transform: `translateX(calc(${activeIndex * -100}% + ${dragOffset}px))`,
        }}
      >
        {panes.map((pane, i) => (
          <div
            // Order is fixed (one pane per status tab), so index keys are safe.
            key={i}
            className="tab-pager-pane"
            inert={i !== activeIndex}
            aria-hidden={i !== activeIndex}
          >
            {pane}
          </div>
        ))}
      </div>
    </div>
  );
}
