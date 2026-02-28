//! Sync commands for managing background synchronization.
//!
//! These commands provide access to sync status and control.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use crate::services::sync_engine::{SyncConfig, SyncEngine, SyncHandle, SyncLogEntry};
use crate::services::sync_events::{
    ActionSyncedPayload, AuthExpiredPayload, SyncPhase, SyncProgressPayload, ACTION_SYNCED_EVENT,
    AUTH_EXPIRED_EVENT, SYNC_PROGRESS_EVENT,
};
use crate::services::sync_processor;
use crate::services::sync_queue;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Response for get_action_counts command.
#[derive(Debug, Serialize)]
pub struct ActionCountsResponse {
    pub pending: i64,
    pub failed: i64,
}

/// Response for get_sync_status command.
#[derive(Debug, Serialize)]
pub struct GetSyncStatusResponse {
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
    /// Recent sync log entries.
    pub recent_logs: Vec<SyncLogEntry>,
}

/// Response for retry_failed_actions command.
#[derive(Debug, Serialize)]
pub struct RetryActionsResponse {
    /// Number of actions that were retried.
    pub retried_count: i64,
    /// Number of actions that succeeded.
    pub success_count: i64,
    /// Number of actions that failed again.
    pub failed_count: i64,
}

/// Get the count of pending and failed sync actions.
///
/// # Returns
/// Count of pending and failed actions
#[tauri::command]
pub async fn get_action_counts(pool: State<'_, DbPool>) -> Result<ActionCountsResponse, AppError> {
    let (pending, failed) = sync_queue::get_action_counts(pool.inner()).await?;
    Ok(ActionCountsResponse { pending, failed })
}

/// Trigger an immediate sync operation.
///
/// Sends a trigger command to the background sync engine.
/// The sync runs asynchronously; poll get_sync_status for results.
#[tauri::command]
pub async fn trigger_sync(sync_handle: State<'_, SyncHandle>) -> Result<(), AppError> {
    sync_handle.trigger_sync().await
}

/// Get the current sync status.
///
/// Returns information about the last sync, pending actions,
/// and recent sync log entries.
///
/// # Returns
/// Current sync status
#[tauri::command]
pub async fn get_sync_status(
    app: AppHandle,
    pool: State<'_, DbPool>,
) -> Result<GetSyncStatusResponse, AppError> {
    // Get action counts
    let (pending, failed) = sync_queue::get_action_counts(pool.inner()).await?;

    // Get recent sync logs
    let engine = SyncEngine::new(pool.inner().clone(), app);
    let recent_logs = engine.get_sync_log(50).await?;

    // Find the last successful sync time from logs
    let last_sync_time = recent_logs
        .iter()
        .find(|log| log.operation == "sync_complete" && log.status == "success")
        .map(|log| log.timestamp);

    // Find the last error
    let last_error = recent_logs
        .iter()
        .find(|log| log.status == "error")
        .and_then(|log| log.message.clone());

    // Find the MR count from last sync
    let last_sync_mr_count = recent_logs
        .iter()
        .find(|log| log.operation == "sync_complete" && log.status == "success")
        .and_then(|log| {
            log.message.as_ref().and_then(|msg| {
                // Parse "Synced X MRs" from message
                msg.split_whitespace()
                    .nth(1)
                    .and_then(|s| s.parse::<i64>().ok())
            })
        })
        .unwrap_or(0);

    Ok(GetSyncStatusResponse {
        is_syncing: false, // Without managed state, we can't know if running
        last_sync_time,
        last_error,
        pending_actions: pending,
        failed_actions: failed,
        last_sync_mr_count,
        recent_logs,
    })
}

