//! MR snooze commands.
//!
//! Snoozing hides an MR from the review list until a chosen timestamp. The
//! frontend computes the target time (preset menu) and filters snoozed MRs
//! client-side using the `snoozedUntil` field on the list DTO.

use crate::db::pool::DbPool;
use crate::db::snooze;
use crate::error::AppError;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Frontend-shaped snooze payload.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MrSnooze {
    pub mr_id: i64,
    pub snoozed_at: i64,
    pub snooze_until: i64,
}

impl From<snooze::SnoozeRow> for MrSnooze {
    fn from(row: snooze::SnoozeRow) -> Self {
        Self {
            mr_id: row.mr_id,
            snoozed_at: row.snoozed_at,
            snooze_until: row.snooze_until,
        }
    }
}

/// Snooze an MR until the given Unix timestamp (seconds). Re-snoozing
/// overwrites the previous expiry.
#[tauri::command]
pub async fn snooze_mr(
    pool: State<'_, DbPool>,
    mr_id: i64,
    until: i64,
) -> Result<MrSnooze, AppError> {
    let current = now();
    if until <= current {
        return Err(AppError::invalid_input("Snooze time must be in the future"));
    }
    snooze::upsert_snooze(pool.inner(), mr_id, until, current).await?;
    let row = snooze::get_snooze(pool.inner(), mr_id)
        .await?
        .ok_or_else(|| AppError::internal("Failed to read back snooze"))?;
    Ok(row.into())
}

/// Remove the snooze for an MR.
#[tauri::command]
pub async fn unsnooze_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<(), AppError> {
    snooze::delete_snooze(pool.inner(), mr_id).await?;
    Ok(())
}
