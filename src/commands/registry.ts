/**
 * Command registry defining all available actions in the app.
 *
 * Commands are organized by category and can be accessed via:
 * - Command palette (Cmd+P)
 * - Keyboard shortcuts
 * - UI interactions
 */

import type { Command } from '../components/CommandPalette';

/**
 * Command categories for organization in the palette.
 */
export const CommandCategory = {
  Navigation: 'Navigation',
  MergeRequest: 'Merge Request',
  Review: 'Review',
  Pipelines: 'Pipelines',
  Sync: 'Sync',
  Settings: 'Settings',
} as const;

export type CommandCategory = (typeof CommandCategory)[keyof typeof CommandCategory];

/**
 * Command IDs for programmatic access.
 */
export const CommandId = {
  // Navigation
  GoToMRList: 'navigation.go-to-mr-list',
  GoToMyMRs: 'navigation.go-to-my-mrs',
  GoToPipelines: 'navigation.go-to-pipelines',
  GoToSettings: 'navigation.go-to-settings',
  GoBack: 'navigation.go-back',
  NextFile: 'navigation.next-file',
  PreviousFile: 'navigation.previous-file',
  NextChange: 'navigation.next-change',
  PreviousChange: 'navigation.previous-change',

  // MR List
  SelectNextMR: 'mr-list.select-next',
  SelectPreviousMR: 'mr-list.select-previous',
  OpenSelectedMR: 'mr-list.open-selected',
  FilterOpenMRs: 'mr-list.filter-open',
  FilterMergedMRs: 'mr-list.filter-merged',
  FilterClosedMRs: 'mr-list.filter-closed',
  FilterAllMRs: 'mr-list.filter-all',

  // Review Actions
  ApproveMR: 'review.approve',
  UnapproveMR: 'review.unapprove',
  AddComment: 'review.add-comment',
  ReplyToComment: 'review.reply',
  ResolveDiscussion: 'review.resolve',

  // Sync
  TriggerSync: 'sync.trigger',
  RetryFailedActions: 'sync.retry-failed',
  ViewSyncLog: 'sync.view-log',

  // Settings
  OpenSettings: 'settings.open',
  ToggleTheme: 'settings.toggle-theme',

  // View
  ToggleDiffViewMode: 'view.toggle-diff-mode',
  ShowKeyboardHelp: 'view.keyboard-help',
  OpenCommandPalette: 'view.command-palette',
} as const;

export type CommandId = (typeof CommandId)[keyof typeof CommandId];

/**
 * Command definition with metadata.
 */
export interface CommandDefinition {
  id: CommandId;
  label: string;
  description?: string;
  shortcut?: string;
  category: CommandCategory;
  /** Whether this command is available in a given context */
  isAvailable?: () => boolean;
}

/**
 * All command definitions.
 * Actions are bound at runtime based on the current context.
 */
