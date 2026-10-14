/**
 * Wire types for the Tauri backend. These mirror the Rust models (camelCase
 * serde) and are the contract between the UI and `src-tauri`.
 */

// ============================================================================
// GitLab Instance
// ============================================================================

export interface GitLabInstance {
  id: number;
  url: string;
  name: string | null;
  createdAt: number;
  sessionCookie: string | null;
  authenticatedUsername: string | null;
  isDefault: boolean;
}

export interface GitLabInstanceSetup {
  url: string;
  token: string;
  name?: string;
  sessionCookie?: string;
}

/** `setup_gitlab_instance` result. */
export interface SetupInstanceResponse {
  instance: GitLabInstance;
  username: string;
}

export interface TokenInfo {
  expiresAt: string | null;
  name: string;
  scopes: string[];
  active: boolean;
}

// ============================================================================
// Merge Request
// ============================================================================

export type MRState = 'opened' | 'merged' | 'closed';
export type ApprovalStatus = 'approved' | 'pending' | 'changes_requested';

export interface MergeRequest {
  id: number;
  instanceId: number;
  iid: number;
  projectId: number;
  projectName: string;
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
  userHasApproved: boolean;
  headPipelineStatus: string | null;
  /** Snooze expiry (Unix seconds) if the MR is snoozed; past values mean lapsed. */
  snoozedUntil: number | null;
}

export interface MRFilter {
  state?: MRState | 'all';
  /** Accepted but ignored by the backend (`get_merge_requests` only filters on state/search). */
  scope?: 'authored' | 'reviewing' | 'all';
  search?: string;
}

export interface MRDetailResponse {
  mr: MergeRequest;
  /** Null until the MR's diff has been synced. */
  diffSummary: DiffSummary | null;
  pendingActions: number;
}

/** `snooze_mr` result. */
export interface MrSnooze {
  mrId: number;
  snoozedAt: number;
  snoozeUntil: number;
}

// ============================================================================
// MR Reviewer
// ============================================================================

export interface MrReviewer {
  mrId: number;
  username: string;
  status: 'approved' | 'pending' | 'changes_requested';
  cachedAt: number;
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
  /** Per-file unified diff (the backend includes it; the UI doesn't need it). */
  diffContent?: string | null;
}

export interface DiffContent {
  baseSha: string;
  headSha: string;
  content: string;
}

export interface DiffRefs {
  baseSha: string;
  headSha: string;
  startSha: string;
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
}

// Progressive diff loading types
export interface DiffFileMetadata {
  filePath: string;
  hunkCount: number;
  totalLines: number;
  additions: number;
  deletions: number;
  isLarge: boolean;
}

export interface DiffHunksResponse {
  filePath: string;
  hunks: DiffHunk[];
  startIndex: number;
  totalHunks: number;
  hasMore: boolean;
}

// ============================================================================
// Comment
// ============================================================================

export type SyncStatus = 'synced' | 'pending' | 'failed' | 'discarded';

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
  /** GitLab's line type for diff notes, when known. */
  lineType: string | null;
  resolved: boolean;
  /** False for standalone notes GitLab can't resolve (e.g. individual comments). */
  resolvable: boolean;
  system: boolean;
  createdAt: number;
  updatedAt: number;
  isLocal: boolean;
  /** Always set by the backend: `synced` for remote notes. */
  syncStatus: SyncStatus;
}

export interface AddCommentRequest {
  mrId: number;
  body: string;
  filePath?: string;
  oldLine?: number;
  newLine?: number;
  /** When true, this is an unchanged (context) line — backend resolves both line numbers from the diff. */
  isContextLine?: boolean;
}

export interface ReplyToCommentRequest {
  mrId: number;
  discussionId: string;
  parentId: number;
  body: string;
}

export interface ResolveDiscussionRequest {
  mrId: number;
  discussionId: string;
  resolved: boolean;
}

export interface DeleteCommentRequest {
  mrId: number;
  commentId: number;
}

// ============================================================================
// Sync Action
// ============================================================================

export type ActionType = 'approve' | 'comment' | 'reply' | 'resolve' | 'unresolve';
export type ActionStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'discarded';

export interface SyncAction {
  id: number;
  mrId: number;
  actionType: ActionType;
  status: ActionStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: number;
}

