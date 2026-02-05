/**
 * Service layer exports.
 *
 * Re-exports all service functions for convenient importing.
 */

// Tauri invoke wrappers (low-level)
// Note: getFileContent is excluded here because gitlab.ts provides the high-level wrapper
export {
  invoke,
  type TauriError,
  type SetupInstanceResponse,
  type GitLabInstanceWithStatus,
  setupGitLabInstance,
  getGitLabInstances,
  deleteGitLabInstance,
  getMergeRequests,
  getMergeRequest,
  getDiffFiles,
  getDiffFileContent,
  getDiffFileMetadata,
  getDiffHunks,
  getComments,
  addComment,
  replyToComment,
  resolveDiscussion,
  approveMR,
  unapproveMR,
  triggerSync,
  getSyncStatus,
  retryFailedAction,
  discardFailedAction,
  getSettings,
  updateSettings,
  getMemoryStats,
  getCacheStats,
  getDiagnosticsReport,
  generateTestData,
  clearTestData,
} from './tauri';

// GitLab operations (high-level)
export * from './gitlab';

// Storage and sync operations
export * from './storage';
