/**
 * CommandItem component for rendering individual commands in the palette.
 *
 * Provides a visual representation of a command with label, description,
 * and keyboard shortcut display.
 */

import { formatForDisplay } from '@tanstack/react-hotkeys';
import type { Command } from './CommandPalette';
import './CommandItem.css';

interface CommandItemProps {
  /** The command to display */
  command: Command;
  /** Whether this item is currently selected */
  isSelected: boolean;
  /** Called when the item is clicked */
  onClick: () => void;
  /** Called when mouse enters the item */
  onMouseEnter: () => void;
}

/**
 * Format a shortcut string for display.
 * Converts "Cmd+P" to separate kbd elements for each part.
 */
function formatShortcut(shortcut: string): React.ReactNode {
  const display = formatForDisplay(shortcut);
  // Split on '+' for non-mac, or on space for mac symbol output
  const parts = display.includes('+') ? display.split('+') : display.split(' ').filter(Boolean);
  return (
    <span className="command-item-shortcut">
      {parts.map((part, i) => (
        <kbd key={`${part}-${i}`}>{part}</kbd>
      ))}
    </span>
  );
}

/**
 * CommandItem component.
 *
 * Displays a single command in the palette with:
 * - Command label (main text)
 * - Optional description
 * - Optional keyboard shortcut
 */
export default function CommandItem({
  command,
  isSelected,
  onClick,
  onMouseEnter,
}: CommandItemProps) {
  return (
    <div
      className={`command-item-wrapper ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
    >
      <div className="command-item-main">
        <span className="command-item-label">{command.label}</span>
        {command.description && (
          <span className="command-item-description">{command.description}</span>
        )}
      </div>
      {command.shortcut && formatShortcut(command.shortcut)}
    </div>
  );
}
