/**
 * Snooze control for the MR detail page.
 *
 * Snoozing used to live on every list row as a hover-revealed clock button.
 * It now lives here — one place, on the MR you're actually looking at — which
 * keeps the list rows free of a per-row control. Touch devices additionally
 * keep swipe-left on the list rows.
 *
 * Exposes a `toggle()` ref so the `z` shortcut can drive it, the same way
 * ApprovalButton is driven by `a`.
 */

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Clock } from '@phosphor-icons/react';
import type { MergeRequest } from '../../types';
import { useSnoozeMRMutation } from '../../hooks/queries/useSnoozeMRMutation';
import { isSnoozed, formatSnoozeUntil } from '../../lib/snooze';
import SnoozeMenu from '../MRList/SnoozeMenu';
import './SnoozeButton.css';

export interface SnoozeButtonRef {
  /** Snoozed → unsnooze outright; otherwise open/close the preset menu. */
  toggle: () => void;
}

interface SnoozeButtonProps {
  mr: MergeRequest;
}

const SnoozeButton = forwardRef<SnoozeButtonRef, SnoozeButtonProps>(
  function SnoozeButton({ mr }, ref) {
    const { snooze, unsnooze } = useSnoozeMRMutation();
    const [menuOpen, setMenuOpen] = useState(false);
    const snoozed = isSnoozed(mr);
    const anchorRef = useRef<HTMLSpanElement>(null);

    function toggle() {
      if (snoozed) {
        unsnooze.mutate({ mrId: mr.id });
        setMenuOpen(false);
      } else {
        setMenuOpen((open) => !open);
      }
    }

    useImperativeHandle(ref, () => ({ toggle }));

    return (
      <span className="mr-snooze-action" ref={anchorRef}>
        <button
          className={`mr-snooze-action-btn${snoozed ? ' mr-snooze-action-btn--active' : ''}`}
          title={
            snoozed
              ? `Snoozed until ${formatSnoozeUntil(mr.snoozedUntil!)} — click to unsnooze (z)`
              : 'Snooze (z)'
          }
          aria-label={snoozed ? 'Unsnooze merge request' : 'Snooze merge request'}
          aria-expanded={snoozed ? undefined : menuOpen}
          onClick={toggle}
        >
          <Clock size={18} weight="bold" />
        </button>
        {menuOpen && !snoozed && (
          <SnoozeMenu
            anchorRef={anchorRef}
            onSnooze={(until) => {
              snooze.mutate({ mrId: mr.id, until });
              setMenuOpen(false);
            }}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </span>
    );
  },
);

export default SnoozeButton;
