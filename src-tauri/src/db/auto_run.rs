//! Auto-run claim DB helpers.
//!
//! Claims live in `auto_run_claims` keyed by (instance_id, project_id,
//! job_id). A row means "play this manual job once its pipeline has finished
//! successfully" — the sync engine reads the table on every tick (plus a
//! fast 30s ticker while any claim exists) and processes each claim.

use crate::db::pool::DbPool;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct AutoRunClaimRow {
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

const ALL_COLUMNS: &str = "instance_id, project_id, pipeline_id, job_id, job_name, ref_name, \
                           claimed_at, last_status, last_error, last_attempt_at, attempts";

/// Arm a job. No-op if a claim already exists for this job.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_claim(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
    job_id: i64,
    job_name: &str,
    ref_name: Option<&str>,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO auto_run_claims \
         (instance_id, project_id, pipeline_id, job_id, job_name, ref_name, claimed_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(instance_id, project_id, job_id) DO NOTHING",
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(pipeline_id)
    .bind(job_id)
    .bind(job_name)
    .bind(ref_name)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Disarm a job.
pub async fn delete_claim(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM auto_run_claims WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// All active claims, for the sync processor.
pub async fn list_active_claims(pool: &DbPool) -> Result<Vec<AutoRunClaimRow>, sqlx::Error> {
    let sql = format!("SELECT {ALL_COLUMNS} FROM auto_run_claims");
    sqlx::query_as::<_, AutoRunClaimRow>(&sql)
        .fetch_all(pool)
        .await
}

/// Claims for one pipeline, for the UI.
pub async fn list_claims_for_pipeline(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<AutoRunClaimRow>, sqlx::Error> {
    let sql = format!(
        "SELECT {ALL_COLUMNS} FROM auto_run_claims \
         WHERE instance_id = ? AND project_id = ? AND pipeline_id = ?"
    );
    sqlx::query_as::<_, AutoRunClaimRow>(&sql)
        .bind(instance_id)
        .bind(project_id)
        .bind(pipeline_id)
        .fetch_all(pool)
        .await
}

/// Cheap existence check for the fast ticker.
pub async fn has_active_claims(pool: &DbPool) -> Result<bool, sqlx::Error> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM auto_run_claims")
        .fetch_one(pool)
        .await?;
    Ok(count.0 > 0)
}

/// Record a successful status check: stores the observed pipeline status,
/// clears any previous error, and resets the consecutive-error counter.
pub async fn record_status(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
    now: i64,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE auto_run_claims \
         SET last_status = ?, last_error = NULL, last_attempt_at = ?, attempts = 0 \
         WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(status)
    .bind(now)
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record a failed attempt (API error). Increments the consecutive-error
/// counter and returns its new value so the caller can give up after a cap.
pub async fn record_error(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
    now: i64,
    error: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query(
        "UPDATE auto_run_claims \
         SET last_error = ?, last_attempt_at = ?, attempts = attempts + 1 \
         WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(error)
    .bind(now)
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .execute(pool)
    .await?;
    let attempts: (i64,) = sqlx::query_as(
        "SELECT attempts FROM auto_run_claims \
         WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .fetch_one(pool)
    .await?;
    Ok(attempts.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    async fn test_pool() -> (tempfile::TempDir, DbPool) {
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        (dir, pool)
    }

    #[tokio::test]
    async fn upsert_list_delete_roundtrip() {
        let (_dir, pool) = test_pool().await;

        upsert_claim(&pool, 1, 10, 3001, 7004, "Deploy production", Some("v1.2.3"), 100)
            .await
            .unwrap();
        // Second upsert for the same job is a no-op.
        upsert_claim(&pool, 1, 10, 3001, 7004, "Deploy production", Some("v1.2.3"), 200)
            .await
            .unwrap();

        let all = list_active_claims(&pool).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].job_id, 7004);
        assert_eq!(all[0].job_name, "Deploy production");
        assert_eq!(all[0].ref_name.as_deref(), Some("v1.2.3"));
        assert_eq!(all[0].claimed_at, 100, "second upsert must not overwrite");
        assert_eq!(all[0].attempts, 0);

        let for_pipeline = list_claims_for_pipeline(&pool, 1, 10, 3001).await.unwrap();
        assert_eq!(for_pipeline.len(), 1);
        let other_pipeline = list_claims_for_pipeline(&pool, 1, 10, 9999).await.unwrap();
        assert!(other_pipeline.is_empty());

        assert!(has_active_claims(&pool).await.unwrap());
        delete_claim(&pool, 1, 10, 7004).await.unwrap();
        assert!(!has_active_claims(&pool).await.unwrap());
        assert!(list_active_claims(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn record_error_increments_and_record_status_resets() {
        let (_dir, pool) = test_pool().await;
        upsert_claim(&pool, 1, 10, 3001, 7004, "Deploy production", None, 100)
            .await
            .unwrap();

        assert_eq!(record_error(&pool, 1, 10, 7004, 110, "boom").await.unwrap(), 1);
        assert_eq!(record_error(&pool, 1, 10, 7004, 120, "boom").await.unwrap(), 2);

        let claim = &list_active_claims(&pool).await.unwrap()[0];
        assert_eq!(claim.attempts, 2);
        assert_eq!(claim.last_error.as_deref(), Some("boom"));

        record_status(&pool, 1, 10, 7004, 130, "running").await.unwrap();
        let claim = &list_active_claims(&pool).await.unwrap()[0];
        assert_eq!(claim.attempts, 0);
        assert_eq!(claim.last_status.as_deref(), Some("running"));
        assert!(claim.last_error.is_none());
        assert_eq!(claim.last_attempt_at, Some(130));
    }
}
