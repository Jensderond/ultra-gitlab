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
  Comment,
  AddCommentRequest,
  AddCommentResponse,
  ReplyToCommentRequest,
  ResolveDiscussionRequest,
  ApprovalResponse,
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
 * @returns The approval response with sync action ID
 */
export async function approve(mrId: number): Promise<ApprovalResponse> {
  return approveMR(mrId);
}

/**
 * Remove approval from a merge request.
 *
 * @param mrId - The merge request ID
 * @returns The unapproval response
 */
export async function unapprove(mrId: number): Promise<ApprovalResponse> {
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