/** A `sync_log` row (snake_case on the wire — no serde rename). */
export interface SyncLogEntry {
  id: number;
  operation: string;
  status: string;
  mr_id: number | null;
  message: string | null;
  duration_ms: number | null;
  /** Unix seconds. */
  timestamp: number;
}

/** `get_sync_status` as the backend sends it (snake_case — no serde rename). */
export interface SyncStatusWire {
  /** Always false: the backend can't observe the running engine here. */
  is_syncing: boolean;
  last_sync_time: number | null;
  last_error: string | null;
  pending_actions: number;
  failed_actions: number;
  last_sync_mr_count: number;
  recent_logs: SyncLogEntry[];
}

/** `api.syncStatus()` result (camelCased by the client). */
export interface SyncStatusResponse {
  /** Always false from the backend; use `sync-progress` events for live state. */
  isSyncing: boolean;
  /** Unix seconds of the last successful full sync. */
  lastSyncTime: number | null;
  lastError: string | null;
  pendingActions: number;
  failedActions: number;
  lastSyncMrCount: number;
  recentLogs: SyncLogEntry[];
}

/** `retry_failed_actions` result (snake_case on the wire). */
export interface RetryActionsResponse {
  retried_count: number;
  success_count: number;
  failed_count: number;
}

// ============================================================================
// Settings
// ============================================================================

export type Theme = 'kanagawa-wave' | 'kanagawa-light' | 'loved' | 'custom';
export type DiffViewMode = 'unified' | 'split';

/** Backend sync engine config (snake_case on the wire, unlike the rest). */
export interface SyncConfig {
  interval_secs: number;
  max_mrs_per_sync: number;
  issue_interval_secs: number;
}

export interface CustomThemeColors {
  bg: string;
  text: string;
  accent: string;
}

/**
 * `get_settings` / `update_settings` (`AppSettings`). `update_settings`
 * requires every field, so always send a full object (see `api.updateSettings`).
 * The diff layout is a local preference (`features/settings/prefs.ts`).
 */
export interface Settings {
  /** `update_sync_settings` changes it and reschedules the engine. */
  sync: SyncConfig;
  /** Any string on the backend; these are the built-in ids. */
  theme: Theme | (string & {});
  uiFont: string;
  displayFont: string;
  diffsFont: string;
  customThemeColors: CustomThemeColors | null;
  keyboardShortcuts: Record<string, string>;
  collapsePatterns: string[];
  fileJumpCount: number;
  mrListCondensed: boolean;
  showRecentlyMergedMrs: boolean;
  showDraftMrs: boolean;
  hasSeenProductTour: boolean;
}

export type SettingsUpdate = Partial<Settings>;

// ============================================================================
// Tauri Events
// ============================================================================

// Payloads below mirror `src-tauri/src/services/sync_events.rs`. The
// `sync-progress`, `mr-updated`, `action-synced` and `auth-expired` structs
// have no serde rename, so their fields are snake_case on the wire.

export type SyncPhase =
  | 'starting'
  | 'fetching_mrs'
  | 'fetching_diff'
  | 'fetching_comments'
  | 'pushing_actions'
  | 'purging'
  | 'complete'
  | 'failed';

export interface SyncProgressPayload {
  phase: SyncPhase;
  message: string;
  processed: number | null;
  total: number | null;
  is_error: boolean;
}

export type MrUpdateType = 'created' | 'updated' | 'diff_updated' | 'comments_updated' | 'purged';

export interface MRUpdatedPayload {
  mr_id: number;
  update_type: MrUpdateType;
  instance_id: number;
  iid: number;
}

export interface ActionSyncedPayload {
  action_id: number;
  action_type: string;
  success: boolean;
  error: string | null;
  mr_id: number;
  local_reference_id: number | null;
}

export interface AuthExpiredPayload {
  instance_id: number;
  instance_url: string;
  message: string;
}

export interface AutoMergeUpdatedPayload {
  mrId: number;
  removed: boolean;
  lastStatus: string | null;
  lastError: string | null;
}

export interface AutoRunUpdatedPayload {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  jobId: number;
  jobName: string;
  removed: boolean;
  played: boolean;
  lastStatus: string | null;
  lastError: string | null;
}

// ============================================================================
// Diagnostics (Memory and Performance Verification)
// ============================================================================

export interface MemoryStats {
  processMemoryBytes: number;
  processMemoryMb: number;
  systemTotalBytes: number;
  systemUsedBytes: number;
  underTarget: boolean;
  targetBytes: number;
}

