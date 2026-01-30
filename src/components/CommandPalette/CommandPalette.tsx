/**
 * Command Palette container component.
 *
 * A Cmd+P accessible command palette for keyboard-driven navigation.
 * Provides fuzzy search over available commands.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './CommandPalette.css';

export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  category?: string;
  action: () => void;
}

interface CommandPaletteProps {
  /** Whether the palette is open */
  isOpen: boolean;
  /** Close the palette */
  onClose: () => void;
  /** Available commands */
  commands: Command[];
}

/**
 * Score a command against a search query using simple fuzzy matching.
 * Returns a score from 0-100, where higher is better.
 * Returns -1 if no match.
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 100; // Empty query matches everything

  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  // Exact match
  if (lowerText === lowerQuery) return 100;

  // Starts with
  if (lowerText.startsWith(lowerQuery)) return 90;

  // Contains as substring
  if (lowerText.includes(lowerQuery)) return 70;

  // Fuzzy match: all query chars appear in order
  let queryIndex = 0;
  let score = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      score += 10 + consecutiveBonus;
      consecutiveBonus += 5; // Consecutive matches are worth more
      queryIndex++;
    } else {
      consecutiveBonus = 0;
    }
  }

  // All query chars must be found
  if (queryIndex < lowerQuery.length) {
    return -1;
  }

  // Normalize score
  return Math.min(60, score);
}

/**
 * Command Palette component.
 *
 * Features:
 * - Fuzzy search over command labels and descriptions
 * - Keyboard navigation (up/down arrows, Enter to select)
 * - Escape to close
 * - Groups commands by category
 */
export default function CommandPalette({
  isOpen,
  onClose,
  commands,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter and sort commands by fuzzy match score
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return commands;
    }

    const scored = commands
      .map((cmd) => {
        // Score against label and description
        const labelScore = fuzzyScore(query, cmd.label);
        const descScore = cmd.description
          ? fuzzyScore(query, cmd.description)
          : -1;
        const categoryScore = cmd.category
          ? fuzzyScore(query, cmd.category)
          : -1;

        // Take best score
        const bestScore = Math.max(labelScore, descScore * 0.8, categoryScore * 0.5);

        return { cmd, score: bestScore };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.map(({ cmd }) => cmd);
  }, [commands, query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Small delay to ensure modal is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('.command-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Execute selected command
  const executeCommand = useCallback(
    (cmd: Command) => {
      onClose();
      // Small delay to let the modal close animation start
      requestAnimationFrame(() => {
        cmd.action();
      });
    },
    [onClose]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, filteredCommands.length - 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredCommands, selectedIndex, executeCommand, onClose]
  );

  // Group commands by category for display
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, Command[]>();

    for (const cmd of filteredCommands) {
      const category = cmd.category || 'Actions';
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(cmd);
    }

    return groups;
  }, [filteredCommands]);

  // Calculate global index for a command in grouped list
  const getGlobalIndex = useCallback(
    (cmd: Command): number => {
      return filteredCommands.indexOf(cmd);
    },
    [filteredCommands]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="command-palette-list" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="command-palette-empty">No matching commands</div>
          ) : (
            Array.from(groupedCommands.entries()).map(([category, cmds]) => (
              <div key={category} className="command-group">
                <div className="command-group-header">{category}</div>
                {cmds.map((cmd) => {
                  const globalIdx = getGlobalIndex(cmd);
                  return (
                    <div
                      key={cmd.id}
                      className={`command-item ${globalIdx === selectedIndex ? 'selected' : ''}`}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(globalIdx)}
                    >
                      <div className="command-item-content">
                        <span className="command-label">{cmd.label}</span>
                        {cmd.description && (
                          <span className="command-description">
                            {cmd.description}
                          </span>
                        )}
                      </div>
                      {cmd.shortcut && (
                        <span className="command-shortcut">{cmd.shortcut}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="command-palette-footer">
          <span className="command-hint">
            <kbd>↑</kbd><kbd>↓</kbd> navigate
          </span>
          <span className="command-hint">
            <kbd>Enter</kbd> select
          </span>
          <span className="command-hint">
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
