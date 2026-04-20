//! Tauri commands for MR approval checkpoint tracking.
//!
//! When the user approves an MR in-app, a checkpoint timestamp is stored.
//! The frontend uses the checkpoint to list files that changed since approval.

use crate::db::mr_approval;
use crate::db::pool::DbPool;
use crate::error::AppError;
use tauri::State;

/// Record an approval checkpoint for `mr_id` at `now()`.
#[tauri::command]
pub async fn set_approval_checkpoint(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<(), AppError> {
    mr_approval::set_checkpoint(pool.inner(), mr_id).await
}

/// Get the approval checkpoint timestamp for `mr_id`, or `None`.
#[tauri::command]
pub async fn get_approval_checkpoint(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<Option<i64>, AppError> {
    mr_approval::get_checkpoint(pool.inner(), mr_id).await
}

/// List head-version file paths changed since `since_ts`.
#[tauri::command]
pub async fn get_files_changed_since(
    pool: State<'_, DbPool>,
    mr_id: i64,
    since_ts: i64,
) -> Result<Vec<String>, AppError> {
    mr_approval::files_changed_since(pool.inner(), mr_id, since_ts).await
}