export interface CacheStats {
  mrCount: number;
  diffFileCount: number;
  commentCount: number;
  dbSizeBytes: number;
  dbSizeMb: number;
}

export interface DiagnosticsReport {
  memory: MemoryStats;
  cache: CacheStats;
  timestamp: number;
}

export interface TestDataResult {
  mrsGenerated: number;
  diffFilesGenerated: number;
  commentsGenerated: number;
  durationMs: number;
}

// ============================================================================
// File Content Cache
// ============================================================================

export interface CachedFilePair {
  baseContent: string | null;
  headContent: string | null;
}

// ============================================================================
// Pipeline Dashboard
// ============================================================================

export interface PipelineProject {
  projectId: number;
  instanceId: number;
  pinned: boolean;
  lastVisitedAt: string | null;
  sortOrder: number | null;
  name: string;
  nameWithNamespace: string;
  pathWithNamespace: string;
  webUrl: string;
  starred: boolean;
  customName: string | null;
}

export interface PipelineStatus {
  id: number;
  projectId: number;
  /** GitLab's pipeline status string, passed through verbatim. */
  status:
    | 'success'
    | 'failed'
    | 'running'
    | 'pending'
    | 'canceled'
    | 'skipped'
    | 'created'
    | 'manual'
    | 'scheduled'
    | 'preparing'
    | 'waiting_for_resource';
  refName: string;
  /** Short SHA: the backend truncates it to 8 characters. */
  sha: string;
  webUrl: string;
  createdAt: string;
  updatedAt: string | null;
  duration: number | null;
}

export interface ProjectSearchResult {
  id: number;
  name: string;
  nameWithNamespace: string;
  pathWithNamespace: string;
  webUrl: string;
}

export type PipelineJobStatus =
  | 'created'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'skipped'
  | 'manual'
  | 'waiting_for_resource'
  | 'preparing'
  | 'scheduled';

export interface PipelineJob {
  id: number;
  name: string;
  stage: string;
  status: PipelineJobStatus;
  webUrl: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  duration: number | null;
  queuedDuration: number | null;
  allowFailure: boolean;
  runnerDescription: string | null;
  /** True for bridge (trigger) jobs that start a downstream pipeline. */
  isBridge: boolean;
  /** Pipeline triggered by a bridge job; null until/unless GitLab created it. */
  downstreamPipeline: DownstreamPipeline | null;
  /** True when this is a `when: manual` job (from GraphQL CiJob.manualJob). */
  manual: boolean;
}

export interface DownstreamPipeline {
  id: number;
  /** Null on GitLab versions that omit project_id; drill-down is disabled then. */
  projectId: number | null;
  status: string;
  refName: string | null;
  webUrl: string;
}

// ============================================================================
// Notification Settings
// ============================================================================

export interface NotificationSettings {
  mrReadyToMerge: boolean;
  pipelineStatusPinned: boolean;
  nativeNotificationsEnabled: boolean;
}

// ============================================================================
// Custom MR Filter
// ============================================================================

/** Per-instance user-defined MR sync filter (issue #28). */
export interface CustomMrFilter {
  instanceId: number;
  enabled: boolean;
  /** GitLab wip param: 'yes' (only drafts), 'no' (exclude drafts), null = any. */
  draft: string | null;
  authorUsername: string | null;
  notAuthorUsername: string | null;
  /** Comma-separated label names (AND-semantics). */
  labels: string | null;
  updatedAt: number;
}

// ============================================================================
// CLI Install
// ============================================================================

export interface CliInstallResult {
  version: string;
  path: string;
  message: string;
}

export interface CliStatus {
  installed: boolean;
  path: string;
}

// ============================================================================
// Deep Link
// ============================================================================

export interface ResolvedMr {
  localId: number;
  state: MRState;
}

// ============================================================================
// Error Types
// ============================================================================

/** `AppError` variant names (`#[serde(tag = "type", content = "details")]`). */
export type ErrorCode =
  | 'Database'
  | 'GitLabApi'
  | 'Network'
  | 'Authentication'
  | 'AuthenticationExpired'
  | 'CredentialStorage'
  | 'NotFound'
  | 'InvalidInput'
  | 'Sync'
  | 'Internal';

/** Rejection value of a failed command. `NotFound` has `resource` instead of `message`. */
export interface AppError {
  type: ErrorCode;
  details?: { message?: string; resource?: string; id?: string } & Record<string, unknown>;
}
