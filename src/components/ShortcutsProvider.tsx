/**
 * React context for custom keyboard shortcuts.
 *
 * Loads custom bindings once and provides a matchesShortcut() helper
 * that keyboard handlers can use instead of hardcoding keys.
 */

import { createContext, useContext, type ReactNode } from 'react';
import useCustomShortcuts, { type UseCustomShortcutsResult } from '../hooks/useCustomShortcuts';

const ShortcutsContext = createContext<UseCustomShortcutsResult | null>(null);

export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const shortcuts = useCustomShortcuts();
  return (
    <ShortcutsContext.Provider value={shortcuts}>
      {children}
    </ShortcutsContext.Provider>
  );
}

/**
 * Access the shared shortcuts context.
 * Must be used within a ShortcutsProvider.
 */
export function useShortcuts(): UseCustomShortcutsResult {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) throw new Error('useShortcuts must be used within ShortcutsProvider');
  return ctx;
}

/**
 * Parse a shortcut key string (e.g. "Cmd+L") and test whether a
 * KeyboardEvent matches it.
 *
 * Supports: Cmd/Ctrl, Alt, Shift modifiers and any single key.
 * Also handles aliases separated by " / " (e.g. "n / j / ↓").
 */
export function matchesKey(keyString: string, e: KeyboardEvent): boolean {
  const aliases = keyString.split(' / ').map((k) => k.trim());
  return aliases.some((alias) => matchesSingleKey(alias, e));
}

function matchesSingleKey(keyString: string, e: KeyboardEvent): boolean {
  const parts = keyString.split('+');
  const key = parts.pop()!;
  const modifiers = new Set(parts.map((m) => m.toLowerCase()));

  const needCmd = modifiers.has('cmd') || modifiers.has('command');
  const needCtrl = modifiers.has('ctrl') || modifiers.has('control');
  const needAlt = modifiers.has('alt') || modifiers.has('option');
  const needShift = modifiers.has('shift');

  // Cmd matches either metaKey or ctrlKey (cross-platform)
  const cmdOrCtrl = e.metaKey || e.ctrlKey;
  if (needCmd && !cmdOrCtrl) return false;
  if (needCtrl && !e.ctrlKey) return false;
  if (needAlt && !e.altKey) return false;
  if (needShift && !e.shiftKey) return false;

  // If no modifier expected, ensure none pressed
  if (!needCmd && !needCtrl && (e.metaKey || e.ctrlKey)) return false;
  if (!needAlt && e.altKey) return false;
  // Don't check shiftKey for single char keys (user may type uppercase)

  // Match the key itself
  const eventKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const expectedKey = key.length === 1 ? key.toUpperCase() : key;

  // Map special display names to event keys
  const keyMap: Record<string, string> = {
    '↓': 'ArrowDown',
    '↑': 'ArrowUp',
    '→': 'ArrowRight',
    '←': 'ArrowLeft',
    '↵': 'Enter',
    'Esc': 'Escape',
  };

  const normalizedExpected = keyMap[expectedKey] || expectedKey;
  const normalizedEvent = keyMap[eventKey] || eventKey;

  return normalizedEvent === normalizedExpected;
}
