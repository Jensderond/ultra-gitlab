//! MR snooze DB helpers.
//!
//! Snoozes live in `mr_snoozes` keyed by `mr_id`. A row hides the MR from the
//! review list until `snooze_until` passes; expiry is enforced at read time by
//! consumers comparing `snooze_until` against the current time.

use crate::db::pool::DbPool;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct SnoozeRow {
    pub mr_id: i64,
    pub snoozed_at: i64,
    pub snooze_until: i64,
}

/// Insert or replace the snooze for this MR. Re-snoozing overwrites the expiry.
pub async fn upsert_snooze(
    pool: &DbPool,
    mr_id: i64,
    snooze_until: i64,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO mr_snoozes (mr_id, snoozed_at, snooze_until) VALUES (?, ?, ?) \
         ON CONFLICT(mr_id) DO UPDATE SET snoozed_at = excluded.snoozed_at, \
         snooze_until = excluded.snooze_until",
    )
    .bind(mr_id)
    .bind(now)
    .bind(snooze_until)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete the snooze for an MR.
pub async fn delete_snooze(pool: &DbPool, mr_id: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM mr_snoozes WHERE mr_id = ?")
        .bind(mr_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Fetch the snooze for an MR, if any.
pub async fn get_snooze(pool: &DbPool, mr_id: i64) -> Result<Option<SnoozeRow>, sqlx::Error> {
    sqlx::query_as::<_, SnoozeRow>(
        "SELECT mr_id, snoozed_at, snooze_until FROM mr_snoozes WHERE mr_id = ?",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await
}

/// Remove snoozes whose expiry has passed. Housekeeping; safe to call often.
pub async fn delete_expired(pool: &DbPool, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM mr_snoozes WHERE snooze_until <= ?")
        .bind(now)
        .execute(pool)
        .await?;
    Ok(())
}