export const commandDefinitions: CommandDefinition[] = [
  // Navigation
  {
    id: CommandId.GoToMRList,
    label: 'Go to Merge Requests',
    description: 'View the list of merge requests',
    shortcut: 'Cmd+L',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.GoToMyMRs,
    label: 'Go to My MRs',
    description: 'View your authored merge requests',
    shortcut: 'Cmd+M',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.GoToPipelines,
    label: 'Go to Pipelines',
    description: 'View pipeline status dashboard',
    shortcut: 'Cmd+I',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.GoToSettings,
    label: 'Go to Settings',
    description: 'Open application settings',
    category: CommandCategory.Settings,
  },
  {
    id: CommandId.GoBack,
    label: 'Go Back',
    description: 'Navigate to previous page',
    shortcut: 'Escape',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.NextFile,
    label: 'Next File',
    description: 'View the next file in the diff',
    shortcut: 'n',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.PreviousFile,
    label: 'Previous File',
    description: 'View the previous file in the diff',
    shortcut: 'p',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.NextChange,
    label: 'Next Change',
    description: 'Jump to the next change in the file',
    shortcut: ']',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.PreviousChange,
    label: 'Previous Change',
    description: 'Jump to the previous change in the file',
    shortcut: '[',
    category: CommandCategory.Navigation,
  },

  // MR List
  {
    id: CommandId.SelectNextMR,
    label: 'Select Next MR',
    description: 'Move selection down in the list',
    shortcut: 'j',
    category: CommandCategory.MergeRequest,
  },
  {
    id: CommandId.SelectPreviousMR,
    label: 'Select Previous MR',
    description: 'Move selection up in the list',
    shortcut: 'k',
    category: CommandCategory.MergeRequest,
  },
  {
    id: CommandId.OpenSelectedMR,
    label: 'Open Selected MR',
    description: 'Open the currently selected merge request',
    shortcut: 'Enter',
    category: CommandCategory.MergeRequest,
  },
  {
    id: CommandId.FilterOpenMRs,
    label: 'Show Open MRs',
    description: 'Filter to show only open merge requests',
    category: CommandCategory.MergeRequest,
  },
  {
    id: CommandId.FilterMergedMRs,
    label: 'Show Merged MRs',
    description: 'Filter to show only merged merge requests',
    category: CommandCategory.MergeRequest,
  },
  {
    id: CommandId.FilterClosedMRs,
    label: 'Show Closed MRs',
    description: 'Filter to show only closed merge requests',
    category: CommandCategory.MergeRequest,
  },
  {
    id: CommandId.FilterAllMRs,
    label: 'Show All MRs',
    description: 'Show all merge requests regardless of state',
    category: CommandCategory.MergeRequest,
  },

  // Review Actions
  {
    id: CommandId.ApproveMR,
    label: 'Approve MR',
    description: 'Approve the current merge request',
    shortcut: 'a',
    category: CommandCategory.Review,
  },
  {
    id: CommandId.UnapproveMR,
    label: 'Remove Approval',
    description: 'Remove your approval from the merge request',
    category: CommandCategory.Review,
  },
  {
    id: CommandId.AddComment,
    label: 'Add Comment',
    description: 'Add a comment at the current line',
    shortcut: 'c',
    category: CommandCategory.Review,
  },
  {
    id: CommandId.ReplyToComment,
    label: 'Reply to Comment',
    description: 'Reply to the current discussion',
    shortcut: 'r',
    category: CommandCategory.Review,
  },
  {
    id: CommandId.ResolveDiscussion,
    label: 'Resolve Discussion',
    description: 'Mark the current discussion as resolved',
    category: CommandCategory.Review,
  },

  // Sync
  {
    id: CommandId.TriggerSync,
    label: 'Sync Now',
    description: 'Trigger a manual sync with GitLab',
    shortcut: 'Cmd+R',
    category: CommandCategory.Sync,
  },
  {
    id: CommandId.RetryFailedActions,
    label: 'Retry Failed Actions',
    description: 'Retry all failed sync actions',
    category: CommandCategory.Sync,
  },
  {
    id: CommandId.ViewSyncLog,
    label: 'View Sync Log',
    description: 'Show recent sync operations',
    category: CommandCategory.Sync,
  },

  // Settings
  {
    id: CommandId.OpenSettings,
    label: 'Open Settings',
    description: 'Open application settings',
    shortcut: 'Cmd+,',
    category: CommandCategory.Settings,
  },
  {
    id: CommandId.ToggleTheme,
    label: 'Toggle Dark Mode',
    description: 'Switch between light and dark themes',
    category: CommandCategory.Settings,
  },

  // View
  {
    id: CommandId.ToggleDiffViewMode,
    label: 'Toggle Diff View',
    description: 'Switch between unified and split diff view',
    shortcut: 'd',
    category: CommandCategory.Navigation,
  },
  {
    id: CommandId.ShowKeyboardHelp,
    label: 'Show Keyboard Shortcuts',
    description: 'Display all keyboard shortcuts',
    shortcut: '?',
    category: CommandCategory.Settings,
  },
  {
    id: CommandId.OpenCommandPalette,
    label: 'Open Command Palette',
    description: 'Open the command palette',
    shortcut: 'Cmd+P',
    category: CommandCategory.Navigation,
  },
];

/**
 * Create command objects with bound actions.
 *
 * @param actionMap Map of command IDs to action functions
 * @returns Array of Command objects for the palette
 */
export function createCommands(
  actionMap: Partial<Record<CommandId, () => void>>
): Command[] {
  return commandDefinitions
    .filter((def) => actionMap[def.id] !== undefined)
    .map((def) => ({
      id: def.id,
      label: def.label,
      description: def.description,
      shortcut: def.shortcut,
      category: def.category,
      action: actionMap[def.id]!,
    }));
}

/**
 * Get a command definition by ID.
 */
export function getCommandById(id: CommandId): CommandDefinition | undefined {
  return commandDefinitions.find((def) => def.id === id);
}

/**
 * Get all commands in a category.
 */
export function getCommandsByCategory(
  category: CommandCategory
): CommandDefinition[] {
  return commandDefinitions.filter((def) => def.category === category);
}

/**
 * Get the shortcut for a command.
 */
export function getCommandShortcut(id: CommandId): string | undefined {
  return getCommandById(id)?.shortcut;
}
