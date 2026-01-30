/**
 * Frontend TypeScript types matching Rust models and data model entities.
 * These types are used for IPC communication with the Tauri backend.
 */

// ============================================================================
// GitLab Instance
// ============================================================================

export interface GitLabInstance {
  id: number;
  url: string;
  name: string | null;
  createdAt: number;
}

export interface GitLabInstanceSetup {
  url: string;
  token: string;
  name?: string;
}

export interface GitLabInstanceResponse {
  id: number;
  url: string;
  name: string | null;
  validated: boolean;
}

// ============================================================================
// Merge Request
// ============================================================================

export type MRState = 'opened' | 'merged' | 'closed';
export type ApprovalStatus = 'approved' | 'pending' | 'changes_requested';

export interface MergeRequest {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description: string | null;
  authorUsername: string;
  sourceBranch: string;
  targetBranch: string;
  state: MRState;
  webUrl: string;
  createdAt: number;
  updatedAt: number;
  mergedAt: number | null;
  approvalStatus: ApprovalStatus | null;
  approvalsRequired: number | null;
  approvalsCount: number | null;
  labels: string[];
  reviewers: string[];
  cachedAt: number;
}

export interface MRFilter {
  state?: MRState | 'all';
  scope?: 'authored' | 'reviewing' | 'all';
  search?: string;
}

export interface MRDetailResponse {
  mr: MergeRequest;
  diffSummary: DiffSummary;
  pendingActions: number;
}

// ============================================================================
// Diff
// ============================================================================

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';
export type LineType = 'add' | 'remove' | 'context';

export interface DiffSummary {
  fileCount: number;
  additions: number;
  deletions: number;
  files: DiffFileSummary[];
}

export interface DiffFileSummary {
  newPath: string;
  oldPath: string | null;
  changeType: ChangeType;
  additions: number;
  deletions: number;
}

export interface DiffFile {
  id: number;
  mrId: number;
  oldPath: string | null;
  newPath: string;
  changeType: ChangeType;
  additions: number;
  deletions: number;
  filePosition: number;
}

export interface DiffContent {
  baseHash: string;
  headHash: string;
  content: string;
  highlightedTokens?: HighlightToken[];
}

export interface DiffFileContent {
  filePath: string;
  oldContent: string | null;
  newContent: string | null;
  diffHunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: LineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  tokens: HighlightToken[];
}

export interface HighlightToken {
  start: number;
  end: number;
  class: string;
}

// ============================================================================
// Comment
// ============================================================================

export type SyncStatus = 'synced' | 'pending' | 'failed';

export interface Comment {
  id: number;
  mrId: number;
  discussionId: string | null;
  parentId: number | null;
  authorUsername: string;
  body: string;
  filePath: string | null;
  oldLine: number | null;
  newLine: number | null;
  resolved: boolean;
  system: boolean;
  createdAt: number;
  updatedAt: number;
  isLocal: boolean;
  syncStatus: SyncStatus | null;
}

export interface CommentPosition {
  filePath: string;
  oldLine?: number;
  newLine?: number;
}

export interface AddCommentRequest {
  mrId: number;
  body: string;
  position?: CommentPosition;
}

export interface AddCommentResponse {
  localId: number;
  syncActionId: number;
}

export interface ReplyToCommentRequest {
  mrId: number;
  discussionId: string;
  body: string;
}

export interface ResolveDiscussionRequest {
  mrId: number;
  discussionId: string;
  resolved: boolean;
}

// ============================================================================
// Sync Action
// ============================================================================

export type ActionType = 'approve' | 'comment' | 'reply' | 'resolve' | 'unresolve';
export type ActionStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncAction {
  id: number;
  mrId: number;
  actionType: ActionType;
  status: ActionStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: number;
}

export interface SyncLogEntry {
  id: number;
  operation: string;
  status: 'success' | 'error';
  mrId?: number;
  message: string | null;
  durationMs?: number;
  timestamp: number;
}

export interface SyncStatusResponse {
  isSyncing: boolean;
  lastSyncTime: number | null;
  nextSyncTime: number | null;
  pendingActions: number;
  failedActions: number;
  recentLogs: SyncLogEntry[];
  cacheSizeBytes: number;
  cacheSizeWarning: boolean;
}

// ============================================================================
// Approval
// ============================================================================

export interface ApprovalResponse {
  syncActionId: number;
  localStatus: 'approved' | 'pending';
}

// ============================================================================
// Settings
// ============================================================================

export type Theme = 'light' | 'dark' | 'system';
export type DiffViewMode = 'unified' | 'split';

export interface Settings {
  syncIntervalMinutes: number;
  theme: Theme;
  keyboardShortcuts: Record<string, string>;
  diffViewMode: DiffViewMode;
}

export type SettingsUpdate = Partial<Settings>;

// ============================================================================
// Tauri Events
// ============================================================================

export type SyncProgressType = 'started' | 'progress' | 'completed' | 'error';

export interface SyncProgressPayload {
  type: SyncProgressType;
  operation: string;
  current?: number;
  total?: number;
  message?: string;
}

export type MRUpdateSource = 'local' | 'remote';
export type MRChangeType = 'metadata' | 'diff' | 'comments' | 'approval';

export interface MRUpdatedPayload {
  mrId: number;
  source: MRUpdateSource;
  changes: MRChangeType[];
}

export interface ActionSyncedPayload {
  syncActionId: number;
  mrId: number;
  actionType: string;
  success: boolean;
  error?: string;
  gitlabId?: number;
}

// ============================================================================
// Error Types
// ============================================================================

export type ErrorCode =
  | 'NotFound'
  | 'NetworkError'
  | 'AuthenticationFailed'
  | 'ValidationError'
  | 'DatabaseError'
  | 'SyncConflict'
  | 'RateLimited';

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
