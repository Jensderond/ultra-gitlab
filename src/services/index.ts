/**
 * Service layer exports.
 *
 * Re-exports all service functions for convenient importing.
 */

// Tauri invoke wrappers (low-level)
export * from './tauri';

// GitLab operations (high-level)
export * from './gitlab';

// Storage and sync operations
export * from './storage';