/// Retry all failed sync actions.
///
/// This resets failed actions to pending and immediately attempts
/// to sync them again. Each action is retried using the correct
/// GitLab instance credentials based on the MR it belongs to.
///
/// # Returns
/// Summary of retry results
#[tauri::command]
pub async fn retry_failed_actions(
    app: AppHandle,
    pool: State<'_, DbPool>,
) -> Result<RetryActionsResponse, AppError> {
    // Query failed actions joined with their instance credentials
    let action_instances = sqlx::query_as::<_, ActionWithInstance>(
        r#"
        SELECT sq.id AS action_id, sq.mr_id, sq.action_type, sq.payload, sq.local_reference_id,
               sq.status, sq.retry_count, sq.last_error, sq.created_at, sq.synced_at,
               gi.id AS instance_id, gi.url AS instance_url, gi.token AS instance_token
        FROM sync_queue sq
        JOIN merge_requests mr ON sq.mr_id = mr.id
        JOIN gitlab_instances gi ON mr.instance_id = gi.id
        WHERE sq.status = 'failed' AND sq.retry_count < ?
        ORDER BY sq.created_at ASC
        "#,
    )
    .bind(crate::models::sync_action::SyncAction::MAX_RETRIES)
    .fetch_all(pool.inner())
    .await?;

    // Also find orphaned actions whose instance was deleted
    let orphaned_actions = sqlx::query_as::<_, (i64,)>(
        r#"
        SELECT sq.id
        FROM sync_queue sq
        LEFT JOIN merge_requests mr ON sq.mr_id = mr.id
        LEFT JOIN gitlab_instances gi ON mr.instance_id = gi.id
        WHERE sq.status = 'failed' AND sq.retry_count < ?
          AND (mr.id IS NULL OR gi.id IS NULL)
        "#,
    )
    .bind(crate::models::sync_action::SyncAction::MAX_RETRIES)
    .fetch_all(pool.inner())
    .await?;

    // Mark orphaned actions as permanently failed
    for (action_id,) in &orphaned_actions {
        let _ = sync_queue::mark_discarded(
            pool.inner(),
            *action_id,
            "Instance was deleted - cannot retry",
        )
        .await;
    }

    if action_instances.is_empty() {
        return Ok(RetryActionsResponse {
            retried_count: 0,
            success_count: 0,
            failed_count: 0,
        });
    }

    // Emit progress event
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgressPayload {
            phase: SyncPhase::PushingActions,
            message: "Retrying failed actions...".to_string(),
            processed: None,
            total: Some(action_instances.len() as i64),
            is_error: false,
        },
    );

    // Group actions by instance_id
    let mut groups: std::collections::HashMap<i64, (String, Option<String>, Vec<crate::models::sync_action::SyncAction>)> =
        std::collections::HashMap::new();
    for ai in action_instances {
        let entry = groups
            .entry(ai.instance_id)
            .or_insert_with(|| (ai.instance_url.clone(), ai.instance_token.clone(), Vec::new()));
        entry.2.push(ai.into_sync_action());
    }

    let mut all_results: Vec<sync_processor::ProcessResult> = Vec::new();

    // Process each instance group with its own client
    for (instance_id, (url, token, actions)) in &groups {
        let Some(token) = token else {
            // Token is missing - emit auth expired and mark actions as failed
            let _ = app.emit(
                AUTH_EXPIRED_EVENT,
                AuthExpiredPayload {
                    instance_id: *instance_id,
                    instance_url: url.clone(),
                    message: "GitLab token missing. Please re-authenticate.".to_string(),
                },
            );
            for action in actions {
                let _ = sync_queue::mark_failed(
                    pool.inner(),
                    action.id,
                    &format!("Token missing for instance {}", instance_id),
                )
                .await;
            }
            continue;
        };

        let client = match GitLabClient::new(GitLabClientConfig {
            base_url: url.clone(),
            token: token.clone(),
            timeout_secs: 30,
        }) {
            Ok(c) => c,
            Err(e) => {
                // If we can't create the client, mark all actions in this group as failed
                for action in actions {
                    let _ = sync_queue::mark_failed(
                        pool.inner(),
                        action.id,
                        &format!("Failed to create client for instance {}: {}", instance_id, e),
                    )
                    .await;
                }
                continue;
            }
        };

        for action in actions {
            // Reset to pending first
            if let Err(e) = sync_queue::retry_action(pool.inner(), action.id).await {
                log::warn!("Failed to reset action {} for retry: {}", action.id, e);
                continue;
            }

            let result = sync_processor::process_action(&client, pool.inner(), action).await;

            // Check for auth expiry
            if let Some(ref error) = result.error {
                if error.contains("401") || error.contains("Unauthorized") {
                    let _ = app.emit(
                        AUTH_EXPIRED_EVENT,
                        AuthExpiredPayload {
                            instance_id: *instance_id,
                            instance_url: url.clone(),
                            message: "Your GitLab token has expired or been revoked. Please re-authenticate.".to_string(),
                        },
                    );
                }
            }

            // Emit action-synced event
            let _ = app.emit(
                ACTION_SYNCED_EVENT,
                ActionSyncedPayload {
                    action_id: result.action.id,
                    action_type: result.action.action_type.clone(),
                    success: result.success,
                    error: result.error.clone(),
                    mr_id: result.action.mr_id,
                    local_reference_id: result.action.local_reference_id,
                },
            );

            all_results.push(result);
        }
    }

    let retried_count = all_results.len() as i64;
    let success_count = all_results.iter().filter(|r| r.success).count() as i64;
    let failed_count = retried_count - success_count;

    Ok(RetryActionsResponse {
        retried_count,
        success_count,
        failed_count,
    })
}

/// Helper struct for querying failed actions with their instance info.
#[derive(Debug, sqlx::FromRow)]
struct ActionWithInstance {
    action_id: i64,
    mr_id: i64,
    action_type: String,
    payload: String,
    local_reference_id: Option<i64>,
    status: String,
    retry_count: i64,
    last_error: Option<String>,
    created_at: i64,
    synced_at: Option<i64>,
    instance_id: i64,
    instance_url: String,
    instance_token: Option<String>,
}

impl ActionWithInstance {
    fn into_sync_action(self) -> crate::models::sync_action::SyncAction {
        crate::models::sync_action::SyncAction {
            id: self.action_id,
            mr_id: self.mr_id,
            action_type: self.action_type,
            payload: self.payload,
            local_reference_id: self.local_reference_id,
            status: self.status,
            retry_count: self.retry_count,
            last_error: self.last_error,
            created_at: self.created_at,
            synced_at: self.synced_at,
        }
    }
}

/// Discard a failed sync action.
///
/// This permanently removes the action from the queue without
/// attempting to sync it.
///
/// # Arguments
/// * `action_id` - The ID of the action to discard
#[tauri::command]
pub async fn discard_failed_action(
    pool: State<'_, DbPool>,
    action_id: i64,
) -> Result<(), AppError> {
    sync_queue::delete_action(pool.inner(), action_id).await
}

/// Get the current sync configuration.
#[tauri::command]
pub async fn get_sync_config(sync_handle: State<'_, SyncHandle>) -> Result<SyncConfig, AppError> {
    Ok(sync_handle.get_config().await)
}

/// Update the sync configuration.
#[tauri::command]
pub async fn update_sync_config(
    sync_handle: State<'_, SyncHandle>,
    config: SyncConfig,
) -> Result<(), AppError> {
    sync_handle.update_config(config).await
}
