//! Background sync engine for GitLab data synchronization.
//!
//! This module provides the core sync functionality:
//! - Scheduled background sync at configurable intervals
//! - MR fetching with scope filters (author/reviewer)
//! - Diff and comment fetching during sync
//! - Sync queue processing (pushing local actions to GitLab)
//! - Sync logging for status display
//! - MR purge on merge/close per FR-005a

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::project::{self, Project};
use crate::models::sync_action::ActionType;
use crate::services::gitlab_client::{
    GitLabClient, GitLabClientConfig, GitLabDiffVersion, GitLabDiscussion, GitLabMergeRequest,
    MergeRequestsQuery,
};
use crate::services::sync_events::{
    ActionSyncedPayload, AuthExpiredPayload, MrReadyPayload, MrUpdateType, MrUpdatedPayload,
    SyncPhase, SyncProgressPayload, ACTION_SYNCED_EVENT, AUTH_EXPIRED_EVENT, MR_READY_EVENT,
    MR_UPDATED_EVENT, SYNC_PROGRESS_EVENT,
};
use crate::services::sync_processor::{self, ProcessResult};
use crate::services::sync_queue;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::sync::{mpsc, RwLock};
use tokio::time;

/// Default sync interval in seconds (5 minutes per spec).
pub const DEFAULT_SYNC_INTERVAL_SECS: u64 = 300;

/// Maximum number of log entries to keep.
const MAX_LOG_ENTRIES: i64 = 50;

/// Cache size warning threshold in bytes (400MB - warn before hitting 500MB limit).
const CACHE_SIZE_WARNING_BYTES: i64 = 400 * 1024 * 1024;

/// Cache size hard limit in bytes (500MB per spec).
const CACHE_SIZE_LIMIT_BYTES: i64 = 500 * 1024 * 1024;

/// Get the current Unix timestamp.
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Sync engine configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// Sync interval in seconds.
    pub interval_secs: u64,

    /// Whether to sync MRs where user is author.
    pub sync_authored: bool,

    /// Whether to sync MRs where user is reviewer.
    pub sync_reviewing: bool,

    /// Maximum number of MRs to sync per interval.
    pub max_mrs_per_sync: usize,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            interval_secs: DEFAULT_SYNC_INTERVAL_SECS,
            sync_authored: false, // Don't sync own MRs by default
            sync_reviewing: true,
            max_mrs_per_sync: 100,
        }
    }
}

/// Status of the sync engine.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SyncStatus {
    /// Whether sync is currently running.
    pub is_syncing: bool,

    /// Last successful sync timestamp.
    pub last_sync_time: Option<i64>,

    /// Last sync error message.
    pub last_error: Option<String>,

    /// Count of pending sync actions.
    pub pending_actions: i64,

    /// Count of failed sync actions.
    pub failed_actions: i64,

    /// Number of MRs synced in last run.
    pub last_sync_mr_count: i64,

    /// Current cache size in bytes.
    pub cache_size_bytes: i64,

    /// Whether the cache is approaching the size limit.
    pub cache_size_warning: bool,
}

/// Sync log entry matching the sync_log table.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SyncLogEntry {
    pub id: i64,
    pub operation: String,
    pub status: String,
    pub mr_id: Option<i64>,
    pub message: Option<String>,
    pub duration_ms: Option<i64>,
    pub timestamp: i64,
}

/// Result of a sync operation.
#[derive(Debug)]
pub struct SyncResult {
    /// Number of MRs fetched/updated.
    pub mr_count: i64,

    /// Number of MRs purged (merged/closed).
    pub purged_count: i64,

    /// Number of actions pushed to GitLab.
    pub actions_pushed: i64,

    /// Number of errors encountered.
    pub errors: Vec<String>,

    /// Duration of the sync in milliseconds.
    pub duration_ms: i64,
}

/// Commands that can be sent to the sync engine.
#[derive(Debug)]
pub enum SyncCommand {
    /// Trigger an immediate sync.
    TriggerSync,

    /// Flush pending actions of the given types immediately.
    FlushActions(Vec<ActionType>),

    /// Update the sync configuration.
    UpdateConfig(SyncConfig),

    /// Stop the sync engine.
    Stop,
}

/// Lightweight handle for controlling the background sync engine.
///
/// Managed as Tauri state. Communicates with the background sync loop
/// via an mpsc channel, avoiding lock contention.
#[derive(Clone)]
pub struct SyncHandle {
    /// Command channel sender.
    command_tx: mpsc::Sender<SyncCommand>,

    /// Shared configuration (readable without locking the engine).
    config: Arc<RwLock<SyncConfig>>,
}

impl SyncHandle {
    /// Trigger an immediate sync.
    pub async fn trigger_sync(&self) -> Result<(), AppError> {
        self.command_tx
            .send(SyncCommand::TriggerSync)
            .await
            .map_err(|_| AppError::internal("Sync engine not running"))
    }

    /// Flush pending actions of the given types immediately.
    pub async fn flush_actions(&self, types: Vec<ActionType>) -> Result<(), AppError> {
        self.command_tx
            .send(SyncCommand::FlushActions(types))
            .await
            .map_err(|_| AppError::internal("Sync engine not running"))
    }

    /// Flush only pending approval actions immediately.
    pub async fn flush_approvals(&self) -> Result<(), AppError> {
        self.flush_actions(vec![ActionType::Approve]).await
    }

    /// Flush pending comment-related actions (comment, reply, resolve, unresolve) immediately.
    pub async fn flush_comments(&self) -> Result<(), AppError> {
        self.flush_actions(vec![
            ActionType::Comment,
            ActionType::Reply,
            ActionType::Resolve,
            ActionType::Unresolve,
            ActionType::DeleteComment,
        ])
        .await
    }

    /// Update the sync configuration.
    pub async fn update_config(&self, config: SyncConfig) -> Result<(), AppError> {
        self.command_tx
            .send(SyncCommand::UpdateConfig(config))
            .await
            .map_err(|_| AppError::internal("Sync engine not running"))
    }

    /// Get the current configuration.
    pub async fn get_config(&self) -> SyncConfig {
        self.config.read().await.clone()
    }
}

/// Background sync engine.
///
/// Manages periodic synchronization with GitLab, including:
/// - Fetching new/updated MRs
/// - Fetching diffs and comments
/// - Pushing local actions to GitLab
/// - Purging merged/closed MRs
pub struct SyncEngine {
    /// Database connection pool.
    pool: DbPool,

    /// Current configuration.
    config: Arc<RwLock<SyncConfig>>,

    /// Sync status.
    status: Arc<RwLock<SyncStatus>>,

    /// Tauri app handle for emitting events to the frontend.
    app_handle: tauri::AppHandle,

    /// MR IDs already notified as ready-to-merge this session (avoids duplicate notifications).
    notified_mr_ready: HashSet<i64>,
}

impl SyncEngine {
    /// Create a new sync engine.
    pub fn new(pool: DbPool, app_handle: tauri::AppHandle) -> Self {
        Self {
            pool,
            config: Arc::new(RwLock::new(SyncConfig::default())),
            status: Arc::new(RwLock::new(SyncStatus::default())),
            app_handle,
            notified_mr_ready: HashSet::new(),
        }
    }

    /// Emit a sync-progress event to the frontend.
    ///
    /// Failures are logged but never abort the sync.
    fn emit_progress(&self, phase: SyncPhase, message: impl Into<String>) {
        if let Err(e) = self.app_handle.emit(
            SYNC_PROGRESS_EVENT,
            SyncProgressPayload {
                phase,
                message: message.into(),
                processed: None,
                total: None,
                is_error: false,
            },
        ) {
            log::warn!("Failed to emit sync-progress event: {}", e);
        }
    }

