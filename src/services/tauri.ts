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
  DiffFile,
  DiffFileContent,
  DiffFileMetadata,
  DiffHunksResponse,
  DiffRefs,
  Comment,
  AddCommentRequest,
  AddCommentResponse,
  ReplyToCommentRequest,
  ResolveDiscussionRequest,
  SyncStatusResponse,
  Settings,
  SettingsUpdate,
  MemoryStats,
  CacheStats,
  DiagnosticsReport,
  TestDataResult,
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
export async function addComment(request: AddCommentRequest): Promise<AddCommentResponse> {
  return invoke<AddCommentResponse>('add_comment', { input: request });
}

/**
 * Reply to an existing discussion.
 */
export async function replyToComment(request: ReplyToCommentRequest): Promise<AddCommentResponse> {
  return invoke<AddCommentResponse>('reply_to_comment', { input: request });
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
