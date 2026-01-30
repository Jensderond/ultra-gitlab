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
use crate::services::gitlab_client::{
    GitLabClient, GitLabClientConfig, GitLabDiffVersion, GitLabDiscussion, GitLabMergeRequest,
    MergeRequestsQuery,
};
use crate::services::sync_processor::{self, ProcessResult};
use crate::services::sync_queue;
use crate::services::CredentialService;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{mpsc, Mutex, RwLock};
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
            sync_authored: true,
            sync_reviewing: true,
            max_mrs_per_sync: 100,
        }
    }
}

/// Status of the sync engine.
#[derive(Debug, Clone, Serialize)]
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

    /// Update the sync configuration.
    UpdateConfig(SyncConfig),

    /// Stop the sync engine.
    Stop,
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

    /// Whether the engine is running.
    is_running: Arc<AtomicBool>,

    /// Command channel sender.
    command_tx: Option<mpsc::Sender<SyncCommand>>,
}

impl SyncEngine {
    /// Create a new sync engine.
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            config: Arc::new(RwLock::new(SyncConfig::default())),
            status: Arc::new(RwLock::new(SyncStatus {
                is_syncing: false,
                last_sync_time: None,
                last_error: None,
                pending_actions: 0,
                failed_actions: 0,
                last_sync_mr_count: 0,
                cache_size_bytes: 0,
                cache_size_warning: false,
            })),
            is_running: Arc::new(AtomicBool::new(false)),
            command_tx: None,
        }
    }

    /// Get a clone of the current status.
    pub async fn get_status(&self) -> SyncStatus {
        self.status.read().await.clone()
    }

    /// Get the current configuration.
    pub async fn get_config(&self) -> SyncConfig {
        self.config.read().await.clone()
    }

    /// Update the configuration.
    pub async fn update_config(&self, config: SyncConfig) {
        *self.config.write().await = config.clone();

        // If running, notify the engine of the config change
        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SyncCommand::UpdateConfig(config)).await;
        }
    }

    /// Trigger an immediate sync.
    pub async fn trigger_sync(&self) -> Result<(), AppError> {
        if let Some(tx) = &self.command_tx {
            tx.send(SyncCommand::TriggerSync)
                .await
                .map_err(|_| AppError::internal("Sync engine not running"))?;
            Ok(())
        } else {
            // If not running as background task, run sync directly
            self.run_sync().await?;
            Ok(())
        }
    }

    /// Stop the sync engine.
    pub async fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);

        if let Some(tx) = &self.command_tx {
            let _ = tx.send(SyncCommand::Stop).await;
        }
    }

    /// Start the background sync loop.
    ///
    /// This spawns a background task that runs sync at the configured interval.
    /// Returns a handle to control the sync engine.
    pub fn start_background(pool: DbPool, config: SyncConfig) -> Arc<Mutex<SyncEngine>> {
        let (tx, mut rx) = mpsc::channel::<SyncCommand>(16);

        let engine = Arc::new(Mutex::new(SyncEngine {
            pool: pool.clone(),
            config: Arc::new(RwLock::new(config.clone())),
            status: Arc::new(RwLock::new(SyncStatus {
                is_syncing: false,
                last_sync_time: None,
                last_error: None,
                pending_actions: 0,
                failed_actions: 0,
                last_sync_mr_count: 0,
                cache_size_bytes: 0,
                cache_size_warning: false,
            })),
            is_running: Arc::new(AtomicBool::new(true)),
            command_tx: Some(tx),
        }));

        let engine_clone = engine.clone();

        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(config.interval_secs));

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let engine = engine_clone.lock().await;
                        if !engine.is_running.load(Ordering::SeqCst) {
                            break;
                        }

                        // Run sync
                        if let Err(e) = engine.run_sync().await {
                            let mut status = engine.status.write().await;
                            status.last_error = Some(e.to_string());
                        }
                    }
                    Some(cmd) = rx.recv() => {
                        match cmd {
                            SyncCommand::TriggerSync => {
                                let engine = engine_clone.lock().await;
                                if let Err(e) = engine.run_sync().await {
                                    let mut status = engine.status.write().await;
                                    status.last_error = Some(e.to_string());
                                }
                            }
                            SyncCommand::UpdateConfig(new_config) => {
                                interval = time::interval(Duration::from_secs(new_config.interval_secs));
                            }
                            SyncCommand::Stop => {
                                break;
                            }
                        }
                    }
                }
            }
        });

        engine
    }

    /// Run a single sync operation.
    ///
    /// This is the main sync logic that:
    /// 1. Fetches MRs from all configured GitLab instances
    /// 2. Fetches diffs and comments for each MR
    /// 3. Pushes pending local actions to GitLab
    /// 4. Purges merged/closed MRs
    pub async fn run_sync(&self) -> Result<SyncResult, AppError> {
        let start = Instant::now();

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

        for instance in instances {
            match self.sync_instance(&instance).await {
                Ok(instance_result) => {
                    result.mr_count += instance_result.mr_count;
                    result.purged_count += instance_result.purged_count;
                    result.actions_pushed += instance_result.actions_pushed;
                    result.errors.extend(instance_result.errors);
                }
                Err(e) => {
                    result.errors.push(format!("Instance {}: {}", instance.url, e));
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

            if result.errors.is_empty() {
                status.last_error = None;
            } else {
                status.last_error = Some(result.errors.join("; "));
            }

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

        // Log the sync operation
        self.log_sync_operation(
            "sync_complete",
            if result.errors.is_empty() { "success" } else { "error" },
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
    async fn sync_instance(&self, instance: &GitLabInstanceRow) -> Result<SyncResult, AppError> {
        let config = self.config.read().await;

        // Get token from keychain
        let token = CredentialService::get_token(&instance.url)?;

        // Create GitLab client
        let client = GitLabClient::new(GitLabClientConfig {
            base_url: instance.url.clone(),
            token,
            timeout_secs: 30,
        })?;

        let mut result = SyncResult {
            mr_count: 0,
            purged_count: 0,
            actions_pushed: 0,
            errors: Vec::new(),
            duration_ms: 0,
        };

        // Fetch MRs based on scope
        let mrs = self
            .fetch_mrs_for_instance(&client, &config)
            .await
            .unwrap_or_else(|e| {
                result.errors.push(format!("Failed to fetch MRs: {}", e));
                Vec::new()
            });

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

        // Purge merged/closed MRs
        result.purged_count = self.purge_closed_mrs(instance.id, &mrs).await?;

        // Push pending actions for this instance
        let push_results = self.push_pending_actions(&client).await?;
        result.actions_pushed = push_results
            .iter()
            .filter(|r| r.success)
            .count() as i64;

        for push_result in &push_results {
            if !push_result.success {
                if let Some(err) = &push_result.error {
                    result.errors.push(format!("Action {}: {}", push_result.action.id, err));
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

        // Fetch authored MRs if enabled
        if config.sync_authored {
            let query = MergeRequestsQuery {
                state: Some("opened".to_string()),
                scope: Some("created_by_me".to_string()),
                per_page: Some(100),
                ..Default::default()
            };

            match client.list_merge_requests(&query).await {
                Ok(response) => {
                    all_mrs.extend(response.data);
                }
                Err(e) => {
                    return Err(e);
                }
            }
        }

        // Fetch reviewing MRs if enabled
        if config.sync_reviewing {
            let query = MergeRequestsQuery {
                state: Some("opened".to_string()),
                reviewer_username: Some(current_user.username.clone()),
                per_page: Some(100),
                ..Default::default()
            };

            match client.list_merge_requests(&query).await {
                Ok(response) => {
                    // Avoid duplicates (MR could be both authored and assigned for review)
                    for mr in response.data {
                        if !all_mrs.iter().any(|m: &GitLabMergeRequest| m.id == mr.id) {
                            all_mrs.push(mr);
                        }
                    }
                }
                Err(e) => {
                    return Err(e);
                }
            }
        }

        // Limit to max MRs per sync
        if all_mrs.len() > config.max_mrs_per_sync {
            all_mrs.truncate(config.max_mrs_per_sync);
        }

        Ok(all_mrs)
    }

    /// Sync a single MR (metadata, diff, comments).
    async fn sync_mr(
        &self,
        instance_id: i64,
        client: &GitLabClient,
        mr: &GitLabMergeRequest,
    ) -> Result<(), AppError> {
        let start = Instant::now();

        // Upsert MR metadata
        self.upsert_mr(instance_id, mr).await?;

        // Fetch and store diff
        match client.get_merge_request_diff(mr.project_id, mr.iid).await {
            Ok(diff) => {
                self.upsert_diff(mr.id, &diff).await?;
            }
            Err(e) => {
                self.log_sync_operation(
                    "fetch_diff",
                    "error",
                    Some(mr.id),
                    Some(e.to_string()),
                    None,
                )
                .await?;
            }
        }

        // Fetch and store comments
        match client.list_discussions(mr.project_id, mr.iid).await {
            Ok(discussions) => {
                self.upsert_discussions(mr.id, &discussions).await?;
            }
            Err(e) => {
                self.log_sync_operation(
                    "fetch_comments",
                    "error",
                    Some(mr.id),
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
            Some(mr.id),
            None,
            Some(start.elapsed().as_millis() as i64),
        )
        .await?;

        Ok(())
    }

    /// Upsert MR metadata into the database.
    async fn upsert_mr(
        &self,
        instance_id: i64,
        mr: &GitLabMergeRequest,
    ) -> Result<(), AppError> {
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

        sqlx::query(
            r#"
            INSERT INTO merge_requests (
                id, instance_id, iid, project_id, title, description,
                author_username, source_branch, target_branch, state, web_url,
                created_at, updated_at, merged_at, labels, reviewers, cached_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                state = excluded.state,
                updated_at = excluded.updated_at,
                merged_at = excluded.merged_at,
                labels = excluded.labels,
                reviewers = excluded.reviewers,
                cached_at = excluded.cached_at
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
        .execute(&self.pool)
        .await?;

        Ok(())
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

    /// Upsert discussions (comments) into the database.
    async fn upsert_discussions(
        &self,
        mr_id: i64,
        discussions: &[GitLabDiscussion],
    ) -> Result<(), AppError> {
        for discussion in discussions {
            for note in &discussion.notes {
                // Skip system notes
                if note.system {
                    continue;
                }

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

        Ok(())
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

        // Find cached MRs that are no longer open
        // We delete MRs that:
        // 1. Belong to this instance
        // 2. Are NOT in the current open list from GitLab
        // (Either they were merged/closed, or they no longer match our scope filters)
        let result = if open_mr_ids.is_empty() {
            // If no open MRs, delete all MRs for this instance
            sqlx::query("DELETE FROM merge_requests WHERE instance_id = ?")
                .bind(instance_id)
                .execute(&self.pool)
                .await?
        } else {
            // Build placeholders for the IN clause
            let placeholders: Vec<String> = (0..open_mr_ids.len()).map(|_| "?".to_string()).collect();
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

    /// Get all GitLab instances from the database.
    async fn get_gitlab_instances(&self) -> Result<Vec<GitLabInstanceRow>, AppError> {
        let instances = sqlx::query_as::<_, GitLabInstanceRow>(
            "SELECT id, url, name FROM gitlab_instances ORDER BY id",
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

/// Database row for GitLab instance.
#[derive(Debug, Clone, sqlx::FromRow)]
struct GitLabInstanceRow {
    id: i64,
    url: String,
    #[allow(dead_code)]
    name: Option<String>,
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
        assert!(config.sync_authored);
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
    fn test_sync_status_initial() {
        let status = SyncStatus {
            is_syncing: false,
            last_sync_time: None,
            last_error: None,
            pending_actions: 0,
            failed_actions: 0,
            last_sync_mr_count: 0,
            cache_size_bytes: 0,
            cache_size_warning: false,
        };

        assert!(!status.is_syncing);
        assert!(status.last_sync_time.is_none());
    }
}
