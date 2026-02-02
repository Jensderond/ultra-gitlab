//! Sync commands for managing background synchronization.
//!
//! These commands provide access to sync status and control.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use crate::services::sync_engine::{SyncConfig, SyncEngine, SyncLogEntry};
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

/// Response for trigger_sync command.
#[derive(Debug, Serialize)]
pub struct TriggerSyncResponse {
    /// Number of MRs synced.
    pub mr_count: i64,
    /// Number of MRs purged.
    pub purged_count: i64,
    /// Number of actions pushed to GitLab.
    pub actions_pushed: i64,
    /// Duration in milliseconds.
    pub duration_ms: i64,
    /// Any errors encountered.
    pub errors: Vec<String>,
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
/// This fetches new/updated MRs from all configured GitLab instances,
/// updates diffs and comments, pushes pending local actions, and
/// purges merged/closed MRs.
///
/// # Returns
/// Summary of the sync operation
#[tauri::command]
pub async fn trigger_sync(
    app: AppHandle,
    pool: State<'_, DbPool>,
) -> Result<TriggerSyncResponse, AppError> {
    // Emit sync starting event
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgressPayload {
            phase: SyncPhase::Starting,
            message: "Starting sync...".to_string(),
            processed: None,
            total: None,
            is_error: false,
        },
    );

    // Create a sync engine for this operation
    let engine = SyncEngine::new(pool.inner().clone());

    // Run the sync
    let result = match engine.run_sync().await {
        Ok(result) => {
            // Emit sync complete event
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgressPayload {
                    phase: SyncPhase::Complete,
                    message: format!(
                        "Synced {} MRs, purged {}, pushed {} actions",
                        result.mr_count, result.purged_count, result.actions_pushed
                    ),
                    processed: Some(result.mr_count),
                    total: Some(result.mr_count),
                    is_error: false,
                },
            );
            result
        }
        Err(e) => {
            // Check if this is an authentication expired error
            if e.is_authentication_expired() {
                // Emit auth-expired event so frontend can prompt re-auth
                let _ = app.emit(
                    AUTH_EXPIRED_EVENT,
                    AuthExpiredPayload {
                        instance_id: e.get_expired_instance_id().unwrap_or(0),
                        instance_url: e
                            .get_expired_instance_url()
                            .unwrap_or("Unknown")
                            .to_string(),
                        message: "Your GitLab token has expired or been revoked. Please re-authenticate.".to_string(),
                    },
                );
            }

            // Emit sync failed event
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgressPayload {
                    phase: SyncPhase::Failed,
                    message: e.to_string(),
                    processed: None,
                    total: None,
                    is_error: true,
                },
            );
            return Err(e);
        }
    };

    Ok(TriggerSyncResponse {
        mr_count: result.mr_count,
        purged_count: result.purged_count,
        actions_pushed: result.actions_pushed,
        duration_ms: result.duration_ms,
        errors: result.errors,
    })
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
    pool: State<'_, DbPool>,
) -> Result<GetSyncStatusResponse, AppError> {
    // Get action counts
    let (pending, failed) = sync_queue::get_action_counts(pool.inner()).await?;

    // Get recent sync logs
    let engine = SyncEngine::new(pool.inner().clone());
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

    // Clone URL for potential use in error handling
    let url_for_error = url.clone();

    // Get token from DB
    let token = token.ok_or_else(|| {
        AppError::authentication_expired_for_instance(
            "GitLab token missing. Please re-authenticate.",
            instance_id,
            &url,
        )
    })?;

    // Create GitLab client
    let client = GitLabClient::new(GitLabClientConfig {
        base_url: url,
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
                        instance_url: e.get_expired_instance_url().unwrap_or(&url_for_error).to_string(),
                        message: "Your GitLab token has expired or been revoked. Please re-authenticate.".to_string(),
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
///
/// # Returns
/// Current sync settings
#[tauri::command]
pub async fn get_sync_config() -> Result<SyncConfig, AppError> {
    // For now, return default config
    // In a real app, this would be loaded from persistent storage
    Ok(SyncConfig::default())
}

/// Update the sync configuration.
///
/// # Arguments
/// * `config` - New sync settings
#[tauri::command]
pub async fn update_sync_config(config: SyncConfig) -> Result<(), AppError> {
    // For now, this is a no-op as we don't have a managed sync engine
    // In a real app, this would update the managed sync engine
    // and persist the config to storage
    let _ = config;
    Ok(())
}
