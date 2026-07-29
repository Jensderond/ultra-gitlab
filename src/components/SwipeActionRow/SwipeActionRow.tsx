/**
 * Swipe-left action row (iOS-Mail style), shared by list rows.
 *
 * Renders a clipping wrapper with an action layer behind a translating row.
 * The row follows the finger via useSwipeAction; releasing past the
 * threshold fires `onTrigger` and the row snaps back. A tap that ended a
 * swipe is suppressed before it reaches `rowProps.onClick`.
 */

import {
  forwardRef,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { useSwipeAction } from '../../hooks/useSwipeAction';
import './SwipeActionRow.css';

interface SwipeActionRowProps {
  /** Action-layer content while dragging below the threshold. */
  icon: ReactNode;
  /** Action-layer content once past the threshold (defaults to `icon`). */
  armedIcon?: ReactNode;
  /** Fired when a swipe releases past the threshold. */
  onTrigger: () => void;
  /**
   * Fired once a triggered swipe's snap-back animation has finished. The row
   * is transform-free from here, so fixed-position UI (bottom sheets) can
   * open without the transform hijacking its containing block.
   */
  onSettled?: () => void;
  /** Disables the gesture; the row renders and behaves normally. */
  disabled?: boolean;
  /** Classes for the translating row element (e.g. "mr-list-item selected"). */
  rowClassName: string;
  /** Spread onto the row element (onClick, role, tabIndex, onKeyDown…). */
  rowProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}

const SwipeActionRow = forwardRef<HTMLDivElement, SwipeActionRowProps>(function SwipeActionRow(
  { icon, armedIcon, onTrigger, onSettled, disabled, rowClassName, rowProps, children },
  ref,
) {
  const triggeredRef = useRef(false);
  const { containerRef, offset, progress, dragging, settling, pastThreshold } =
    useSwipeAction<HTMLDivElement>({
      onTrigger: () => {
        triggeredRef.current = true;
        onTrigger();
      },
      disabled,
    });

  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (!settling && triggeredRef.current) {
      triggeredRef.current = false;
      onSettledRef.current?.();
    }
  }, [settling]);

  const rowClasses = [rowClassName, 'swipe-row-item'];
  if (dragging) rowClasses.push('is-swiping');
  if (settling) rowClasses.push('is-settling');

  return (
    <div ref={ref} className="swipe-row">
      {(dragging || settling) && (
        <div
          className={`swipe-row-action${pastThreshold ? ' is-armed' : ''}`}
          style={{ '--swipe-progress': progress } as CSSProperties}
          aria-hidden
        >
          {/* Two nested scale layers: the outer one tracks the finger 1:1 with
              no transition, the inner one springs past 1.0 when armed. They
              can't share a single transform — a spring transition on the
              finger-tracked scale would lag the drag. Both stay mounted across
              the icon/armedIcon swap so the spring is never cut short. */}
          <span className="swipe-row-action-icon">
            <span className="swipe-row-action-icon-pop">
              {pastThreshold ? (armedIcon ?? icon) : icon}
            </span>
          </span>
        </div>
      )}
      <div
        {...rowProps}
        ref={containerRef}
        className={rowClasses.join(' ')}
        style={offset > 0 ? { transform: `translateX(${-offset}px)` } : undefined}
        onClick={(e) => {
          // A tap that ended a swipe must not activate the row; `settling`
          // is still true in the click's timing window after touchend.
          if (dragging || settling) return;
          rowProps?.onClick?.(e);
        }}
      >
        {children}
      </div>
    </div>
  );
});

export default SwipeActionRow;
