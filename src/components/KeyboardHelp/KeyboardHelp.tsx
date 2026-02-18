/**
 * Keyboard Help overlay component.
 *
 * Displays all available keyboard shortcuts organized by category.
 * Opened with the '?' key.
 */

import { useEffect, useCallback } from 'react';
import {
  categoryLabels,
  formatKey,
  getShortcutsByCategoryForRoute,
  getContextsForRoute,
} from '../../config/shortcuts';
import './KeyboardHelp.css';

interface KeyboardHelpProps {
  /** Whether the overlay is open */
  isOpen: boolean;
  /** Close the overlay */
  onClose: () => void;
  /** Current route pathname for context-aware sorting */
  pathname: string;
}

/**
 * Keyboard Help overlay.
 *
 * Features:
 * - Organized by category with context-relevant shortcuts first
 * - Shows all shortcuts with descriptions
 * - Highlights categories relevant to the current screen
 * - Escape to close
 * - Click outside to close
 */
export default function KeyboardHelp({ isOpen, onClose, pathname }: KeyboardHelpProps) {
  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopImmediatePropagation();
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

  const groupedShortcuts = getShortcutsByCategoryForRoute(pathname);
  const activeContexts = new Set(getContextsForRoute(pathname));

  return (
    <div className="keyboard-help-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }} role="button" tabIndex={0} aria-label="Close keyboard help">
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
          {Array.from(groupedShortcuts.entries()).map(([category, shortcuts]) => {
            const isActiveCategory = shortcuts.some((s) => activeContexts.has(s.context));
            return (
              <div key={category} className={`shortcut-category${isActiveCategory ? ' shortcut-category--active' : ''}`}>
                <h3 className="category-header">{categoryLabels[category]}</h3>
                <div className="shortcut-list">
                  {shortcuts.map((shortcut) => {
                    const keys = shortcut.defaultKey.split(' / ');
                    return (
                      <div key={shortcut.id} className="shortcut-item">
                        <span className="shortcut-description">
                          {shortcut.description}
                        </span>
                        <span className="shortcut-keys">
                          {keys.map((key, i) => (
                            <span key={key}>
                              {i > 0 && <span className="shortcut-separator">/</span>}
                              <kbd className="shortcut-key">{formatKey(key)}</kbd>
                            </span>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="keyboard-help-footer">
          Press <kbd>Esc</kbd> or <kbd>?</kbd> to close
        </div>
      </div>
    </div>
  );
}
