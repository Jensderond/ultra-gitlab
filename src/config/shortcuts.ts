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
  | 'my-mr-detail'
  | 'diff-viewer'
  | 'pipelines'
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
    id: 'go-to-mr-list',
    description: 'Go to MR list',
    defaultKey: 'Cmd+L',
    category: 'navigation',
    context: 'global',
  },
  {
    id: 'go-to-my-mrs',
    description: 'Go to My MRs',
    defaultKey: 'Cmd+M',
    category: 'navigation',
    context: 'global',
  },
  {
    id: 'go-to-pipelines',
    description: 'Go to Pipelines',
    defaultKey: 'Cmd+I',
    category: 'navigation',
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
    defaultKey: 'j / ↓',
    category: 'list',
    context: 'mr-list',
  },
  {
    id: 'select-previous',
    description: 'Select previous MR',
    defaultKey: 'k / ↑',
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
  {
    id: 'search-filter',
    description: 'Search / Filter',
    defaultKey: 'Cmd+F',
    category: 'list',
    context: 'mr-list',
  },

  // Diff viewer shortcuts
  {
    id: 'next-file',
    description: 'Next file',
    defaultKey: 'n / j / ↓',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'prev-file',
    description: 'Previous file',
    defaultKey: 'p / k / ↑',
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
  {
    id: 'next-change',
    description: 'Next change in file',
    defaultKey: ']',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'prev-change',
    description: 'Previous change in file',
    defaultKey: '[',
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
  {
    id: 'copy-mr-link',
    description: 'Copy MR link',
    defaultKey: 'y',
    category: 'review',
    context: 'mr-detail',
  },
  {
    id: 'open-in-browser',
    description: 'Open MR in browser',
    defaultKey: 'o',
    category: 'review',
    context: 'mr-detail',
  },
  {
    id: 'mark-viewed',
    description: 'Mark file as viewed & next',
    defaultKey: 'v',
    category: 'review',
    context: 'mr-detail',
  },
  {
    id: 'toggle-generated',
    description: 'Toggle generated files',
    defaultKey: 'g',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'filter-files',
    description: 'Filter files by name',
    defaultKey: '\\',
    category: 'diff',
    context: 'diff-viewer',
  },
  {
    id: 'add-suggestion',
    description: 'Add suggestion at line',
    defaultKey: 's',
    category: 'review',
    context: 'mr-detail',
  },

  // My MR Detail shortcuts
  {
    id: 'tab-overview',
    description: 'Switch to Overview tab',
    defaultKey: '1',
    category: 'navigation',
    context: 'my-mr-detail',
  },
  {
    id: 'tab-comments',
    description: 'Switch to Comments tab',
    defaultKey: '2',
    category: 'navigation',
    context: 'my-mr-detail',
  },
  {
    id: 'tab-code',
    description: 'Switch to Code tab',
    defaultKey: '3',
    category: 'navigation',
    context: 'my-mr-detail',
  },

  // Pipelines shortcuts
  {
    id: 'focus-search',
    description: 'Focus search',
    defaultKey: '/',
    category: 'navigation',
    context: 'pipelines',
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
 * Map a route pathname to the relevant shortcut contexts for that screen.
 * Returns contexts in priority order (most specific first).
 */
export function getContextsForRoute(pathname: string): ShortcutContext[] {
  if (/^\/my-mrs\/\d+/.test(pathname)) {
    return ['my-mr-detail', 'diff-viewer'];
  }
  if (/^\/mrs\/\d+/.test(pathname)) {
    return ['mr-detail', 'diff-viewer'];
  }
  if (pathname === '/mrs' || pathname === '/my-mrs') {
    return ['mr-list'];
  }
  if (pathname === '/pipelines') {
    return ['pipelines'];
  }
  if (pathname === '/settings') {
    return ['settings'];
  }
  return [];
}

/**
 * Get shortcuts grouped by category, with context-relevant categories sorted first.
 */
export function getShortcutsByCategoryForRoute(
  pathname: string
): Map<ShortcutCategory, ShortcutDefinition[]> {
  const activeContexts = new Set(getContextsForRoute(pathname));
  const grouped = getShortcutsByCategory();

  // Partition categories: those with shortcuts matching the active contexts first
  const contextCategories: [ShortcutCategory, ShortcutDefinition[]][] = [];
  const otherCategories: [ShortcutCategory, ShortcutDefinition[]][] = [];

  for (const [category, shortcuts] of grouped) {
    const hasContextShortcut = shortcuts.some((s) => activeContexts.has(s.context));
    if (hasContextShortcut) {
      contextCategories.push([category, shortcuts]);
    } else {
      otherCategories.push([category, shortcuts]);
    }
  }

  const result = new Map<ShortcutCategory, ShortcutDefinition[]>();
  for (const [cat, sc] of [...contextCategories, ...otherCategories]) {
    result.set(cat, sc);
  }
  return result;
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