    /// Emit an mr-updated event to the frontend.
    ///
    /// Failures are logged but never abort the sync.
    fn emit_mr_updated(&self, mr_id: i64, instance_id: i64, iid: i64, update_type: MrUpdateType) {
        if let Err(e) = self.app_handle.emit(
            MR_UPDATED_EVENT,
            MrUpdatedPayload {
                mr_id,
                update_type,
                instance_id,
                iid,
            },
        ) {
            log::warn!("Failed to emit mr-updated event: {}", e);
        }
    }

    /// Start the background sync loop.
    ///
    /// Spawns a background task that owns the engine and runs sync at the
    /// configured interval. Returns a lightweight `SyncHandle` for sending
    /// commands (trigger, config update, stop) without holding a lock.
    pub fn start_background(
        pool: DbPool,
        config: SyncConfig,
        app_handle: tauri::AppHandle,
    ) -> SyncHandle {
        let (tx, mut rx) = mpsc::channel::<SyncCommand>(16);
        let config_shared = Arc::new(RwLock::new(config.clone()));
        let config_for_task = config_shared.clone();

        tokio::spawn(async move {
            // Brief delay so the app window appears before we start network I/O
            tokio::time::sleep(Duration::from_secs(3)).await;

            let mut engine = SyncEngine {
                pool,
                config: config_for_task,
                status: Arc::new(RwLock::new(SyncStatus::default())),
                app_handle,
                notified_mr_ready: HashSet::new(),
            };

            // Run initial sync immediately
            eprintln!("[sync] Running initial background sync...");
            match engine.run_sync().await {
                Ok(r) => {
                    eprintln!(
                        "[sync] Initial sync complete: {} MRs, {} purged, {} errors",
                        r.mr_count,
                        r.purged_count,
                        r.errors.len()
                    );
                    for err in &r.errors {
                        eprintln!("[sync] Error: {}", err);
                    }
                }
                Err(e) => eprintln!("[sync] Initial sync error: {}", e),
            }

            let interval_secs = { engine.config.read().await.interval_secs };
            let mut interval = time::interval(Duration::from_secs(interval_secs));
            // Consume the first (immediate) tick since we just ran sync
            interval.tick().await;

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        eprintln!("[sync] Running periodic background sync...");
                        if let Err(e) = engine.run_sync().await {
                            eprintln!("[sync] Periodic sync error: {}", e);
                        }
                    }
                    Some(cmd) = rx.recv() => {
                        match cmd {
                            SyncCommand::TriggerSync => {
                                eprintln!("[sync] Manual sync triggered");
                                if let Err(e) = engine.run_sync().await {
                                    eprintln!("[sync] Manual sync error: {}", e);
                                }
                            }
                            SyncCommand::FlushActions(action_types) => {
                                eprintln!("[sync] Flushing {:?} actions immediately", action_types);
                                if let Err(e) = engine.flush_actions_by_types(&action_types).await {
                                    eprintln!("[sync] Flush actions error: {}", e);
                                }
                            }
                        SyncCommand::UpdateConfig(new_config) => {
                                eprintln!("[sync] Config updated, interval={}s", new_config.interval_secs);
                                interval = time::interval(Duration::from_secs(new_config.interval_secs));
                                *engine.config.write().await = new_config;
                            }
                            SyncCommand::Stop => {
                                eprintln!("[sync] Sync engine stopping");
                                break;
                            }
                        }
                    }
                }
            }
            eprintln!("[sync] Sync engine stopped");
        });

        SyncHandle {
            command_tx: tx,
            config: config_shared,
        }
    }

    /// Run a single sync operation.
    ///
    /// This is the main sync logic that:
    /// 1. Fetches MRs from all configured GitLab instances
    /// 2. Fetches diffs and comments for each MR
    /// 3. Pushes pending local actions to GitLab
    /// 4. Purges merged/closed MRs
    pub async fn run_sync(&mut self) -> Result<SyncResult, AppError> {
        let start = Instant::now();

        // Emit starting event
        self.emit_progress(SyncPhase::Starting, "Starting sync...");

        // Mark sync as in progress
        {
            let mut status = self.status.write().await;
            status.is_syncing = true;
        }

        let mut result = SyncResult {
            mr_count: 0,
            purged_count: 0,
            actions_pushed: 0,
            errors: Vec::new(),
            duration_ms: 0,
        };

        // Get all GitLab instances
        let instances = self.get_gitlab_instances().await?;
        eprintln!("[sync] Found {} GitLab instance(s)", instances.len());

        for instance in &instances {
            eprintln!(
                "[sync] Syncing instance: {} (id={})",
                instance.url, instance.id
            );
        }

        for instance in instances {
            match self.sync_instance(&instance).await {
                Ok(instance_result) => {
                    result.mr_count += instance_result.mr_count;
                    result.purged_count += instance_result.purged_count;
                    result.actions_pushed += instance_result.actions_pushed;
                    result.errors.extend(instance_result.errors);
                }
                Err(e) => {
                    // Emit auth-expired event if this is an authentication error
                    if e.is_authentication_expired() {
                        if let Err(emit_err) = self.app_handle.emit(
                            AUTH_EXPIRED_EVENT,
                            AuthExpiredPayload {
                                instance_id: e.get_expired_instance_id().unwrap_or(instance.id),
                                instance_url: e
                                    .get_expired_instance_url()
                                    .unwrap_or(&instance.url)
                                    .to_string(),
                                message: format!(
                                    "Authentication expired for {}. Please re-authenticate.",
                                    instance.url
                                ),
                            },
                        ) {
                            log::warn!("Failed to emit auth-expired event: {}", emit_err);
                        }
                    }
                    result
                        .errors
                        .push(format!("Instance {}: {}", instance.url, e));
                }
            }
        }

        // Calculate duration
        result.duration_ms = start.elapsed().as_millis() as i64;

        // Update status
        {
            let mut status = self.status.write().await;
            status.is_syncing = false;
            status.last_sync_time = Some(now());
            status.last_sync_mr_count = result.mr_count;

            status.last_error = if result.errors.is_empty() {
                None
            } else {
                Some(result.errors.join("; "))
            };

            // Update action counts
            let (pending, failed) = sync_queue::get_action_counts(&self.pool).await?;
            status.pending_actions = pending;
            status.failed_actions = failed;

            // Check cache size
            let cache_size = self.get_cache_size().await.unwrap_or(0);
            status.cache_size_bytes = cache_size;
            status.cache_size_warning = cache_size >= CACHE_SIZE_WARNING_BYTES;

            // Log warning if approaching limit
            if status.cache_size_warning {
                result.errors.push(format!(
                    "Cache size warning: {:.1}MB of {:.0}MB limit",
                    cache_size as f64 / 1024.0 / 1024.0,
                    CACHE_SIZE_LIMIT_BYTES as f64 / 1024.0 / 1024.0
                ));
            }
        }

        // Emit complete or failed event
        if result.errors.is_empty() {
            if let Err(e) = self.app_handle.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgressPayload {
                    phase: SyncPhase::Complete,
                    message: format!(
                        "Sync complete: {} MRs in {}ms",
                        result.mr_count, result.duration_ms
                    ),
                    processed: Some(result.mr_count),
                    total: Some(result.mr_count),
                    is_error: false,
                },
            ) {
                log::warn!("Failed to emit sync-progress complete event: {}", e);
            }
        } else {
            if let Err(e) = self.app_handle.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgressPayload {
                    phase: SyncPhase::Failed,
                    message: result.errors.join("; "),
                    processed: Some(result.mr_count),
                    total: None,
                    is_error: true,
                },
            ) {
                log::warn!("Failed to emit sync-progress failed event: {}", e);
            }
        }

        // Log the sync operation
        self.log_sync_operation(
            "sync_complete",
            if result.errors.is_empty() {
                "success"
            } else {
                "error"
            },
            None,
            Some(format!(
                "Synced {} MRs, purged {}, pushed {} actions",
                result.mr_count, result.purged_count, result.actions_pushed
            )),
            Some(result.duration_ms),
        )
        .await?;

        Ok(result)
    }

    /// Sync a single GitLab instance.
    async fn sync_instance(
        &mut self,
        instance: &GitLabInstanceRow,
    ) -> Result<SyncResult, AppError> {
        let config = self.config.read().await;
        eprintln!(
            "[sync] sync_instance: url={}, has_token={}, sync_authored={}, sync_reviewing={}",
            instance.url,
            instance.token.is_some(),
            config.sync_authored,
            config.sync_reviewing
        );

        // Get token from DB
        let token = instance.token.clone().ok_or_else(|| {
            eprintln!(
                "[sync] ERROR: No token for instance {} (id={})",
                instance.url, instance.id
            );
            AppError::authentication_expired_for_instance(
                "GitLab token missing. Please re-authenticate.",
                instance.id,
                &instance.url,
            )
        })?;

        // Create GitLab client
        let client = GitLabClient::new(GitLabClientConfig {
            base_url: instance.url.clone(),
            token,
            timeout_secs: 30,
        })
        .map_err(|e| {
            // Enrich auth errors with instance info
            if e.is_authentication_expired() {
                AppError::authentication_expired_for_instance(
                    "GitLab token expired or revoked. Please re-authenticate.",
                    instance.id,
                    &instance.url,
                )
            } else {
                e
            }
        })?;

        let mut result = SyncResult {
            mr_count: 0,
            purged_count: 0,
            actions_pushed: 0,
            errors: Vec::new(),
            duration_ms: 0,
        };

        // Validate token and ensure authenticated_username is persisted
        // (may be NULL for instances created before migration 0008)
        if let Ok(user) = client.validate_token().await {
            let _ = sqlx::query(
                "UPDATE gitlab_instances SET authenticated_username = ? WHERE id = ? AND (authenticated_username IS NULL OR authenticated_username != ?)"
            )
            .bind(&user.username)
            .bind(instance.id)
            .bind(&user.username)
            .execute(&self.pool)
            .await;
        }

        // Emit fetching_mrs event
        self.emit_progress(
            SyncPhase::FetchingMrs,
            format!("Fetching MRs from {}", instance.url),
        );

        // Fetch MRs based on scope
        let mrs = match self.fetch_mrs_for_instance(&client, &config).await {
            Ok(mrs) => mrs,
            Err(e) => {
                // If auth expired, propagate the error with instance info
                if e.is_authentication_expired() {
                    return Err(AppError::authentication_expired_for_instance(
                        "GitLab token expired or revoked. Please re-authenticate.",
                        instance.id,
                        &instance.url,
                    ));
                }
                result.errors.push(format!("Failed to fetch MRs: {}", e));
                Vec::new()
            }
        };

        // Drop the config read guard before mutable borrows
        drop(config);

        // Snapshot pre-sync ready state for authored MRs (for transition detection)
        let mr_ids: Vec<i64> = mrs.iter().map(|mr| mr.id).collect();
        let pre_sync_ready = self.get_ready_states(&mr_ids).await;

        // Process each MR
        for mr in &mrs {
            match self.sync_mr(instance.id, &client, mr).await {
                Ok(_) => {
                    result.mr_count += 1;
                }
                Err(e) => {
                    result.errors.push(format!("MR !{}: {}", mr.iid, e));
                }
            }
        }

        // Detect MR ready-to-merge transitions and emit notifications
        self.check_mr_ready_transitions(&mr_ids, &pre_sync_ready, &mrs)
            .await;

        // Fetch and cache project titles for any new project IDs
        self.cache_project_titles(instance.id, &client, &mrs).await;

        // Refresh gitattributes cache for projects with MRs (if stale or missing)
        self.refresh_gitattributes_for_projects(instance.id, &mrs)
            .await;

        // Sync user avatars (non-fatal)
        self.sync_user_avatars(instance, &mrs).await;

        // Emit purging event
        self.emit_progress(SyncPhase::Purging, "Purging merged/closed MRs");

        // Purge merged/closed MRs
        result.purged_count = self.purge_closed_mrs(instance.id, &mrs).await?;

        // Emit pushing_actions event
        self.emit_progress(SyncPhase::PushingActions, "Processing sync queue");

        // Push pending actions for this instance
        let push_results = self.push_pending_actions(&client).await?;
        result.actions_pushed = push_results.iter().filter(|r| r.success).count() as i64;

        for push_result in &push_results {
            // Emit action-synced event for each processed action
            if let Err(e) = self.app_handle.emit(
                ACTION_SYNCED_EVENT,
                ActionSyncedPayload {
                    action_id: push_result.action.id,
                    action_type: push_result.action.action_type.clone(),
                    success: push_result.success,
                    error: push_result.error.clone(),
                    mr_id: push_result.action.mr_id,
                    local_reference_id: push_result.action.local_reference_id,
                },
            ) {
                log::warn!("Failed to emit action-synced event: {}", e);
            }

            if !push_result.success {
                if let Some(err) = &push_result.error {
                    result
                        .errors
                        .push(format!("Action {}: {}", push_result.action.id, err));
                }
            }
        }

        Ok(result)
    }

    /// Fetch MRs for an instance based on scope configuration.
    async fn fetch_mrs_for_instance(
        &self,
        client: &GitLabClient,
        config: &SyncConfig,
    ) -> Result<Vec<GitLabMergeRequest>, AppError> {
        let mut all_mrs = Vec::new();

        // Validate token and get current user
        let current_user = client.validate_token().await?;
        eprintln!(
            "[sync] Authenticated as user: '{}' (id={})",
            current_user.username, current_user.id
        );

        // Fetch authored MRs if enabled
        if config.sync_authored {
            let query = MergeRequestsQuery {
                state: Some("opened".to_string()),
                scope: Some("created_by_me".to_string()),
                per_page: Some(100),
                ..Default::default()
            };

            eprintln!(
                "[sync] Fetching authored MRs for user '{}', query: {}",
                current_user.username,
                serde_json::to_string(&query).unwrap_or_default()
            );

            let response = client.list_merge_requests(&query).await?;
            eprintln!(
                "[sync] Received {} authored MRs from GitLab",
                response.data.len()
            );
            all_mrs.extend(response.data);
        }

        // Fetch reviewing MRs if enabled
        if config.sync_reviewing {
            let query = MergeRequestsQuery {
                state: Some("opened".to_string()),
                scope: Some("all".to_string()),
                reviewer_username: Some(current_user.username.clone()),
                draft: Some("no".to_string()), // Exclude draft/WIP MRs
                not_author_username: Some(current_user.username.clone()), // Exclude own MRs
                not_approved_by_usernames: Some(current_user.username.clone()), // Exclude already approved
                per_page: Some(100),
                ..Default::default()
            };

            // Log the query parameters so we can verify the username and filters
            eprintln!(
                "[sync] Fetching reviewing MRs for user '{}', query: {}",
                current_user.username,
                serde_json::to_string(&query).unwrap_or_default()
            );

            let response = client.list_merge_requests(&query).await?;
            eprintln!(
                "[sync] Received {} reviewing MRs from GitLab",
                response.data.len()
            );
            // Avoid duplicates (MR could be both authored and assigned for review)
            for mr in response.data {
                if !all_mrs.iter().any(|m: &GitLabMergeRequest| m.id == mr.id) {
                    all_mrs.push(mr);
                }
            }
        }

        // Limit to max MRs per sync
        if all_mrs.len() > config.max_mrs_per_sync {
            all_mrs.truncate(config.max_mrs_per_sync);
        }

        Ok(all_mrs)
    }

    /// Sync a single MR (metadata, diff, comments, approval status).
    async fn sync_mr(
        &self,
        instance_id: i64,
        client: &GitLabClient,
        mr: &GitLabMergeRequest,
    ) -> Result<(), AppError> {
        let start = Instant::now();

        // Check if MR already exists (to determine created vs updated)
        let existing: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM merge_requests WHERE instance_id = ? AND project_id = ? AND iid = ?",
        )
        .bind(instance_id)
        .bind(mr.project_id)
        .bind(mr.iid)
        .fetch_optional(&self.pool)
        .await?;
        let is_new = existing.is_none();

        // Upsert MR metadata and get the canonical DB row id
        // (may differ from mr.id if the row already existed with a different PK)
        let local_mr_id = self.upsert_mr(instance_id, mr).await.map_err(|e| {
            eprintln!("[sync] MR !{}: upsert_mr failed: {}", mr.iid, e);
            e
        })?;

        // Emit created or updated event
        self.emit_mr_updated(
            local_mr_id,
            instance_id,
            mr.iid,
            if is_new {
                MrUpdateType::Created
            } else {
                MrUpdateType::Updated
            },
        );

        // Fetch and store approval status + per-reviewer data
        match client.get_mr_approvals(mr.project_id, mr.iid).await {
            Ok(approvals) => {
                // Get current user to check if they've approved
                let current_user = client.validate_token().await.ok();
                let user_has_approved = current_user.map_or(false, |u| {
                    approvals.approved_by.iter().any(|a| a.user.id == u.id)
                });

                let approval_status = if approvals.approved {
                    "approved"
                } else {
                    "pending"
                };
                let approvals_count = approvals.approvals_required - approvals.approvals_left;

                sqlx::query(
                    "UPDATE merge_requests SET
                        approval_status = ?,
                        approvals_count = ?,
                        approvals_required = ?,
                        user_has_approved = ?
                     WHERE id = ?",
                )
                .bind(approval_status)
                .bind(approvals_count)
                .bind(approvals.approvals_required)
                .bind(user_has_approved)
                .bind(local_mr_id)
                .execute(&self.pool)
                .await?;

                // Upsert per-reviewer status
                self.upsert_reviewers(local_mr_id, mr, &approvals).await;
            }
            Err(e) => {
                // Non-critical - log and continue
                log::warn!("Failed to fetch approvals for MR {}: {}", mr.iid, e);
            }
        }

        // Emit fetching_diff event
        self.emit_progress(
            SyncPhase::FetchingDiff,
            format!("Fetching diff for MR !{}", mr.iid),
        );

        // Fetch and store diff
        match client.get_merge_request_diff(mr.project_id, mr.iid).await {
            Ok(diff) => {
                // Get previously cached SHAs before upserting (for skip-unchanged logic)
                let prev_shas =
                    crate::db::file_cache::get_cached_diff_shas(&self.pool, local_mr_id)
                        .await
                        .unwrap_or(None);

                self.upsert_diff(local_mr_id, &diff).await.map_err(|e| {
                    eprintln!("[sync] MR !{}: upsert_diff failed: {}", mr.iid, e);
                    e
                })?;

                // Emit diff_updated event
                self.emit_mr_updated(local_mr_id, instance_id, mr.iid, MrUpdateType::DiffUpdated);

                // Pre-cache full file content for instant viewing
                self.cache_file_contents(
                    local_mr_id,
                    mr.project_id,
                    instance_id,
                    client,
                    &diff,
                    prev_shas.as_ref(),
                )
                .await;
            }
            Err(e) => {
                self.log_sync_operation(
                    "fetch_diff",
                    "error",
                    Some(local_mr_id),
                    Some(e.to_string()),
                    None,
                )
                .await?;
            }
        }

        // Emit fetching_comments event
        self.emit_progress(
            SyncPhase::FetchingComments,
            format!("Fetching comments for MR !{}", mr.iid),
        );

        // Fetch and store comments
        match client.list_discussions(mr.project_id, mr.iid).await {
            Ok(discussions) => {
                self.upsert_discussions(local_mr_id, &discussions)
                    .await
                    .map_err(|e| {
                        eprintln!("[sync] MR !{}: upsert_discussions failed: {}", mr.iid, e);
                        e
                    })?;

                // Emit comments_updated event
                self.emit_mr_updated(
                    local_mr_id,
                    instance_id,
                    mr.iid,
                    MrUpdateType::CommentsUpdated,
                );
            }
            Err(e) => {
                self.log_sync_operation(
                    "fetch_comments",
                    "error",
                    Some(local_mr_id),
                    Some(e.to_string()),
                    None,
                )
                .await?;
            }
        }

        // Log successful sync
        self.log_sync_operation(
            "sync_mr",
            "success",
            Some(local_mr_id),
            None,
            Some(start.elapsed().as_millis() as i64),
        )
        .await?;

        Ok(())
    }

    /// Fetch and cache project titles for any project IDs not already in the projects table.
    async fn cache_project_titles(
        &self,
        instance_id: i64,
        client: &GitLabClient,
        mrs: &[GitLabMergeRequest],
    ) {
        // Collect unique project IDs
        let mut project_ids: Vec<i64> = mrs.iter().map(|mr| mr.project_id).collect();
        project_ids.sort_unstable();
        project_ids.dedup();

        // Find which ones are missing from cache
        let missing =
            match project::get_missing_project_ids(&self.pool, instance_id, &project_ids).await {
                Ok(ids) => ids,
                Err(e) => {
                    log::warn!("Failed to check cached project IDs: {}", e);
                    return;
                }
            };

        if missing.is_empty() {
            return;
        }

        eprintln!("[sync] Fetching {} missing project title(s)", missing.len());

        for project_id in missing {
            match client.get_project(project_id).await {
                Ok(gitlab_project) => {
                    let project = Project {
                        id: gitlab_project.id,
                        instance_id,
                        name: gitlab_project.name,
                        name_with_namespace: gitlab_project.name_with_namespace,
                        path_with_namespace: gitlab_project.path_with_namespace,
                        web_url: gitlab_project.web_url,
                        created_at: gitlab_project.created_at,
                        updated_at: gitlab_project.updated_at,
                    };
                    if let Err(e) = project::upsert_project(&self.pool, &project).await {
                        log::warn!("Failed to cache project {}: {}", project_id, e);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to fetch project {}: {}", project_id, e);
                }
            }
        }
    }

    /// Refresh gitattributes cache for all projects that have MRs in the current sync.
    ///
    /// Only refreshes projects whose cache is stale (>24h) or missing.
    /// Runs alongside MR sync but doesn't block or slow down MR data processing.
    async fn refresh_gitattributes_for_projects(
        &self,
        instance_id: i64,
        mrs: &[GitLabMergeRequest],
    ) {
        // Collect unique project IDs
        let mut project_ids: Vec<i64> = mrs.iter().map(|mr| mr.project_id).collect();
        project_ids.sort_unstable();
        project_ids.dedup();

        for project_id in project_ids {
            match crate::commands::gitattributes::refresh_gitattributes_if_stale(
                &self.pool,
                instance_id,
                project_id,
            )
            .await
            {
                Ok(refreshed) => {
                    if refreshed {
                        eprintln!(
                            "[sync] Refreshed gitattributes cache for project {}",
                            project_id
                        );
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Failed to refresh gitattributes for project {}: {}",
                        project_id,
                        e
                    );
                }
            }
        }
    }

    /// Sync user avatars for MR authors and reviewers.
    async fn sync_user_avatars(&self, instance: &GitLabInstanceRow, mrs: &[GitLabMergeRequest]) {
        use std::collections::HashMap;

        // Collect unique (username, avatar_url) pairs from authors and reviewers
        let mut users: HashMap<String, Option<String>> = HashMap::new();
        for mr in mrs {
            users
                .entry(mr.author.username.clone())
                .or_insert_with(|| mr.author.avatar_url.clone());
            if let Some(reviewers) = &mr.reviewers {
                for r in reviewers {
                    users
                        .entry(r.username.clone())
                        .or_insert_with(|| r.avatar_url.clone());
                }
            }
        }

        let user_list: Vec<(String, Option<String>)> = users.into_iter().collect();

        match crate::services::avatar::sync_avatars(
            &self.pool,
            instance.id,
            &instance.url,
            instance.session_cookie.as_deref(),
            &user_list,
        )
        .await
        {
            Ok(count) => {
                if count > 0 {
                    eprintln!(
                        "[sync] Downloaded {} avatar(s) for instance {}",
                        count, instance.id
                    );
                }
            }
            Err(e) => {
                eprintln!("[sync] Avatar sync error (non-fatal): {}", e);
            }
        }
    }

    /// Upsert MR metadata into the database.
    /// Returns the canonical DB row id (which may differ from mr.id if the row already existed).
    async fn upsert_mr(&self, instance_id: i64, mr: &GitLabMergeRequest) -> Result<i64, AppError> {
        let created_at = parse_iso_timestamp(&mr.created_at);
        let updated_at = parse_iso_timestamp(&mr.updated_at);
        let merged_at = mr.merged_at.as_ref().map(|s| parse_iso_timestamp(s));
        let labels_json = serde_json::to_string(&mr.labels).unwrap_or_else(|_| "[]".to_string());
        let reviewers_json = mr
            .reviewers
            .as_ref()
            .map(|r| {
                serde_json::to_string(&r.iter().map(|u| &u.username).collect::<Vec<_>>())
                    .unwrap_or_else(|_| "[]".to_string())
            })
            .unwrap_or_else(|| "[]".to_string());
        let project_name = extract_project_path(&mr.web_url);
        let head_pipeline_status = mr.head_pipeline.as_ref().map(|p| p.status.clone());

        sqlx::query(
            r#"
            INSERT INTO merge_requests (
                id, instance_id, iid, project_id, title, description,
                author_username, source_branch, target_branch, state, web_url,
                created_at, updated_at, merged_at, labels, reviewers, cached_at,
                project_name, head_pipeline_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(instance_id, project_id, iid) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                state = excluded.state,
                updated_at = excluded.updated_at,
                merged_at = excluded.merged_at,
                labels = excluded.labels,
                reviewers = excluded.reviewers,
                cached_at = excluded.cached_at,
                project_name = excluded.project_name,
                head_pipeline_status = excluded.head_pipeline_status
            "#,
        )
        .bind(mr.id)
        .bind(instance_id)
        .bind(mr.iid)
        .bind(mr.project_id)
        .bind(&mr.title)
        .bind(&mr.description)
        .bind(&mr.author.username)
        .bind(&mr.source_branch)
        .bind(&mr.target_branch)
        .bind(&mr.state)
        .bind(&mr.web_url)
        .bind(created_at)
        .bind(updated_at)
        .bind(merged_at)
        .bind(&labels_json)
        .bind(&reviewers_json)
        .bind(now())
        .bind(&project_name)
        .bind(&head_pipeline_status)
        .execute(&self.pool)
        .await?;

        // Read back the canonical DB row id (may differ from mr.id if row already existed)
        let (db_id,): (i64,) = sqlx::query_as(
            "SELECT id FROM merge_requests WHERE instance_id = ? AND project_id = ? AND iid = ?",
        )
        .bind(instance_id)
        .bind(mr.project_id)
        .bind(mr.iid)
        .fetch_one(&self.pool)
        .await?;

        Ok(db_id)
    }

    /// Upsert diff data into the database.
    async fn upsert_diff(&self, mr_id: i64, diff: &GitLabDiffVersion) -> Result<(), AppError> {
        // Calculate file stats
        let file_count = diff.diffs.len() as i64;
        let mut additions = 0i64;
        let mut deletions = 0i64;
        let mut combined_content = String::new();

        for file_diff in &diff.diffs {
            // Count additions/deletions from diff content
            for line in file_diff.diff.lines() {
                if line.starts_with('+') && !line.starts_with("+++") {
                    additions += 1;
                } else if line.starts_with('-') && !line.starts_with("---") {
                    deletions += 1;
                }
            }

            // Build combined diff content
            combined_content.push_str(&format!("--- a/{}\n", file_diff.old_path));
            combined_content.push_str(&format!("+++ b/{}\n", file_diff.new_path));
            combined_content.push_str(&file_diff.diff);
            combined_content.push('\n');
        }

        // Upsert main diff record
        sqlx::query(
            r#"
            INSERT INTO diffs (mr_id, content, base_sha, head_sha, start_sha, file_count, additions, deletions, cached_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(mr_id) DO UPDATE SET
                content = excluded.content,
                base_sha = excluded.base_sha,
                head_sha = excluded.head_sha,
                start_sha = excluded.start_sha,
                file_count = excluded.file_count,
                additions = excluded.additions,
                deletions = excluded.deletions,
                cached_at = excluded.cached_at
            "#,
        )
        .bind(mr_id)
        .bind(&combined_content)
        .bind(&diff.base_commit_sha)
        .bind(&diff.head_commit_sha)
        .bind(&diff.start_commit_sha)
        .bind(file_count)
        .bind(additions)
        .bind(deletions)
        .bind(now())
        .execute(&self.pool)
        .await?;

        // Delete existing diff files and insert new ones
        sqlx::query("DELETE FROM diff_files WHERE mr_id = ?")
            .bind(mr_id)
            .execute(&self.pool)
            .await?;

        for (position, file_diff) in diff.diffs.iter().enumerate() {
            let change_type = if file_diff.new_file {
                "added"
            } else if file_diff.deleted_file {
                "deleted"
            } else if file_diff.renamed_file {
                "renamed"
            } else {
                "modified"
            };

            // Count per-file additions/deletions
            let mut file_additions = 0i64;
            let mut file_deletions = 0i64;
            for line in file_diff.diff.lines() {
                if line.starts_with('+') && !line.starts_with("+++") {
                    file_additions += 1;
                } else if line.starts_with('-') && !line.starts_with("---") {
                    file_deletions += 1;
                }
            }

            sqlx::query(
                r#"
                INSERT INTO diff_files (mr_id, old_path, new_path, change_type, additions, deletions, file_position, diff_content)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(mr_id)
            .bind(&file_diff.old_path)
            .bind(&file_diff.new_path)
            .bind(change_type)
            .bind(file_additions)
            .bind(file_deletions)
            .bind(position as i64)
            .bind(&file_diff.diff)
            .execute(&self.pool)
            .await?;
        }

        Ok(())
    }

    /// Pre-cache full file content (base + head) for instant diff viewing.
    ///
    /// Iterates over each changed file in the diff, skips binary files,
    /// and fetches both base and head versions from GitLab. Individual
    /// file failures are logged but do not fail the entire sync.
    ///
    /// If `prev_shas` matches the current diff SHAs, all file fetching is
    /// skipped entirely. If SHAs changed, only files without an existing
    /// cached version are fetched.
    async fn cache_file_contents(
        &self,
        mr_id: i64,
        project_id: i64,
        instance_id: i64,
        client: &GitLabClient,
        diff: &GitLabDiffVersion,
        prev_shas: Option<&(String, String)>,
    ) {
        use sha2::{Digest, Sha256};

        // If base_sha and head_sha are unchanged, skip all file fetching
        if let Some((prev_base, prev_head)) = prev_shas {
            if prev_base == &diff.base_commit_sha && prev_head == &diff.head_commit_sha {
                log::debug!(
                    "SHAs unchanged for MR {}, skipping file content fetch",
                    mr_id
                );
                return;
            }

            // SHAs changed — purge stale cached file versions so they get re-fetched
            log::debug!(
                "SHAs changed for MR {}, purging cached file versions",
                mr_id
            );
            if let Err(e) =
                crate::db::file_cache::delete_file_versions_for_mr(&self.pool, mr_id).await
            {
                log::warn!("Failed to purge file versions for MR {}: {}", mr_id, e);
            }
        }

        let instance_id_str = instance_id.to_string();
        let mut skipped = 0u32;

        for file_diff in &diff.diffs {
            // Skip binary files
            if is_binary_extension(&file_diff.new_path) || is_binary_extension(&file_diff.old_path)
            {
                continue;
            }

            let change_type = if file_diff.new_file {
                "added"
            } else if file_diff.deleted_file {
                "deleted"
            } else {
                "modified"
            };

            // Fetch base version for non-added files
            if change_type != "added" {
                // Skip if already cached
                let has_cached = crate::db::file_cache::has_cached_version(
                    &self.pool,
                    mr_id,
                    &file_diff.old_path,
                    "base",
                )
                .await
                .unwrap_or(false);

                if has_cached {
                    skipped += 1;
                } else {
                    match client
                        .get_file_content(project_id, &file_diff.old_path, &diff.base_commit_sha)
                        .await
                    {
                        Ok(content) => {
                            let mut hasher = Sha256::new();
                            hasher.update(content.as_bytes());
                            let sha = format!("{:x}", hasher.finalize());
                            let size_bytes = content.len() as i64;

                            if let Err(e) = crate::db::file_cache::upsert_file_blob(
                                &self.pool, &sha, &content, size_bytes,
                            )
                            .await
                            {
                                log::warn!(
                                    "Failed to cache base blob for {}: {}",
                                    file_diff.old_path,
                                    e
                                );
                            }
                            if let Err(e) = crate::db::file_cache::upsert_file_version(
                                &self.pool,
                                mr_id,
                                &file_diff.old_path,
                                "base",
                                &sha,
                                &instance_id_str,
                                project_id,
                            )
                            .await
                            {
                                log::warn!(
                                    "Failed to cache base version for {}: {}",
                                    file_diff.old_path,
                                    e
                                );
                            }
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to fetch base content for {}: {}",
                                file_diff.old_path,
                                e
                            );
                        }
                    }
                }
            }

            // Fetch head version for non-deleted files
            if change_type != "deleted" {
                // Skip if already cached
                let has_cached = crate::db::file_cache::has_cached_version(
                    &self.pool,
                    mr_id,
                    &file_diff.new_path,
                    "head",
                )
                .await
                .unwrap_or(false);

                if has_cached {
                    skipped += 1;
                } else {
                    match client
                        .get_file_content(project_id, &file_diff.new_path, &diff.head_commit_sha)
                        .await
                    {
                        Ok(content) => {
                            let mut hasher = Sha256::new();
                            hasher.update(content.as_bytes());
                            let sha = format!("{:x}", hasher.finalize());
                            let size_bytes = content.len() as i64;

                            if let Err(e) = crate::db::file_cache::upsert_file_blob(
                                &self.pool, &sha, &content, size_bytes,
                            )
                            .await
                            {
                                log::warn!(
                                    "Failed to cache head blob for {}: {}",
                                    file_diff.new_path,
                                    e
                                );
                            }
                            if let Err(e) = crate::db::file_cache::upsert_file_version(
                                &self.pool,
                                mr_id,
                                &file_diff.new_path,
                                "head",
                                &sha,
                                &instance_id_str,
                                project_id,
                            )
                            .await
                            {
                                log::warn!(
                                    "Failed to cache head version for {}: {}",
                                    file_diff.new_path,
                                    e
                                );
                            }
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to fetch head content for {}: {}",
                                file_diff.new_path,
                                e
                            );
                        }
                    }
                }
            }
        }

        if skipped > 0 {
            log::debug!(
                "Skipped {} already-cached file versions for MR {}",
                skipped,
                mr_id
            );
        }
    }

    /// Upsert discussions (comments) into the database.
    async fn upsert_discussions(
        &self,
        mr_id: i64,
        discussions: &[GitLabDiscussion],
    ) -> Result<(), AppError> {
        for discussion in discussions {
            for note in &discussion.notes {
                let file_path = note
                    .position
                    .as_ref()
                    .and_then(|p| p.new_path.as_ref().or(p.old_path.as_ref()));
                let old_line = note.position.as_ref().and_then(|p| p.old_line);
                let new_line = note.position.as_ref().and_then(|p| p.new_line);

                let created_at = parse_iso_timestamp(&note.created_at);
                let updated_at = parse_iso_timestamp(&note.updated_at);

                sqlx::query(
                    r#"
                    INSERT INTO comments (
                        id, mr_id, discussion_id, author_username, body,
                        file_path, old_line, new_line, resolved, resolvable, system,
                        created_at, updated_at, cached_at, is_local
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
                    ON CONFLICT(id) DO UPDATE SET
                        body = excluded.body,
                        resolved = excluded.resolved,
                        updated_at = excluded.updated_at,
                        cached_at = excluded.cached_at
                    "#,
                )
                .bind(note.id)
                .bind(mr_id)
                .bind(&discussion.id)
                .bind(&note.author.username)
                .bind(&note.body)
                .bind(file_path)
                .bind(old_line)
                .bind(new_line)
                .bind(note.resolved.unwrap_or(false))
                .bind(note.resolvable)
                .bind(note.system)
                .bind(created_at)
                .bind(updated_at)
                .bind(now())
                .execute(&self.pool)
                .await?;
            }
        }

        // Clean up local comments that have been synced and now exist as GitLab comments.
        // Local comments have negative IDs and is_local=1; once the GitLab version is fetched,
        // the local duplicate should be removed.
        sqlx::query(
            r#"
            DELETE FROM comments
            WHERE mr_id = ? AND is_local = 1 AND id < 0
              AND id IN (
                SELECT local_reference_id FROM sync_queue
                WHERE status IN ('synced', 'discarded') AND local_reference_id IS NOT NULL
              )
            "#,
        )
        .bind(mr_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Upsert per-reviewer approval statuses for a merge request.
    ///
    /// Combines the MR's assigned reviewers list with the approvals endpoint data
    /// to determine each reviewer's status: approved, pending, or (future) changes_requested.
    async fn upsert_reviewers(
        &self,
        mr_id: i64,
        mr: &GitLabMergeRequest,
        approvals: &crate::services::gitlab_client::MergeRequestApprovals,
    ) {
        // Delete existing reviewers for this MR (full replace per sync cycle)
        if let Err(e) = sqlx::query("DELETE FROM mr_reviewers WHERE mr_id = ?")
            .bind(mr_id)
            .execute(&self.pool)
            .await
        {
            log::warn!("Failed to delete old reviewers for MR {}: {}", mr_id, e);
            return;
        }

        // Build a set of approved usernames for quick lookup
        let approved_usernames: std::collections::HashSet<&str> = approvals
            .approved_by
            .iter()
            .map(|a| a.user.username.as_str())
            .collect();

        // Use the MR's reviewers list as the source of truth for who is assigned
        let reviewers = mr.reviewers.as_deref().unwrap_or(&[]);
        for reviewer in reviewers {
            let status = if approved_usernames.contains(reviewer.username.as_str()) {
                "approved"
            } else {
                "pending"
            };

            if let Err(e) = sqlx::query(
                r#"
                INSERT INTO mr_reviewers (mr_id, username, status, cached_at)
                VALUES (?, ?, ?, ?)
                "#,
            )
            .bind(mr_id)
            .bind(&reviewer.username)
            .bind(status)
            .bind(now())
            .execute(&self.pool)
            .await
            {
                log::warn!(
                    "Failed to upsert reviewer {} for MR {}: {}",
                    reviewer.username,
                    mr_id,
                    e
                );
            }
        }

        // Also add approved users who may not be in the reviewers list
        for approved in &approvals.approved_by {
            if !reviewers
                .iter()
                .any(|r| r.username == approved.user.username)
            {
                if let Err(e) = sqlx::query(
                    r#"
                    INSERT OR IGNORE INTO mr_reviewers (mr_id, username, status, cached_at)
                    VALUES (?, ?, 'approved', ?)
                    "#,
                )
                .bind(mr_id)
                .bind(&approved.user.username)
                .bind(now())
                .execute(&self.pool)
                .await
                {
                    log::warn!(
                        "Failed to upsert approved-only reviewer {} for MR {}: {}",
                        approved.user.username,
                        mr_id,
                        e
                    );
                }
            }
        }
    }

    /// Purge merged/closed MRs that are no longer open on GitLab.
    ///
    /// Per FR-005a: "System MUST purge cached MR data immediately when an MR is merged or closed"
    async fn purge_closed_mrs(
        &self,
        instance_id: i64,
        current_mrs: &[GitLabMergeRequest],
    ) -> Result<i64, AppError> {
        // Get all open MR IDs from GitLab
        let open_mr_ids: Vec<i64> = current_mrs
            .iter()
            .filter(|mr| mr.state == "opened")
            .map(|mr| mr.id)
            .collect();

        // Find MR IDs (and iids) that will be purged (to clean up file cache and emit events)
        let purge_rows: Vec<(i64, i64)> = if open_mr_ids.is_empty() {
            sqlx::query_as("SELECT id, iid FROM merge_requests WHERE instance_id = ?")
                .bind(instance_id)
                .fetch_all(&self.pool)
                .await?
        } else {
            let placeholders: Vec<String> =
                (0..open_mr_ids.len()).map(|_| "?".to_string()).collect();
            let query = format!(
                "SELECT id, iid FROM merge_requests WHERE instance_id = ? AND id NOT IN ({})",
                placeholders.join(", ")
            );
            let mut q = sqlx::query_as(&query).bind(instance_id);
            for id in &open_mr_ids {
                q = q.bind(*id);
            }
            q.fetch_all(&self.pool).await?
        };

        // Delete file versions for each purged MR
        for (mr_id, _iid) in &purge_rows {
            if let Err(e) =
                crate::db::file_cache::delete_file_versions_for_mr(&self.pool, *mr_id).await
            {
                log::warn!("Failed to delete file versions for MR {}: {}", mr_id, e);
            }
        }

        // Delete the MRs themselves
        let result = if open_mr_ids.is_empty() {
            sqlx::query("DELETE FROM merge_requests WHERE instance_id = ?")
                .bind(instance_id)
                .execute(&self.pool)
                .await?
        } else {
            let placeholders: Vec<String> =
                (0..open_mr_ids.len()).map(|_| "?".to_string()).collect();
            let query = format!(
                "DELETE FROM merge_requests WHERE instance_id = ? AND id NOT IN ({})",
                placeholders.join(", ")
            );
            let mut query_builder = sqlx::query(&query).bind(instance_id);
            for id in &open_mr_ids {
                query_builder = query_builder.bind(*id);
            }
            query_builder.execute(&self.pool).await?
        };

        let purged = result.rows_affected() as i64;

        // Emit purged events for each removed MR
        for (mr_id, iid) in &purge_rows {
            self.emit_mr_updated(*mr_id, instance_id, *iid, MrUpdateType::Purged);
        }

        // Clean up orphaned blobs after file version deletion
        if !purge_rows.is_empty() {
            if let Err(e) = crate::db::file_cache::delete_orphaned_blobs(&self.pool).await {
                log::warn!("Failed to delete orphaned blobs: {}", e);
            }
        }

        if purged > 0 {
            self.log_sync_operation(
                "purge_mrs",
                "success",
                None,
                Some(format!("Purged {} merged/closed MRs", purged)),
                None,
            )
            .await?;
        }

        Ok(purged)
    }

    /// Push pending actions to GitLab.
    async fn push_pending_actions(
        &self,
        client: &GitLabClient,
    ) -> Result<Vec<ProcessResult>, AppError> {
        sync_processor::process_pending_actions(client, &self.pool).await
    }

    /// Flush only approval-type pending actions immediately.
    ///
    /// Fetches pending actions matching any of the given types, creates a
    /// GitLab client for each instance, and processes each action. Other
    /// queued action types are left untouched. If no matching actions are
    /// pending, this is a no-op.
    async fn flush_actions_by_types(&self, action_types: &[ActionType]) -> Result<(), AppError> {
        // Collect pending actions for all requested types
        let mut actions = Vec::new();
        for action_type in action_types {
            actions
                .extend(sync_queue::get_pending_actions_by_type(&self.pool, *action_type).await?);
        }

        if actions.is_empty() {
            eprintln!("[sync] No pending actions to flush for {:?}", action_types);
            return Ok(());
        }

        // Sort by created_at so actions are processed in order
        actions.sort_by_key(|a| a.created_at);

        eprintln!(
            "[sync] Flushing {} action(s) for {:?}",
            actions.len(),
            action_types
        );

        // Get all instances to create clients
        let instances = self.get_gitlab_instances().await?;

        for action in &actions {
            // Find the instance for this action's MR
            let instance_id: Option<i64> =
                sqlx::query_scalar("SELECT instance_id FROM merge_requests WHERE id = ?")
                    .bind(action.mr_id)
                    .fetch_optional(&self.pool)
                    .await?;

            let Some(instance_id) = instance_id else {
                eprintln!(
                    "[sync] No instance found for MR {} (action {}), skipping",
                    action.mr_id, action.id
                );
                continue;
            };

            let Some(instance) = instances.iter().find(|i| i.id == instance_id) else {
                eprintln!(
                    "[sync] Instance {} not found for action {}, skipping",
                    instance_id, action.id
                );
                continue;
            };

            let Some(token) = &instance.token else {
                eprintln!(
                    "[sync] No token for instance {} (action {}), skipping",
                    instance.url, action.id
                );
                continue;
            };

            let client = match GitLabClient::new(GitLabClientConfig {
                base_url: instance.url.clone(),
                token: token.clone(),
                timeout_secs: 30,
            }) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!(
                        "[sync] Failed to create client for instance {}: {}",
                        instance.url, e
                    );
                    continue;
                }
            };

            let result = sync_processor::process_action(&client, &self.pool, action).await;

            // Emit action-synced event
            if let Err(e) = self.app_handle.emit(
                ACTION_SYNCED_EVENT,
                ActionSyncedPayload {
                    action_id: action.id,
                    action_type: action.action_type.clone(),
                    success: result.success,
                    error: result.error.clone(),
                    mr_id: action.mr_id,
                    local_reference_id: action.local_reference_id,
                },
            ) {
                log::warn!("Failed to emit action-synced event: {}", e);
            }

            if result.success {
                eprintln!(
                    "[sync] Flushed action {} ({}) successfully",
                    action.id, action.action_type
                );
            } else if let Some(err) = &result.error {
                eprintln!(
                    "[sync] Action {} ({}) failed: {}",
                    action.id, action.action_type, err
                );
            }
        }

        Ok(())
    }

    /// Check if an MR is ready to merge based on its DB state.
    ///
    /// Ready condition: approval_status = 'approved' AND approvals_count >= approvals_required
    /// AND head_pipeline_status = 'success'.
    fn is_mr_ready(row: &MrReadyState) -> bool {
        row.approval_status.as_deref() == Some("approved")
            && row.approvals_count.unwrap_or(0) >= row.approvals_required.unwrap_or(1)
            && row.head_pipeline_status.as_deref() == Some("success")
    }

    /// Query the ready-to-merge state for a set of MR IDs from the database.
    ///
    /// Returns a map of MR ID → ready state (true/false). MRs not in the DB
    /// are not included (meaning they were new and had no prior state).
    async fn get_ready_states(&self, mr_ids: &[i64]) -> std::collections::HashMap<i64, bool> {
        let mut result = std::collections::HashMap::new();
        if mr_ids.is_empty() {
            return result;
        }

        let placeholders: Vec<String> = (0..mr_ids.len()).map(|_| "?".to_string()).collect();
        let query = format!(
            "SELECT id, approval_status, approvals_count, approvals_required, head_pipeline_status FROM merge_requests WHERE id IN ({})",
            placeholders.join(", ")
        );

        let mut q = sqlx::query_as::<_, MrReadyState>(&query);
        for id in mr_ids {
            q = q.bind(*id);
        }

        match q.fetch_all(&self.pool).await {
            Ok(rows) => {
                for row in rows {
                    result.insert(row.id, Self::is_mr_ready(&row));
                }
            }
            Err(e) => {
                log::warn!("Failed to query pre-sync MR states: {}", e);
            }
        }

        result
    }

    /// Check for MR ready-to-merge transitions and emit notification events.
    ///
    /// Compares pre-sync state with post-sync state. Only emits for MRs that
    /// transitioned from not-ready to ready, and only if notification settings
    /// have mr_ready_to_merge enabled.
    async fn check_mr_ready_transitions(
        &mut self,
        mr_ids: &[i64],
        pre_sync_ready: &std::collections::HashMap<i64, bool>,
        mrs: &[GitLabMergeRequest],
    ) {
        // Check notification settings first
        let settings =
            match crate::db::notification_settings::get_notification_settings(&self.pool).await {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("Failed to read notification settings: {}", e);
                    return;
                }
            };

        if !settings.mr_ready_to_merge {
            return;
        }

        // Get post-sync ready states
        let post_sync_ready = self.get_ready_states(mr_ids).await;

        for mr in mrs {
            let mr_id = mr.id;

            // Skip if already notified this session
            if self.notified_mr_ready.contains(&mr_id) {
                continue;
            }

            let was_ready = pre_sync_ready.get(&mr_id).copied().unwrap_or(false);
            let is_ready = post_sync_ready.get(&mr_id).copied().unwrap_or(false);

            // Only emit on transition: not ready → ready
            if !was_ready && is_ready {
                let project_name = extract_project_path(&mr.web_url);

                if let Err(e) = self.app_handle.emit(
                    MR_READY_EVENT,
                    MrReadyPayload {
                        title: mr.title.clone(),
                        project_name,
                        web_url: mr.web_url.clone(),
                    },
                ) {
                    log::warn!("Failed to emit mr-ready event: {}", e);
                }

                self.notified_mr_ready.insert(mr_id);
                eprintln!(
                    "[sync] MR !{} is now ready to merge, notification emitted",
                    mr.iid
                );
            }
        }
    }

    /// Get all GitLab instances from the database.
    async fn get_gitlab_instances(&self) -> Result<Vec<GitLabInstanceRow>, AppError> {
        let instances = sqlx::query_as::<_, GitLabInstanceRow>(
            "SELECT id, url, name, token, session_cookie FROM gitlab_instances ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(instances)
    }

    /// Log a sync operation to the sync_log table.
    pub async fn log_sync_operation(
        &self,
        operation: &str,
        status: &str,
        mr_id: Option<i64>,
        message: Option<String>,
        duration_ms: Option<i64>,
    ) -> Result<(), AppError> {
        // Insert the log entry
        sqlx::query(
            r#"
            INSERT INTO sync_log (operation, status, mr_id, message, duration_ms, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(operation)
        .bind(status)
        .bind(mr_id)
        .bind(&message)
        .bind(duration_ms)
        .bind(now())
        .execute(&self.pool)
        .await?;

        // Prune old log entries (keep only MAX_LOG_ENTRIES)
        sqlx::query(
            r#"
            DELETE FROM sync_log WHERE id NOT IN (
                SELECT id FROM sync_log ORDER BY timestamp DESC LIMIT ?
            )
            "#,
        )
        .bind(MAX_LOG_ENTRIES)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get recent sync log entries.
    pub async fn get_sync_log(&self, limit: i64) -> Result<Vec<SyncLogEntry>, AppError> {
        let entries = sqlx::query_as::<_, SyncLogEntry>(
            "SELECT id, operation, status, mr_id, message, duration_ms, timestamp FROM sync_log ORDER BY timestamp DESC LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(entries)
    }

    /// Get the current cache (database) size in bytes.
    ///
    /// Uses SQLite's page_count * page_size to calculate the database file size.
    async fn get_cache_size(&self) -> Result<i64, AppError> {
        let result: (i64, i64) = sqlx::query_as(
            "SELECT page_count, page_size FROM pragma_page_count(), pragma_page_size()",
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(result.0 * result.1)
    }
}

/// Lightweight struct for querying MR ready-to-merge state from the database.
#[derive(Debug, Clone, sqlx::FromRow)]
struct MrReadyState {
    id: i64,
    approval_status: Option<String>,
    approvals_count: Option<i64>,
    approvals_required: Option<i64>,
    head_pipeline_status: Option<String>,
}

/// Database row for GitLab instance.
#[derive(Debug, Clone, sqlx::FromRow)]
struct GitLabInstanceRow {
    id: i64,
    url: String,
    #[allow(dead_code)]
    name: Option<String>,
    token: Option<String>,
    session_cookie: Option<String>,
}

/// Extract the project path with namespace from a GitLab MR web URL.
///
/// e.g., "https://gitlab.com/group/project/-/merge_requests/1" -> "group/project"
fn extract_project_path(web_url: &str) -> String {
    // Strip the scheme and host, then find everything before /-/merge_requests/
    if let Some(path_start) = web_url.find("://") {
        let after_scheme = &web_url[path_start + 3..];
        // Skip the host portion (find the first '/')
        if let Some(slash_idx) = after_scheme.find('/') {
            let path = &after_scheme[slash_idx + 1..];
            if let Some(mr_idx) = path.find("/-/merge_requests/") {
                return path[..mr_idx].to_string();
            }
        }
    }
    String::new()
}

/// Known binary file extensions to skip during file content caching.
const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "bmp", "tiff", "mp4", "mp3", "wav", "zip",
    "tar", "gz", "rar", "7z", "exe", "dll", "so", "dylib", "woff", "woff2", "ttf", "eot", "pdf",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx",
];

/// Check if a file path has a known binary extension.
fn is_binary_extension(path: &str) -> bool {
    if let Some(ext) = path.rsplit('.').next() {
        BINARY_EXTENSIONS.contains(&ext.to_lowercase().as_str())
    } else {
        false
    }
}

/// Parse ISO 8601 timestamp to Unix timestamp.
fn parse_iso_timestamp(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = SyncConfig::default();
        assert_eq!(config.interval_secs, DEFAULT_SYNC_INTERVAL_SECS);
        assert!(!config.sync_authored); // Don't sync own MRs by default
        assert!(config.sync_reviewing);
        assert_eq!(config.max_mrs_per_sync, 100);
    }

    #[test]
    fn test_parse_iso_timestamp() {
        let ts = parse_iso_timestamp("2024-01-15T10:30:00Z");
        assert!(ts > 0);

        let ts2 = parse_iso_timestamp("2024-01-15T10:30:00+00:00");
        assert_eq!(ts, ts2);

        // Invalid timestamp should return 0
        let ts_invalid = parse_iso_timestamp("invalid");
        assert_eq!(ts_invalid, 0);
    }

    #[test]
    fn test_extract_project_path() {
        assert_eq!(
            extract_project_path("https://gitlab.com/group/project/-/merge_requests/1"),
            "group/project"
        );
        assert_eq!(
            extract_project_path("https://gitlab.com/group/subgroup/project/-/merge_requests/42"),
            "group/subgroup/project"
        );
        assert_eq!(
            extract_project_path("https://self-hosted.example.com/team/repo/-/merge_requests/100"),
            "team/repo"
        );
        assert_eq!(extract_project_path("invalid-url"), "");
    }

    #[test]
    fn test_sync_status_initial() {
        let status = SyncStatus::default();

        assert!(!status.is_syncing);
        assert!(status.last_sync_time.is_none());
    }
}
