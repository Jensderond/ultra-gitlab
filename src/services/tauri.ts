/**
 * Typed Tauri invoke wrapper.
 *
 * This module provides type-safe wrappers for Tauri IPC calls,
 * handling the communication between React frontend and Rust backend.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  GitLabInstance,
  GitLabInstanceSetup,
  TokenInfo,
  MergeRequest,
  MRFilter,
  MrReviewer,
  DiffFile,
  DiffFileContent,
  DiffFileMetadata,
  DiffHunksResponse,
  DiffRefs,
  CachedFilePair,
  Comment,
  AddCommentRequest,
  ReplyToCommentRequest,
  ResolveDiscussionRequest,
  SyncStatusResponse,
  Settings,
  SettingsUpdate,
  MemoryStats,
  CacheStats,
  DiagnosticsReport,
  TestDataResult,
  PipelineProject,
  PipelineStatus,
  ProjectSearchResult,
  NotificationSettings,
} from '../types';

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Error returned from Tauri backend.
 */
export interface TauriError {
  type: string;
  details: Record<string, unknown>;
}

/**
 * Parse Tauri error response.
 */
function parseError(error: unknown): Error {
  if (error && typeof error === 'object' && 'type' in error) {
    const tauriError = error as TauriError;
    const message = (tauriError.details as { message?: string })?.message || tauriError.type;
    return new Error(message);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

/**
 * Type-safe invoke wrapper with error handling.
 * Exported for custom commands not covered by typed wrappers.
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    throw parseError(error);
  }
}

// ============================================================================
// Authentication Commands
// ============================================================================

export interface SetupInstanceResponse {
  instance: GitLabInstance;
  username: string;
}

export interface GitLabInstanceWithStatus extends GitLabInstance {
  hasToken: boolean;
}

/**
 * Set up a new GitLab instance.
 */
export async function setupGitLabInstance(
  input: GitLabInstanceSetup
): Promise<SetupInstanceResponse> {
  return invoke<SetupInstanceResponse>('setup_gitlab_instance', { input });
}

/**
 * Get all configured GitLab instances.
 */
export async function getGitLabInstances(): Promise<GitLabInstanceWithStatus[]> {
  return invoke<GitLabInstanceWithStatus[]>('get_gitlab_instances');
}

/**
 * Delete a GitLab instance.
 */
export async function deleteGitLabInstance(instanceId: number): Promise<void> {
  return invoke<void>('delete_gitlab_instance', { instanceId });
}

/**
 * Get token info (expiration, scopes, etc.) for a GitLab instance.
 */
export async function getTokenInfo(instanceId: number): Promise<TokenInfo> {
  return invoke<TokenInfo>('get_token_info', { instanceId });
}

/**
 * Update the personal access token for a GitLab instance.
 * Validates the token and returns the authenticated username.
 */
export async function updateInstanceToken(instanceId: number, token: string): Promise<string> {
  return invoke<string>('update_instance_token', { instanceId, token });
}

// ============================================================================
// Merge Request Commands
// ============================================================================

/**
 * Get merge requests from local cache.
 */
export async function getMergeRequests(
  instanceId: number,
  filter?: MRFilter
): Promise<MergeRequest[]> {
  return invoke<MergeRequest[]>('get_merge_requests', { instanceId, filter });
}

/**
 * Get a single merge request by ID.
 */
export async function getMergeRequest(mrId: number): Promise<MergeRequest> {
  const response = await invoke<{ mr: MergeRequest }>('get_merge_request_detail', { mrId });
  return response.mr;
}

/**
 * Get diff files for a merge request.
 */
export async function getDiffFiles(mrId: number): Promise<DiffFile[]> {
  return invoke<DiffFile[]>('get_diff_files', { mrId });
}

/**
 * Get diff content for a specific file with syntax highlighting.
 */
export async function getDiffFileContent(
  mrId: number,
  filePath: string
): Promise<DiffFileContent> {
  return invoke<DiffFileContent>('get_diff_file', { mrId, filePath });
}

/**
 * Get metadata about a diff file for progressive loading.
 */
export async function getDiffFileMetadata(
  mrId: number,
  filePath: string
): Promise<DiffFileMetadata> {
  return invoke<DiffFileMetadata>('get_diff_file_metadata', { mrId, filePath });
}

/**
 * Get a range of diff hunks for progressive loading.
 */
export async function getDiffHunks(
  mrId: number,
  filePath: string,
  start: number,
  count: number
): Promise<DiffHunksResponse> {
  return invoke<DiffHunksResponse>('get_diff_hunks', { mrId, filePath, start, count });
}

/**
 * Get raw file content at a specific SHA.
 * Used by Monaco diff viewer to get original and modified file contents.
 */
export async function getFileContent(
  instanceId: number,
  projectId: number,
  filePath: string,
  sha: string
): Promise<string> {
  return invoke<string>('get_file_content', { instanceId, projectId, filePath, sha });
}

/**
 * Get binary file content as base64 at a specific SHA.
 * Used by image diff viewer to get original and modified images.
 */
export async function getFileContentBase64(
  instanceId: number,
  projectId: number,
  filePath: string,
  sha: string
): Promise<string> {
  return invoke<string>('get_file_content_base64', { instanceId, projectId, filePath, sha });
}

/**
 * Get diff refs (SHA values) for a merge request.
 * Used to fetch original and modified file content for Monaco diff viewer.
 */
export async function getDiffRefs(mrId: number): Promise<DiffRefs> {
  return invoke<DiffRefs>('get_diff_refs', { mrId });
}

/**
 * Get merge requests authored by the current user.
 */
export async function listMyMergeRequests(
  instanceId: number
): Promise<MergeRequest[]> {
  return invoke<MergeRequest[]>('list_my_merge_requests', { instanceId });
}

/**
 * Get per-reviewer approval statuses for a merge request.
 */
export async function getMrReviewers(mrId: number): Promise<MrReviewer[]> {
  return invoke<MrReviewer[]>('get_mr_reviewers', { mrId });
}

/**
 * Get cached file content pair (base + head) from local cache.
 * Returns null values for cache misses, signaling fallback to network fetch.
 */
export async function getCachedFilePair(
  mrId: number,
  filePath: string
): Promise<CachedFilePair> {
  return invoke<CachedFilePair>('get_cached_file_pair', { mrId, filePath });
}

/**
 * Merge a merge request via the GitLab API.
 */
export async function mergeMR(mrId: number): Promise<void> {
  return invoke<void>('merge_mr', { mrId });
}

/**
 * Check the merge status of an MR from GitLab.
 * Returns detailed_merge_status: "mergeable", "need_rebase", "conflict", etc.
 */
export async function checkMergeStatus(mrId: number): Promise<string> {
  return invoke<string>('check_merge_status', { mrId });
}

/**
 * Rebase a merge request's source branch via GitLab.
 */
export async function rebaseMR(mrId: number): Promise<void> {
  return invoke<void>('rebase_mr', { mrId });
}

// ============================================================================
// Comment Commands
// ============================================================================

/**
 * Get comments for a merge request.
 */
export async function getComments(mrId: number): Promise<Comment[]> {
  return invoke<Comment[]>('get_comments', { mrId });
}

/**
 * Add a new comment to a merge request.
 */
export async function addComment(request: AddCommentRequest): Promise<Comment> {
  return invoke<Comment>('add_comment', { input: request });
}

/**
 * Reply to an existing discussion.
 */
export async function replyToComment(request: ReplyToCommentRequest): Promise<Comment> {
  return invoke<Comment>('reply_to_comment', { input: request });
}

/**
 * Resolve or unresolve a discussion.
 */
export async function resolveDiscussion(request: ResolveDiscussionRequest): Promise<void> {
  return invoke<void>('resolve_discussion', { input: request });
}

// ============================================================================
// Approval Commands
// ============================================================================

/**
 * Approve a merge request.
 */
export async function approveMR(mrId: number): Promise<void> {
  return invoke<void>('approve_mr', { mrId });
}

/**
 * Unapprove a merge request.
 */
export async function unapproveMR(mrId: number): Promise<void> {
  return invoke<void>('unapprove_mr', { mrId });
}

// ============================================================================
// Sync Commands
// ============================================================================

/**
 * Trigger a manual sync.
 */
export async function triggerSync(): Promise<void> {
  return invoke<void>('trigger_sync');
}

/**
 * Get current sync status.
 */
export async function getSyncStatus(): Promise<SyncStatusResponse> {
  return invoke<SyncStatusResponse>('get_sync_status');
}

/**
 * Retry a failed sync action.
 */
export async function retryFailedAction(actionId: number): Promise<void> {
  return invoke<void>('retry_failed_action', { actionId });
}

/**
 * Discard a failed sync action.
 */
export async function discardFailedAction(actionId: number): Promise<void> {
  return invoke<void>('discard_failed_action', { actionId });
}

// ============================================================================
// Gitattributes Commands
// ============================================================================

/**
 * Get cached gitattributes patterns for a project.
 * Returns empty array if no cache exists.
 */
export async function getGitattributes(
  instanceId: number,
  projectId: number
): Promise<string[]> {
  return invoke<string[]>('get_gitattributes', { instanceId, projectId });
}

/**
 * Fetch .gitattributes from GitLab and update the local cache.
 * Returns the parsed linguist-generated patterns.
 */
export async function refreshGitattributes(
  instanceId: number,
  projectId: number
): Promise<string[]> {
  return invoke<string[]>('refresh_gitattributes', { instanceId, projectId });
}

// ============================================================================
// Settings Commands
// ============================================================================

/**
 * Get current settings.
 */
export async function getSettings(): Promise<Settings> {
  return invoke<Settings>('get_settings');
}

/**
 * Update settings.
 */
export async function updateSettings(update: SettingsUpdate): Promise<Settings> {
  return invoke<Settings>('update_settings', { update });
}

// ============================================================================
// Collapse Patterns Commands
// ============================================================================

/**
 * Get the current collapse patterns for dimming generated files.
 */
export async function getCollapsePatterns(): Promise<string[]> {
  return invoke<string[]>('get_collapse_patterns');
}

/**
 * Update collapse patterns.
 */
export async function updateCollapsePatterns(patterns: string[]): Promise<void> {
  return invoke<void>('update_collapse_patterns', { patterns });
}

// ============================================================================
// Diagnostics Commands (Memory and Performance Verification)
// ============================================================================

/**
 * Get current memory usage statistics.
 */
export async function getMemoryStats(): Promise<MemoryStats> {
  return invoke<MemoryStats>('get_memory_stats');
}

/**
 * Get database cache statistics.
 */
export async function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>('get_cache_stats');
}

/**
 * Get a full diagnostics report.
 */
export async function getDiagnosticsReport(): Promise<DiagnosticsReport> {
  return invoke<DiagnosticsReport>('get_diagnostics_report');
}

/**
 * Generate test data for memory verification.
 * Creates realistic test MRs with diffs and comments.
 */
export async function generateTestData(mrCount?: number): Promise<TestDataResult> {
  return invoke<TestDataResult>('generate_test_data', { mrCount });
}

/**
 * Clear all test data (MRs with IDs >= 1,000,000).
 */
export async function clearTestData(): Promise<number> {
  return invoke<number>('clear_test_data');
}

// ============================================================================
// Pipeline Dashboard Commands
// ============================================================================

/**
 * List tracked pipeline projects for an instance.
 */
export async function listPipelineProjects(instanceId: number): Promise<PipelineProject[]> {
  return invoke<PipelineProject[]>('list_pipeline_projects', { instanceId });
}

/**
 * Visit (add/touch) a pipeline project on the dashboard.
 */
export async function visitPipelineProject(instanceId: number, projectId: number): Promise<void> {
  return invoke<void>('visit_pipeline_project', { instanceId, projectId });
}

/**
 * Toggle pin state of a pipeline project.
 */
export async function togglePinPipelineProject(instanceId: number, projectId: number): Promise<void> {
  return invoke<void>('toggle_pin_pipeline_project', { instanceId, projectId });
}

/**
 * Remove a pipeline project from the dashboard.
 */
export async function removePipelineProject(instanceId: number, projectId: number): Promise<void> {
  return invoke<void>('remove_pipeline_project', { instanceId, projectId });
}

/**
 * Search for projects with local cache + GitLab API fallback.
 */
export async function searchProjects(instanceId: number, query: string): Promise<ProjectSearchResult[]> {
  return invoke<ProjectSearchResult[]>('search_projects', { instanceId, query });
}

/**
 * Get latest pipeline statuses for multiple projects.
 */
export async function getPipelineStatuses(instanceId: number, projectIds: number[]): Promise<PipelineStatus[]> {
  return invoke<PipelineStatus[]>('get_pipeline_statuses', { instanceId, projectIds });
}

// ============================================================================
// Notification Settings Commands
// ============================================================================

/**
 * Get current notification settings.
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  return invoke<NotificationSettings>('get_notification_settings');
}

/**
 * Update notification settings.
 */
export async function updateNotificationSettings(settings: NotificationSettings): Promise<void> {
  return invoke<void>('update_notification_settings', { settings });
}

/**
 * Send a native OS notification.
 */
export async function sendNativeNotification(title: string, body: string): Promise<void> {
  return invoke<void>('send_native_notification', { title, body });
}
