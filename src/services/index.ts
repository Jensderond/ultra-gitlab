/**
 * Service layer exports.
 *
 * Re-exports all service functions for convenient importing.
 */

// Transport layer (environment detection)
export { isTauri, tauriListen, openExternalUrl } from './transport';

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
  getTokenInfo,
  updateInstanceToken,
  getMergeRequests,
  getMergeRequest,
  listMyMergeRequests,
  getMrReviewers,
  getDiffFiles,
  getDiffFileContent,
  getDiffFileMetadata,
  getDiffHunks,
  getComments,
  addComment,
  replyToComment,
  resolveDiscussion,
  deleteComment,
  approveMR,
  unapproveMR,
  mergeMR,
  checkMergeStatus,
  rebaseMR,
  triggerSync,
  getSyncStatus,
  retryFailedAction,
  discardFailedAction,
  getGitattributes,
  refreshGitattributes,
  getSettings,
  updateSettings,
  getCollapsePatterns,
  updateCollapsePatterns,
  getMemoryStats,
  getCacheStats,
  getDiagnosticsReport,
  generateTestData,
  clearTestData,
  listPipelineProjects,
  visitPipelineProject,
  togglePinPipelineProject,
  removePipelineProject,
  searchProjects,
  getPipelineStatuses,
  getNotificationSettings,
  updateNotificationSettings,
  sendNativeNotification,
  getJobTrace,
  updateTheme,
  updateUiFont,
  updateDiffsFont,
  updateCustomThemeColors,
  type CustomThemeColors,
  type SystemFont,
  listSystemFonts,
  getCompanionSettings,
  updateCompanionSettings,
  regenerateCompanionPin,
  revokeCompanionDevice,
  startCompanionServer,
  stopCompanionServer,
  getCompanionStatus,
  getAvatar,
  getAvatars,
  updateSessionCookie,
  refreshAvatars,
  resolveMrByWebUrl,
  fetchMrByWebUrl,
} from './tauri';

// GitLab operations (high-level)
export * from './gitlab';

// Storage and sync operations
export * from './storage';
