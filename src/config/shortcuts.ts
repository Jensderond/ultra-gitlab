/**
 * Default keyboard shortcuts configuration.
 *
 * This file defines the default keyboard shortcuts for the application.
 * Users can customize these via the Settings page.
 */

/**
 * Shortcut definition with display information.
 */
export interface ShortcutDefinition {
  /** Unique identifier for the shortcut */
  id: string;
  /** Human-readable description of what the shortcut does */
  description: string;
  /** Default key combination (e.g., "j", "Cmd+P", "Shift+Enter") */
  defaultKey: string;
  /** Category for grouping in the help overlay */
  category: ShortcutCategory;
  /** Context where this shortcut is active */
  context: ShortcutContext;
}

/**
 * Categories for organizing shortcuts in the help overlay.
 */
export type ShortcutCategory =
  | 'navigation'
  | 'list'
  | 'diff'
  | 'review'
  | 'sync'
  | 'global';

/**
 * Context where a shortcut is active.
 */
export type ShortcutContext =
  | 'global'
  | 'mr-list'
  | 'mr-detail'
  | 'diff-viewer'
  | 'settings';

/**
 * Category labels for display.
 */
export const categoryLabels: Record<ShortcutCategory, string> = {
  navigation: 'Navigation',
  list: 'MR List',
  diff: 'Diff Viewer',
  review: 'Review Actions',
  sync: 'Sync',
  global: 'Global',
};

/**
 * All default keyboard shortcuts.
 */
export const defaultShortcuts: ShortcutDefinition[] = [
  // Global shortcuts
  {
    id: 'command-palette',
    description: 'Open command palette',
    defaultKey: 'Cmd+P',
    category: 'global',
    context: 'global',
  },
  {
    id: 'keyboard-help',
    description: 'Show keyboard shortcuts',
    defaultKey: '?',
    category: 'global',
    context: 'global',
  },
  {
    id: 'open-settings',
    description: 'Open settings',
    defaultKey: 'Cmd+,',
    category: 'global',
    context: 'global',
  },
  {
    id: 'trigger-sync',
    description: 'Sync with GitLab',
    defaultKey: 'Cmd+R',
    category: 'sync',
    context: 'global',
  },
  {
    id: 'go-back',
    description: 'Go back / close panel',
    defaultKey: 'Escape',
    category: 'navigation',
    context: 'global',
  },

  // MR List shortcuts
  {
    id: 'select-next',
    description: 'Select next MR',
    defaultKey: 'j',
    category: 'list',
    context: 'mr-list',
  },
  {
    id: 'select-previous',
    description: 'Select previous MR',
    defaultKey: 'k',
    category: 'list',
    context: 'mr-list',
  },
  {
    id: 'select-next-arrow',
    description: 'Select next MR',
    defaultKey: '↓',
    category: 'list',
    context: 'mr-list',
  },
  {
    id: 'select-previous-arrow',
    description: 'Select previous MR',
    defaultKey: '↑',
    category: 'list',
    context: 'mr-list',
  },
  {
    id: 'open-mr',
    description: 'Open selected MR',
    defaultKey: 'Enter',
    category: 'list',
    context: 'mr-list',
  },

  // Diff viewer shortcuts
  {
    id: 'next-file',
    description: 'Next file',
    defaultKey: 'n',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'prev-file',
    description: 'Previous file',
    defaultKey: 'p',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'next-change',
    description: 'Next change',
    defaultKey: ']',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'prev-change',
    description: 'Previous change',
    defaultKey: '[',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'toggle-view-mode',
    description: 'Toggle unified/split view',
    defaultKey: 'x',
    category: 'diff',
    context: 'diff-viewer',
  },

  // Review shortcuts
  {
    id: 'approve',
    description: 'Approve MR',
    defaultKey: 'a',
    category: 'review',
    context: 'mr-detail',
  },
  {
    id: 'add-comment',
    description: 'Add comment at line',
    defaultKey: 'c',
    category: 'review',
    context: 'diff-viewer',
  },
  {
    id: 'reply-comment',
    description: 'Reply to comment',
    defaultKey: 'r',
    category: 'review',
    context: 'diff-viewer',
  },
];

/**
 * Get shortcuts for a specific context.
 */
export function getShortcutsForContext(context: ShortcutContext): ShortcutDefinition[] {
  return defaultShortcuts.filter(
    (s) => s.context === context || s.context === 'global'
  );
}

/**
 * Get shortcuts grouped by category.
 */
export function getShortcutsByCategory(): Map<ShortcutCategory, ShortcutDefinition[]> {
  const grouped = new Map<ShortcutCategory, ShortcutDefinition[]>();

  for (const shortcut of defaultShortcuts) {
    if (!grouped.has(shortcut.category)) {
      grouped.set(shortcut.category, []);
    }
    grouped.get(shortcut.category)!.push(shortcut);
  }

  return grouped;
}

/**
 * Format a key for display.
 * Converts modifier keys to symbols.
 */
export function formatKey(key: string): string {
  return key
    .replace(/Cmd\+/g, '⌘')
    .replace(/Command\+/g, '⌘')
    .replace(/Ctrl\+/g, '⌃')
    .replace(/Control\+/g, '⌃')
    .replace(/Alt\+/g, '⌥')
    .replace(/Option\+/g, '⌥')
    .replace(/Shift\+/g, '⇧')
    .replace(/Enter/g, '↵')
    .replace(/Escape/g, 'Esc');
}
