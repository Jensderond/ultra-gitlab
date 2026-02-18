/**
 * Storage service wrapper.
 *
 * This module provides access to sync status and local storage management,
 * wrapping the Tauri invoke calls with additional business logic.
 */

import {
  triggerSync,
  getSyncStatus,
  retryFailedAction,
  discardFailedAction,
  getSettings,
  updateSettings,
} from './tauri';
import type {
  SyncStatusResponse,
  Settings,
  SettingsUpdate,
  Theme,
} from '../types';

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Trigger a manual sync with GitLab.
 *
 * This will:
 * 1. Fetch new/updated MRs from GitLab
 * 2. Push any pending local actions (comments, approvals)
 */
export async function manualSync(): Promise<void> {
  return triggerSync();
}

/**
 * Get the current sync status.
 *
 * @returns Sync status including pending actions and recent logs
 */
export async function getSyncInfo(): Promise<SyncStatusResponse> {
  return getSyncStatus();
}

/**
 * Retry a failed sync action.
 *
 * @param actionId - The sync action ID to retry
 */
export async function retryAction(actionId: number): Promise<void> {
  return retryFailedAction(actionId);
}

/**
 * Discard a failed sync action.
 *
 * This permanently removes the action without syncing.
 *
 * @param actionId - The sync action ID to discard
 */
export async function discardAction(actionId: number): Promise<void> {
  return discardFailedAction(actionId);
}

// ============================================================================
// Settings Operations
// ============================================================================

/**
 * Get the current application settings.
 *
 * @returns The settings object
 */
export async function loadSettings(): Promise<Settings> {
  return getSettings();
}

/**
 * Update application settings.
 *
 * @param update - Partial settings to update
 * @returns The updated settings object
 */
export async function saveSettings(update: SettingsUpdate): Promise<Settings> {
  return updateSettings(update);
}

/**
 * Update the sync interval.
 *
 * @param minutes - Sync interval in minutes (minimum 1)
 */
export async function setSyncInterval(minutes: number): Promise<Settings> {
  const safeMinutes = Math.max(1, Math.round(minutes));
  return updateSettings({ syncIntervalMinutes: safeMinutes });
}

/**
 * Update the theme setting.
 *
 * @param theme - The theme ID to use
 */
export async function setTheme(
  theme: Theme
): Promise<Settings> {
  return updateSettings({ theme });
}

/**
 * Update the UI font setting.
 *
 * @param uiFont - The font family name to use for UI text
 */
export async function setUiFont(uiFont: string): Promise<Settings> {
  return updateSettings({ uiFont });
}

/**
 * Update the display font setting.
 *
 * @param displayFont - The font family name to use for display headings
 */
export async function setDisplayFont(displayFont: string): Promise<Settings> {
  return updateSettings({ displayFont });
}

/**
 * Update the diff view mode.
 *
 * @param mode - 'unified' or 'split'
 */
export async function setDiffViewMode(
  mode: 'unified' | 'split'
): Promise<Settings> {
  return updateSettings({ diffViewMode: mode });
}

/**
 * Update keyboard shortcuts.
 *
 * @param shortcuts - Record of action names to key bindings
 */
export async function setKeyboardShortcuts(
  shortcuts: Record<string, string>
): Promise<Settings> {
  return updateSettings({ keyboardShortcuts: shortcuts });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a timestamp for display.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns Formatted date/time string
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString();
}

/**
 * Format a relative time for display.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns Relative time string (e.g., "5 minutes ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) {
    return 'just now';
  }
  if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  if (diff < 604800) {
    const days = Math.floor(diff / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  return formatTimestamp(timestamp);
}
