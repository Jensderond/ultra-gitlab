/**
 * Hook for managing custom keyboard shortcuts.
 *
 * Provides the current shortcut configuration, merging user customizations
 * with default shortcuts.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadSettings, saveSettings } from '../services/storage';
import {
  defaultShortcuts,
  type ShortcutDefinition,
} from '../config/shortcuts';

export interface UseCustomShortcutsResult {
  /** All shortcuts with user customizations applied */
  shortcuts: ShortcutDefinition[];
  /** User's custom key bindings (shortcut id -> key) */
  customBindings: Record<string, string>;
  /** Whether shortcuts are still loading */
  loading: boolean;
  /** Get the key for a specific shortcut (custom or default) */
  getKey: (shortcutId: string) => string | undefined;
  /** Update a shortcut's key binding */
  setBinding: (shortcutId: string, key: string) => Promise<void>;
  /** Reset a shortcut to its default key */
  resetBinding: (shortcutId: string) => Promise<void>;
  /** Reset all shortcuts to defaults */
  resetAllBindings: () => Promise<void>;
  /** Whether a key is already in use by another shortcut */
  isKeyInUse: (key: string, excludeId?: string) => boolean;
}

/**
 * Hook for reading and updating custom keyboard shortcuts.
 *
 * Merges user customizations with default shortcuts and provides
 * functions for updating bindings.
 */
export default function useCustomShortcuts(): UseCustomShortcutsResult {
  const [customBindings, setCustomBindings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Load custom bindings on mount
  useEffect(() => {
    async function load() {
      try {
        const settings = await loadSettings();
        setCustomBindings(settings.keyboardShortcuts || {});
      } catch (err) {
        console.error('Failed to load shortcuts:', err);
        setCustomBindings({});
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Merge default shortcuts with custom bindings
  const shortcuts = useMemo<ShortcutDefinition[]>(() => {
    return defaultShortcuts.map((shortcut) => ({
      ...shortcut,
      defaultKey: customBindings[shortcut.id] || shortcut.defaultKey,
    }));
  }, [customBindings]);

  // Get the key for a specific shortcut
  const getKey = useCallback(
    (shortcutId: string): string | undefined => {
      // First check custom bindings
      if (customBindings[shortcutId]) {
        return customBindings[shortcutId];
      }
      // Fall back to default
      const shortcut = defaultShortcuts.find((s) => s.id === shortcutId);
      return shortcut?.defaultKey;
    },
    [customBindings]
  );

  // Check if a key is already in use
  const isKeyInUse = useCallback(
    (key: string, excludeId?: string): boolean => {
      for (const shortcut of shortcuts) {
        if (shortcut.id === excludeId) continue;
        const currentKey = customBindings[shortcut.id] || shortcut.defaultKey;
        if (currentKey.toLowerCase() === key.toLowerCase()) {
          return true;
        }
      }
      return false;
    },
    [shortcuts, customBindings]
  );

  // Update a shortcut's key binding
  const setBinding = useCallback(
    async (shortcutId: string, key: string): Promise<void> => {
      const newBindings = { ...customBindings, [shortcutId]: key };
      setCustomBindings(newBindings);

      try {
        await saveSettings({ keyboardShortcuts: newBindings });
      } catch (err) {
        console.error('Failed to save shortcut:', err);
        // Revert on error
        setCustomBindings(customBindings);
        throw err;
      }
    },
    [customBindings]
  );

  // Reset a shortcut to its default
  const resetBinding = useCallback(
    async (shortcutId: string): Promise<void> => {
      const { [shortcutId]: _, ...newBindings } = customBindings;
      setCustomBindings(newBindings);

      try {
        await saveSettings({ keyboardShortcuts: newBindings });
      } catch (err) {
        console.error('Failed to reset shortcut:', err);
        // Revert on error
        setCustomBindings(customBindings);
        throw err;
      }
    },
    [customBindings]
  );

  // Reset all shortcuts to defaults
  const resetAllBindings = useCallback(async (): Promise<void> => {
    setCustomBindings({});

    try {
      await saveSettings({ keyboardShortcuts: {} });
    } catch (err) {
      console.error('Failed to reset all shortcuts:', err);
      // Revert on error
      setCustomBindings(customBindings);
      throw err;
    }
  }, [customBindings]);

  return {
    shortcuts,
    customBindings,
    loading,
    getKey,
    setBinding,
    resetBinding,
    resetAllBindings,
    isKeyInUse,
  };
}
