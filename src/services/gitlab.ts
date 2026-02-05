/**
 * GitLab service wrapper.
 *
 * This module provides a high-level API for GitLab-related operations,
 * wrapping the Tauri invoke calls with additional business logic.
 */

import {
  setupGitLabInstance,
  getGitLabInstances,
  deleteGitLabInstance,
  getMergeRequests,
  getMergeRequest,
  getDiffFiles,
  getDiffFileContent,
  getDiffFileMetadata,
  getDiffHunks,
  getDiffRefs as tauriGetDiffRefs,
  getFileContent as tauriGetFileContent,
  getFileContentBase64 as tauriGetFileContentBase64,
  getComments,
  addComment,
  replyToComment,
  resolveDiscussion,
  approveMR,
  unapproveMR,
  type SetupInstanceResponse,
  type GitLabInstanceWithStatus,
} from './tauri';
import type {
  GitLabInstanceSetup,
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
} from '../types';

// Re-export types used by consumers
export type { SetupInstanceResponse, GitLabInstanceWithStatus } from './tauri';

// ============================================================================
// Instance Management
// ============================================================================

/**
 * Set up a new GitLab instance with validation.
 *
 * @param input - The instance URL and token
 * @returns The created instance and authenticated username
 * @throws Error if validation fails or instance already exists
 */
export async function addGitLabInstance(
  input: GitLabInstanceSetup
): Promise<SetupInstanceResponse> {
  // Normalize URL before sending
  const normalizedInput = {
    ...input,
    url: normalizeUrl(input.url),
  };
  return setupGitLabInstance(normalizedInput);
}

/**
 * List all configured GitLab instances.
 *
 * @returns Array of instances with token status
 */
export async function listInstances(): Promise<GitLabInstanceWithStatus[]> {
  return getGitLabInstances();
}

/**
 * Remove a GitLab instance and its cached data.
 *
 * @param instanceId - The instance ID to remove
 */
export async function removeInstance(instanceId: number): Promise<void> {
  return deleteGitLabInstance(instanceId);
}

// ============================================================================
// Merge Request Operations
// ============================================================================

/**
 * Get merge requests from local cache with optional filtering.
 *
 * @param instanceId - The GitLab instance ID
 * @param filter - Optional filter criteria
 * @returns Array of merge requests
 */
export async function listMergeRequests(
  instanceId: number,
  filter?: MRFilter
): Promise<MergeRequest[]> {
  return getMergeRequests(instanceId, filter);
}

/**
 * Get a single merge request by ID.
 *
 * @param mrId - The merge request ID
 * @returns The merge request details
 */
export async function getMergeRequestById(mrId: number): Promise<MergeRequest> {
  return getMergeRequest(mrId);
}

/**
 * Get the list of changed files in a merge request.
 *
 * @param mrId - The merge request ID
 * @returns Array of diff files
 */
export async function getMergeRequestFiles(mrId: number): Promise<DiffFile[]> {
  return getDiffFiles(mrId);
}

/**
 * Get the diff content for a specific file with syntax highlighting.
 *
 * @param mrId - The merge request ID
 * @param filePath - The file path
 * @returns The diff content with highlighted tokens
 */
export async function getFileDiff(
  mrId: number,
  filePath: string
): Promise<DiffFileContent> {
  return getDiffFileContent(mrId, filePath);
}

/**
 * Get metadata about a diff file for progressive loading.
 *
 * @param mrId - The merge request ID
 * @param filePath - The file path
 * @returns Metadata including hunk count and whether it's a large diff
 */
export async function getFileDiffMetadata(
  mrId: number,
  filePath: string
): Promise<DiffFileMetadata> {
  return getDiffFileMetadata(mrId, filePath);
}

/**
 * Get a range of hunks for progressive loading of large diffs.
 *
 * @param mrId - The merge request ID
 * @param filePath - The file path
 * @param start - Starting hunk index
 * @param count - Number of hunks to fetch
 * @returns The requested hunks with pagination info
 */
export async function getFileDiffHunks(
  mrId: number,
  filePath: string,
  start: number,
  count: number
): Promise<DiffHunksResponse> {
  return getDiffHunks(mrId, filePath, start, count);
}

/**
 * Get diff refs (SHA values) for a merge request.
 * Used to fetch original and modified file content for Monaco diff viewer.
 *
 * @param mrId - The merge request ID
 * @returns The base, head, and start SHA values
 */
