/**
 * React context for custom keyboard shortcuts.
 *
 * Provides shortcut bindings (getKey, setBinding, etc.) via context.
 * Event matching is handled by @tanstack/react-hotkeys useHotkey().
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
