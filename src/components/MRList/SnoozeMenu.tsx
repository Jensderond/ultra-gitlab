/**
 * Snooze preset menu.
 *
 * Anchored popover on desktop, bottom sheet on narrow/touch viewports.
 * Rendered by MRListItem when its snooze button (or the `z` shortcut)
 * opens the menu for that row.
 */

import { useEffect, useRef } from 'react';
import { snoozePresets } from '../../lib/snooze';
import './SnoozeMenu.css';

interface SnoozeMenuProps {
  /** Snooze the MR until this Unix timestamp (seconds). */
  onSnooze: (until: number) => void;
  onClose: () => void;
}

export default function SnoozeMenu({ onSnooze, onClose }: SnoozeMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first preset so the menu is fully keyboard-driven.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button');
    first?.focus();
  }, []);

  // Close on click/tap outside the menu.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose]);

  function handleKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []
      );
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === 'ArrowDown'
          ? buttons[(index + 1) % buttons.length]
          : buttons[(index - 1 + buttons.length) % buttons.length];
      next?.focus();
    }
  }

  return (
    <div
      ref={menuRef}
      className="snooze-menu"
      role="menu"
      aria-label="Snooze until"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div className="snooze-menu-title">Snooze until…</div>
      {snoozePresets.map((preset) => (
        <button
          key={preset.id}
          role="menuitem"
          className="snooze-menu-option"
          onClick={(e) => {
            e.stopPropagation();
            onSnooze(preset.until(new Date()));
          }}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