export async function getDiffRefs(mrId: number): Promise<DiffRefs> {
  return tauriGetDiffRefs(mrId);
}

/**
 * Get raw file content at a specific commit SHA.
 * Used by Monaco diff viewer to get original and modified file contents.
 *
 * @param instanceId - The GitLab instance ID
 * @param projectId - The GitLab project ID
 * @param filePath - The path to the file in the repository
 * @param sha - The commit SHA to fetch the file at
 * @returns The raw file content as a string (empty for deleted/new files)
 */
export async function getFileContent(
  instanceId: number,
  projectId: number,
  filePath: string,
  sha: string
): Promise<string> {
  return tauriGetFileContent(instanceId, projectId, filePath, sha);
}

/**
 * Get binary file content as base64 at a specific commit SHA.
 * Used by image diff viewer to get original and modified images.
 *
 * @param instanceId - The GitLab instance ID
 * @param projectId - The GitLab project ID
 * @param filePath - The path to the file in the repository
 * @param sha - The commit SHA to fetch the file at
 * @returns The file content as base64-encoded string (empty for deleted/new files)
 */
export async function getFileContentBase64(
  instanceId: number,
  projectId: number,
  filePath: string,
  sha: string
): Promise<string> {
  return tauriGetFileContentBase64(instanceId, projectId, filePath, sha);
}

// ============================================================================
// Comment Operations
// ============================================================================

/**
 * Get all comments on a merge request.
 *
 * @param mrId - The merge request ID
 * @returns Array of comments
 */
export async function listComments(mrId: number): Promise<Comment[]> {
  return getComments(mrId);
}

/**
 * Add a general comment to a merge request.
 *
 * @param mrId - The merge request ID
 * @param body - The comment text
 * @returns The created comment reference
 */
export async function addGeneralComment(
  mrId: number,
  body: string
): Promise<AddCommentResponse> {
  const request: AddCommentRequest = { mrId, body };
  return addComment(request);
}

/**
 * Add an inline comment at a specific line.
 *
 * @param mrId - The merge request ID
 * @param body - The comment text
 * @param filePath - The file path
 * @param line - The line number (newLine for additions, oldLine for deletions)
 * @param isOldLine - Whether this is a line in the old version
 * @returns The created comment reference
 */
export async function addInlineComment(
  mrId: number,
  body: string,
  filePath: string,
  line: number,
  isOldLine = false
): Promise<AddCommentResponse> {
  const request: AddCommentRequest = {
    mrId,
    body,
    position: {
      filePath,
      ...(isOldLine ? { oldLine: line } : { newLine: line }),
    },
  };
  return addComment(request);
}

/**
 * Reply to an existing discussion thread.
 *
 * @param mrId - The merge request ID
 * @param discussionId - The discussion thread ID
 * @param body - The reply text
 * @returns The created reply reference
 */
export async function replyToDiscussion(
  mrId: number,
  discussionId: string,
  body: string
): Promise<AddCommentResponse> {
  const request: ReplyToCommentRequest = { mrId, discussionId, body };
  return replyToComment(request);
}

/**
 * Toggle the resolved status of a discussion.
 *
 * @param mrId - The merge request ID
 * @param discussionId - The discussion thread ID
 * @param resolved - Whether to resolve or unresolve
 */
export async function setDiscussionResolved(
  mrId: number,
  discussionId: string,
  resolved: boolean
): Promise<void> {
  const request: ResolveDiscussionRequest = { mrId, discussionId, resolved };
  return resolveDiscussion(request);
}

// ============================================================================
// Approval Operations
// ============================================================================

/**
 * Approve a merge request.
 *
 * @param mrId - The merge request ID
 */
export async function approve(mrId: number): Promise<void> {
  return approveMR(mrId);
}

/**
 * Remove approval from a merge request.
 *
 * @param mrId - The merge request ID
 */
export async function unapprove(mrId: number): Promise<void> {
  return unapproveMR(mrId);
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize a GitLab instance URL.
 */
function normalizeUrl(url: string): string {
  let normalized = url.trim();

  // Add https:// if no protocol specified
  if (!normalized.match(/^https?:\/\//)) {
    normalized = `https://${normalized}`;
  }

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  return normalized;
}
