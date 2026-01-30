//! Sync commands for managing background synchronization.
//!
//! These commands provide access to sync status and control.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::services::sync_queue;
use serde::Serialize;
use tauri::State;

/// Response for get_action_counts command.
#[derive(Debug, Serialize)]
pub struct ActionCountsResponse {
    pub pending: i64,
    pub failed: i64,
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
