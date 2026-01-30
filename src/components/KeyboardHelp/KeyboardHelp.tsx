/**
 * Keyboard Help overlay component.
 *
 * Displays all available keyboard shortcuts organized by category.
 * Opened with the '?' key.
 */

import { useEffect, useCallback } from 'react';
import {
  defaultShortcuts,
  categoryLabels,
  formatKey,
  type ShortcutCategory,
} from '../../config/shortcuts';
import './KeyboardHelp.css';

interface KeyboardHelpProps {
  /** Whether the overlay is open */
  isOpen: boolean;
  /** Close the overlay */
  onClose: () => void;
}

/**
 * Group shortcuts by category for display.
 */
function groupByCategory() {
  const groups = new Map<ShortcutCategory, typeof defaultShortcuts>();

  // Order categories for display
  const categoryOrder: ShortcutCategory[] = [
    'global',
    'navigation',
    'list',
    'diff',
    'review',
    'sync',
  ];

  for (const category of categoryOrder) {
    groups.set(category, []);
  }

  for (const shortcut of defaultShortcuts) {
    const group = groups.get(shortcut.category);
    if (group) {
      group.push(shortcut);
    }
  }

  // Remove empty categories
  for (const [category, shortcuts] of groups) {
    if (shortcuts.length === 0) {
      groups.delete(category);
    }
  }

  return groups;
}

/**
 * Keyboard Help overlay.
 *
 * Features:
 * - Organized by category
 * - Shows all shortcuts with descriptions
 * - Escape to close
 * - Click outside to close
 */
export default function KeyboardHelp({ isOpen, onClose }: KeyboardHelpProps) {
  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // Add keyboard listener when open
  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen) {
    return null;
  }

  const groupedShortcuts = groupByCategory();

  return (
    <div className="keyboard-help-overlay" onClick={onClose}>
      <div
        className="keyboard-help-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="keyboard-help-header">
          <h2>Keyboard Shortcuts</h2>
          <button
            type="button"
            className="keyboard-help-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="keyboard-help-content">
          {Array.from(groupedShortcuts.entries()).map(([category, shortcuts]) => (
            <div key={category} className="shortcut-category">
              <h3 className="category-header">{categoryLabels[category]}</h3>
              <div className="shortcut-list">
                {shortcuts.map((shortcut) => (
                  <div key={shortcut.id} className="shortcut-item">
                    <span className="shortcut-description">
                      {shortcut.description}
                    </span>
                    <kbd className="shortcut-key">
                      {formatKey(shortcut.defaultKey)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="keyboard-help-footer">
          Press <kbd>Esc</kbd> or <kbd>?</kbd> to close
        </div>
      </div>
    </div>
  );
}
