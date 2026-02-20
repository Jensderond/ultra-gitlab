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
/// to sync them again.
///
/// # Returns
/// Summary of retry results
#[tauri::command]
pub async fn retry_failed_actions(
    app: AppHandle,
    pool: State<'_, DbPool>,
) -> Result<RetryActionsResponse, AppError> {
    // Get the first GitLab instance to create a client
    // In a real app, we'd need to retry actions per-instance
    let instance = sqlx::query_as::<_, (i64, String, Option<String>)>(
        "SELECT id, url, token FROM gitlab_instances ORDER BY id LIMIT 1",
    )
    .fetch_optional(pool.inner())
    .await?;

    let Some((instance_id, url, token)) = instance else {
        return Ok(RetryActionsResponse {
            retried_count: 0,
            success_count: 0,
            failed_count: 0,
        });
    };

    let token = token.ok_or_else(|| {
        AppError::authentication_expired_for_instance(
            "GitLab token missing. Please re-authenticate.",
            instance_id,
            &url,
        )
    })?;

    let client = GitLabClient::new(GitLabClientConfig {
        base_url: url.clone(),
        token,
        timeout_secs: 30,
    })?;

    // Emit progress event
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgressPayload {
            phase: SyncPhase::PushingActions,
            message: "Retrying failed actions...".to_string(),
            processed: None,
            total: None,
            is_error: false,
        },
    );

    // Retry failed actions
    let results = match sync_processor::retry_failed_actions(&client, pool.inner()).await {
        Ok(results) => results,
        Err(e) => {
            // Check if this is an authentication expired error
            if e.is_authentication_expired() {
                // Emit auth-expired event
                let _ = app.emit(
                    AUTH_EXPIRED_EVENT,
                    AuthExpiredPayload {
                        instance_id: e.get_expired_instance_id().unwrap_or(0),
                        instance_url: e.get_expired_instance_url().unwrap_or(&url).to_string(),
                        message:
                            "Your GitLab token has expired or been revoked. Please re-authenticate."
                                .to_string(),
                    },
                );
            }
            return Err(e);
        }
    };

    let retried_count = results.len() as i64;
    let success_count = results.iter().filter(|r| r.success).count() as i64;
    let failed_count = retried_count - success_count;

    // Emit action-synced events for each result
    for result in &results {
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
    }

    Ok(RetryActionsResponse {
        retried_count,
        success_count,
        failed_count,
    })
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
