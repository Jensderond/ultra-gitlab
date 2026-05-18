//! Auto-merge claim commands.
//!
//! Users mark their own MR for auto-merge from the UI. The actual merging
//! happens in the background sync engine (`services::auto_merge_processor`).
//! These commands just read/write the `auto_merge_claims` table.

use crate::db::auto_merge;
use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::services::sync_engine::SyncHandle;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Frontend-shaped claim payload.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoMergeClaim {
    pub mr_id: i64,
    pub claimed_at: i64,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub attempts: i64,
}

impl From<auto_merge::AutoMergeClaimRow> for AutoMergeClaim {
    fn from(row: auto_merge::AutoMergeClaimRow) -> Self {
        Self {
            mr_id: row.mr_id,
            claimed_at: row.claimed_at,
            last_status: row.last_status,
            last_error: row.last_error,
            last_attempt_at: row.last_attempt_at,
            attempts: row.attempts,
        }
    }
}

/// Claim an MR for auto-merge. Idempotent.
///
/// Also kicks the sync engine so the new claim is processed within a few
/// seconds instead of waiting for the next periodic tick.
#[tauri::command]
pub async fn claim_auto_merge(
    pool: State<'_, DbPool>,
    sync_handle: State<'_, SyncHandle>,
    mr_id: i64,
) -> Result<AutoMergeClaim, AppError> {
    auto_merge::upsert_claim(pool.inner(), mr_id, now()).await?;
    let claim = auto_merge::get_claim(pool.inner(), mr_id)
        .await?
        .ok_or_else(|| AppError::internal("Failed to read back auto-merge claim"))?;
    // Best-effort: schedule an immediate processor run.
    let _ = sync_handle.process_auto_merge_now().await;
    Ok(claim.into())
}

/// Force the sync engine to process all auto-merge claims right now.
#[tauri::command]
pub async fn process_auto_merge_now(
    sync_handle: State<'_, SyncHandle>,
) -> Result<(), AppError> {
    sync_handle.process_auto_merge_now().await
}

/// Remove the auto-merge claim for an MR.
#[tauri::command]
pub async fn unclaim_auto_merge(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<(), AppError> {
    auto_merge::delete_claim(pool.inner(), mr_id).await?;
    Ok(())
}

/// Get the current auto-merge claim for an MR, if any.
#[tauri::command]
pub async fn get_auto_merge_claim(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<Option<AutoMergeClaim>, AppError> {
    let row = auto_merge::get_claim(pool.inner(), mr_id).await?;
    Ok(row.map(Into::into))
}
