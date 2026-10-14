/**
 * Typed bridge to the Tauri backend.
 *
 * Every backend command the UI uses goes through `api.*`. Commands read the
 * local SQLite cache first, so most calls resolve in a few milliseconds; the
 * backend syncs with GitLab in the background and emits events (see
 * `events.ts`) when cached data changes.
 */

import type {
  AddCommentRequest,
  AppError,
  CachedFilePair,
  Comment,
  CustomMrFilter,
  DeleteCommentRequest,
  DiffFile,
  DiffHunksResponse,
  DiffRefs,
  GitLabInstance,
  GitLabInstanceSetup,
  MergeRequest,
  MRFilter,
  MrReviewer,
  MrSnooze,
  NotificationSettings,
  PipelineJob,
  PipelineProject,
  PipelineStatus,
  ProjectSearchResult,
  ReplyToCommentRequest,
  ResolveDiscussionRequest,
  ResolvedMr,
  RetryActionsResponse,
  Settings,
  SettingsUpdate,
  SetupInstanceResponse,
  SyncConfig,
  SyncStatusResponse,
  SyncStatusWire,
  TokenInfo,
} from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/** Error thrown for any failed backend command, with the backend's message. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function toApiError(error: unknown): ApiError {
  if (error && typeof error === 'object' && 'type' in error) {
    // Backend `AppError`: `{ type, details }`; `NotFound` carries `resource`/`id`, not `message`.
    const e = error as AppError;
    const d = e.details;
    const message =
      d?.message || (d?.resource ? `${d.resource}${d.id ? ` ${d.id}` : ''} not found` : '') || e.type;
    return new ApiError(message, e.type);
  }
  if (error instanceof Error) return new ApiError(error.message, 'Unknown');
  return new ApiError(String(error), 'Unknown');
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    throw toApiError(error);
  }
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

export interface InstanceWithStatus extends GitLabInstance {
  hasToken: boolean;
  /** Only present when reading the stored token failed. */
  tokenError?: string;
}

export interface AutoMergeClaim {
  mrId: number;
  claimedAt: number;
  lastStatus: string | null;
  lastError: string | null;
  lastAttemptAt: number | null;
  attempts: number;
}

export interface AutoRunClaim {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  jobId: number;
  jobName: string;
  refName: string | null;
  claimedAt: number;
  lastStatus: string | null;
  lastError: string | null;
  lastAttemptAt: number | null;
  attempts: number;
}

