//! CRUD helpers for the `mr_approval_checkpoints` table.
//!
//! A checkpoint records the wall-clock timestamp of the user's most recent
//! in-app approval of an MR. The timestamp is compared against
//! `file_versions.updated_at` to derive the "changed since approval" file set.

use crate::db::pool::DbPool;
use crate::error::AppError;

/// Upsert a checkpoint for `mr_id` with `approved_at = now()`.
pub async fn set_checkpoint(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO mr_approval_checkpoints (mr_id, approved_at)
        VALUES (?, strftime('%s', 'now'))
        ON CONFLICT(mr_id) DO UPDATE SET approved_at = excluded.approved_at
        "#,
    )
    .bind(mr_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Returns the `approved_at` timestamp for `mr_id`, if any.
pub async fn get_checkpoint(pool: &DbPool, mr_id: i64) -> Result<Option<i64>, AppError> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT approved_at FROM mr_approval_checkpoints WHERE mr_id = ?")
            .bind(mr_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(ts,)| ts))
}

/// Returns the set of head-version file paths whose `updated_at` is strictly
/// greater than `since_ts` for the given MR.
pub async fn files_changed_since(
    pool: &DbPool,
    mr_id: i64,
    since_ts: i64,
) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        SELECT file_path FROM file_versions
        WHERE mr_id = ? AND version_type = 'head' AND updated_at > ?
        ORDER BY file_path
        "#,
    )
    .bind(mr_id)
    .bind(since_ts)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn setup_pool() -> crate::db::pool::DbPool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = crate::db::initialize(&db_path).await.unwrap();
        std::mem::forget(dir);
        pool
    }

    #[tokio::test]
    async fn set_and_get_checkpoint_roundtrip() {
        let pool = setup_pool().await;
        assert!(get_checkpoint(&pool, 42).await.unwrap().is_none());

        set_checkpoint(&pool, 42).await.unwrap();

        let ts = get_checkpoint(&pool, 42).await.unwrap().expect("checkpoint");
        assert!(ts > 0);
    }

    #[tokio::test]
    async fn set_checkpoint_overwrites_previous_row() {
        let pool = setup_pool().await;
        set_checkpoint(&pool, 7).await.unwrap();
        let ts1 = get_checkpoint(&pool, 7).await.unwrap().unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        set_checkpoint(&pool, 7).await.unwrap();
        let ts2 = get_checkpoint(&pool, 7).await.unwrap().unwrap();

        assert!(ts2 > ts1, "second call should overwrite with newer timestamp");

        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM mr_approval_checkpoints WHERE mr_id = 7")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "should be a single row per mr_id");
    }

    #[tokio::test]
    async fn files_changed_since_returns_only_head_rows_newer_than_ts() {
        let pool = setup_pool().await;

        crate::db::file_cache::upsert_file_blob(&pool, "shaA", "a", 1).await.unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "old.txt", "head", "shaA", "i", 0)
            .await
            .unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "old.txt", "base", "shaA", "i", 0)
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        crate::db::file_cache::upsert_file_blob(&pool, "shaB", "b", 1).await.unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "new.txt", "head", "shaB", "i", 0)
            .await
            .unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "new.txt", "base", "shaB", "i", 0)
            .await
            .unwrap();

        let changed = files_changed_since(&pool, 1, cutoff).await.unwrap();
        assert_eq!(changed, vec!["new.txt".to_string()]);
    }
}
