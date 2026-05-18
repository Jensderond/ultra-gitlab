//! Auto-merge claim DB helpers.
//!
//! Claims live in `auto_merge_claims` keyed by `mr_id`. The row is the
//! single source of truth for "this MR should be auto-merged when ready" —
//! the sync engine reads the table on every tick and processes each claim.

use crate::db::pool::DbPool;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct AutoMergeClaimRow {
    pub mr_id: i64,
    pub claimed_at: i64,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub attempts: i64,
}

/// Joined row with the bits of MR metadata the sync processor needs to make
/// GitLab calls without re-querying merge_requests for every claim.
#[derive(Debug, Clone, FromRow)]
pub struct AutoMergeClaimWithMr {
    pub mr_id: i64,
    pub claimed_at: i64,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub attempts: i64,
    pub instance_id: i64,
    pub project_id: i64,
    pub iid: i64,
    pub state: String,
    pub title: String,
}

/// Insert a claim for this MR. No-op if a claim already exists.
pub async fn upsert_claim(pool: &DbPool, mr_id: i64, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO auto_merge_claims (mr_id, claimed_at) VALUES (?, ?) \
         ON CONFLICT(mr_id) DO NOTHING",
    )
    .bind(mr_id)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a claim by MR id.
pub async fn delete_claim(pool: &DbPool, mr_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM auto_merge_claims WHERE mr_id = ?")
        .bind(mr_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Fetch a single claim by MR id.
pub async fn get_claim(
    pool: &DbPool,
    mr_id: i64,
) -> Result<Option<AutoMergeClaimRow>, sqlx::Error> {
    sqlx::query_as::<_, AutoMergeClaimRow>(
        "SELECT mr_id, claimed_at, last_status, last_error, last_attempt_at, attempts \
         FROM auto_merge_claims WHERE mr_id = ?",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await
}

/// List all active claims joined with the parent MR row.
pub async fn list_active_claims_with_mr(
    pool: &DbPool,
) -> Result<Vec<AutoMergeClaimWithMr>, sqlx::Error> {
    sqlx::query_as::<_, AutoMergeClaimWithMr>(
        "SELECT c.mr_id, c.claimed_at, c.last_status, c.last_error, c.last_attempt_at, c.attempts, \
                mr.instance_id, mr.project_id, mr.iid, mr.state, mr.title \
         FROM auto_merge_claims c \
         JOIN merge_requests mr ON mr.id = c.mr_id",
    )
    .fetch_all(pool)
    .await
}

/// Record an attempt result: bumps `attempts`, updates `last_attempt_at`,
/// `last_status`, and `last_error`.
pub async fn record_attempt(
    pool: &DbPool,
    mr_id: i64,
    now: i64,
    status: Option<&str>,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE auto_merge_claims \
         SET attempts = attempts + 1, last_attempt_at = ?, last_status = ?, last_error = ? \
         WHERE mr_id = ?",
    )
    .bind(now)
    .bind(status)
    .bind(error)
    .bind(mr_id)
    .execute(pool)
    .await?;
    Ok(())
}