export const api = {
  // Instances & auth
  setupInstance: (input: GitLabInstanceSetup) =>
    invoke<SetupInstanceResponse>('setup_gitlab_instance', { input }),
  instances: () => invoke<InstanceWithStatus[]>('get_gitlab_instances'),
  deleteInstance: (instanceId: number) => invoke<void>('delete_gitlab_instance', { instanceId }),
  setDefaultInstance: (instanceId: number) => invoke<void>('set_default_instance', { instanceId }),
  renameInstance: (instanceId: number, name: string) =>
    invoke<void>('rename_instance', { instanceId, name }),
  tokenInfo: (instanceId: number) => invoke<TokenInfo>('get_token_info', { instanceId }),
  updateToken: (instanceId: number, token: string) =>
    invoke<string>('update_instance_token', { instanceId, token }),
  updateSessionCookie: (instanceId: number, sessionCookie: string | null) =>
    invoke<void>('update_session_cookie', { instanceId, sessionCookie }),

  // Merge requests
  reviewMRs: (instanceId: number, filter?: MRFilter) =>
    invoke<MergeRequest[]>('get_merge_requests', { instanceId, filter }),
  myMRs: (instanceId: number, includeRecentlyMerged = false, includeDrafts = true) =>
    invoke<MergeRequest[]>('list_my_merge_requests', {
      instanceId,
      includeRecentlyMerged,
      includeDrafts,
    }),
  mr: async (mrId: number) =>
    (await invoke<{ mr: MergeRequest }>('get_merge_request_detail', { mrId })).mr,
  reviewers: (mrId: number) => invoke<MrReviewer[]>('get_mr_reviewers', { mrId }),
  resolveMrByUrl: (webUrl: string) =>
    invoke<ResolvedMr | null>('resolve_mr_by_web_url', { webUrl }),
  fetchMrByUrl: (webUrl: string) => invoke<ResolvedMr>('fetch_mr_by_web_url', { webUrl }),
  approve: (mrId: number) => invoke<void>('approve_mr', { mrId }),
  unapprove: (mrId: number) => invoke<void>('unapprove_mr', { mrId }),
  merge: (mrId: number) => invoke<void>('merge_mr', { mrId }),
  mergeStatus: (mrId: number) => invoke<string>('check_merge_status', { mrId }),
  rebase: (mrId: number) => invoke<void>('rebase_mr', { mrId }),
  markReady: (mrId: number) => invoke<string>('undraft_mr', { mrId }),
  /** `until` is Unix seconds and must be in the future. */
  snooze: (mrId: number, until: number) => invoke<MrSnooze>('snooze_mr', { mrId, until }),
  unsnooze: (mrId: number) => invoke<void>('unsnooze_mr', { mrId }),
  claimAutoMerge: (mrId: number) => invoke<AutoMergeClaim>('claim_auto_merge', { mrId }),
  unclaimAutoMerge: (mrId: number) => invoke<void>('unclaim_auto_merge', { mrId }),
  autoMergeClaim: (mrId: number) =>
    invoke<AutoMergeClaim | null>('get_auto_merge_claim', { mrId }),

  // Diffs
  diffFiles: (mrId: number) => invoke<DiffFile[]>('get_diff_files', { mrId }),
  diffRefs: (mrId: number) => invoke<DiffRefs>('get_diff_refs', { mrId }),
  diffHunks: (mrId: number, filePath: string, start: number, count: number) =>
    invoke<DiffHunksResponse>('get_diff_hunks', { mrId, filePath, start, count }),
  cachedFilePair: (mrId: number, filePath: string) =>
    invoke<CachedFilePair>('get_cached_file_pair', { mrId, filePath }),
  fileContent: (instanceId: number, projectId: number, filePath: string, sha: string) =>
    invoke<string>('get_file_content', { instanceId, projectId, filePath, sha }),
  fileContentBase64: (instanceId: number, projectId: number, filePath: string, sha: string) =>
    invoke<string>('get_file_content_base64', { instanceId, projectId, filePath, sha }),
  gitattributes: (instanceId: number, projectId: number) =>
    invoke<string[]>('get_gitattributes', { instanceId, projectId }),
  collapsePatterns: () => invoke<string[]>('get_collapse_patterns'),
  updateCollapsePatterns: (patterns: string[]) =>
    invoke<void>('update_collapse_patterns', { patterns }),

  // Comments
  comments: (mrId: number) => invoke<Comment[]>('get_comments', { mrId }),
  addComment: (input: AddCommentRequest) => invoke<Comment>('add_comment', { input }),
  reply: (input: ReplyToCommentRequest) => invoke<Comment>('reply_to_comment', { input }),
  resolve: (input: ResolveDiscussionRequest) => invoke<void>('resolve_discussion', { input }),
  deleteComment: (input: DeleteCommentRequest) => invoke<void>('delete_comment', { input }),

  // Pipelines
  mrPipelines: (mrId: number) => invoke<PipelineStatus[]>('get_mr_pipelines', { mrId }),
  pipelineProjects: (instanceId: number) =>
    invoke<PipelineProject[]>('list_pipeline_projects', { instanceId }),
  visitProject: (instanceId: number, projectId: number) =>
    invoke<void>('visit_pipeline_project', { instanceId, projectId }),
  togglePinProject: (instanceId: number, projectId: number) =>
    invoke<void>('toggle_pin_pipeline_project', { instanceId, projectId }),
  removeProject: (instanceId: number, projectId: number) =>
    invoke<void>('remove_pipeline_project', { instanceId, projectId }),
  searchProjects: (instanceId: number, query: string) =>
    invoke<ProjectSearchResult[]>('search_projects', { instanceId, query }),
  pipelineStatuses: (instanceId: number, projectIds: number[]) =>
    invoke<PipelineStatus[]>('get_pipeline_statuses', { instanceId, projectIds }),
  cachedPipelineStatuses: (instanceId: number, projectIds: number[]) =>
    invoke<PipelineStatus[]>('get_cached_pipeline_statuses', { instanceId, projectIds }),
  projectPipelines: (instanceId: number, projectId: number, limit?: number) =>
    invoke<PipelineStatus[]>('get_project_pipelines', { instanceId, projectId, limit }),
  pipelineJobs: (instanceId: number, projectId: number, pipelineId: number) =>
    invoke<PipelineJob[]>('get_pipeline_jobs', { instanceId, projectId, pipelineId }),
  jobTrace: (instanceId: number, projectId: number, jobId: number) =>
    invoke<string>('get_job_trace', { instanceId, projectId, jobId }),
  playJob: (instanceId: number, projectId: number, jobId: number) =>
    invoke<PipelineJob>('play_pipeline_job', { instanceId, projectId, jobId }),
  retryJob: (instanceId: number, projectId: number, jobId: number) =>
    invoke<PipelineJob>('retry_pipeline_job', { instanceId, projectId, jobId }),
  cancelJob: (instanceId: number, projectId: number, jobId: number) =>
    invoke<PipelineJob>('cancel_pipeline_job', { instanceId, projectId, jobId }),
  cancelPipeline: (instanceId: number, projectId: number, pipelineId: number) =>
    invoke<PipelineStatus>('cancel_pipeline', { instanceId, projectId, pipelineId }),
  autoRunClaims: (instanceId: number, projectId: number, pipelineId: number) =>
    invoke<AutoRunClaim[]>('list_auto_run_claims', { instanceId, projectId, pipelineId }),
  claimAutoRun: (
    instanceId: number,
    projectId: number,
    pipelineId: number,
    jobId: number,
    jobName: string,
    refName: string | null,
  ) =>
    invoke<void>('claim_auto_run', { instanceId, projectId, pipelineId, jobId, jobName, refName }),
  unclaimAutoRun: (instanceId: number, projectId: number, jobId: number) =>
    invoke<void>('unclaim_auto_run', { instanceId, projectId, jobId }),

  // Sync
  triggerSync: (force = false) => invoke<void>('trigger_sync', { force }),
  /** The backend answers in snake_case; camelCase it here. */
  syncStatus: async (): Promise<SyncStatusResponse> => {
    const s = await invoke<SyncStatusWire>('get_sync_status');
    return {
      isSyncing: s.is_syncing,
      lastSyncTime: s.last_sync_time,
      lastError: s.last_error,
      pendingActions: s.pending_actions,
      failedActions: s.failed_actions,
      lastSyncMrCount: s.last_sync_mr_count,
      recentLogs: s.recent_logs,
    };
  },
  /** Retries every failed action (there's no per-action retry command). */
  retryFailedActions: () => invoke<RetryActionsResponse>('retry_failed_actions'),
  discardAction: (actionId: number) => invoke<void>('discard_failed_action', { actionId }),

  // Settings
  settings: () => invoke<Settings>('get_settings'),
  /** The backend replaces the whole settings object, so merge onto the current one. */
  updateSettings: async (update: SettingsUpdate) => {
    const settings = { ...(await invoke<Settings>('get_settings')), ...update };
    await invoke<void>('update_settings', { settings });
    return settings;
  },
  /** Also reschedules the running sync engine (plain `updateSettings` doesn't). */
  updateSyncSettings: (syncConfig: SyncConfig) =>
    invoke<void>('update_sync_settings', { syncConfig }),
  notificationSettings: () => invoke<NotificationSettings>('get_notification_settings'),
  updateNotificationSettings: (settings: NotificationSettings) =>
    invoke<void>('update_notification_settings', { settings }),
  notificationPermission: () =>
    invoke<'granted' | 'denied' | 'not_determined'>('get_notification_permission_status'),
  requestNotificationPermission: () => invoke<boolean>('request_notification_permission'),
  customMrFilter: (instanceId: number) =>
    invoke<CustomMrFilter | null>('get_custom_mr_filter', { instanceId }),
  setCustomMrFilter: (filter: CustomMrFilter) => invoke<void>('set_custom_mr_filter', { filter }),
  testCustomMrFilter: (filter: CustomMrFilter) =>
    invoke<number>('test_custom_mr_filter', { filter }),

  // Avatars (data: URIs keyed by username)
  avatars: (instanceId: number, usernames: string[]) =>
    invoke<Record<string, string>>('get_avatars', { instanceId, usernames }),
};
