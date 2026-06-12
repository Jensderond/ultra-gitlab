//! Auto-run claim commands.
//!
//! Users arm a manual pipeline job from the UI; the background sync engine
//! plays it once the rest of the pipeline succeeds. These commands just
//! read/write the `auto_run_claims` table.

use crate::db::auto_run;
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
pub struct AutoRunClaim {
    pub instance_id: i64,
    pub project_id: i64,
    pub pipeline_id: i64,
    pub job_id: i64,
    pub job_name: String,
    pub ref_name: Option<String>,
    pub claimed_at: i64,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub attempts: i64,
}

impl From<auto_run::AutoRunClaimRow> for AutoRunClaim {
    fn from(row: auto_run::AutoRunClaimRow) -> Self {
        Self {
            instance_id: row.instance_id,
            project_id: row.project_id,
            pipeline_id: row.pipeline_id,
            job_id: row.job_id,
            job_name: row.job_name,
            ref_name: row.ref_name,
            claimed_at: row.claimed_at,
            last_status: row.last_status,
            last_error: row.last_error,
            last_attempt_at: row.last_attempt_at,
            attempts: row.attempts,
        }
    }
}

/// Arm a manual job for auto-run. Idempotent. Kicks the processor so a
/// pipeline that is already ready is played within seconds.
#[tauri::command]
pub async fn claim_auto_run(
    pool: State<'_, DbPool>,
    sync_handle: State<'_, SyncHandle>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
    job_id: i64,
    job_name: String,
    ref_name: Option<String>,
) -> Result<(), AppError> {
    auto_run::upsert_claim(
        pool.inner(),
        instance_id,
        project_id,
        pipeline_id,
        job_id,
        &job_name,
        ref_name.as_deref(),
        now(),
    )
    .await?;
    // Best-effort: schedule an immediate processor run.
    let _ = sync_handle.process_auto_run_now().await;
    Ok(())
}

/// Disarm a job.
#[tauri::command]
pub async fn unclaim_auto_run(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<(), AppError> {
    auto_run::delete_claim(pool.inner(), instance_id, project_id, job_id).await?;
    Ok(())
}

/// List the auto-run claims for one pipeline (UI state for the job list).
#[tauri::command]
pub async fn list_auto_run_claims(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<AutoRunClaim>, AppError> {
    let rows =
        auto_run::list_claims_for_pipeline(pool.inner(), instance_id, project_id, pipeline_id)
            .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}
