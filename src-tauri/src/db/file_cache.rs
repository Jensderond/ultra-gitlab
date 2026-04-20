use crate::db::pool::DbPool;
use crate::error::AppError;

/// Insert a file blob if it doesn't already exist (deduplication by SHA).
pub async fn upsert_file_blob(
    pool: &DbPool,
    sha: &str,
    content: &str,
    size_bytes: i64,
) -> Result<(), AppError> {
    sqlx::query("INSERT OR IGNORE INTO file_blobs (sha, content, size_bytes) VALUES (?, ?, ?)")
        .bind(sha)
        .bind(content)
        .bind(size_bytes)
        .execute(pool)
        .await?;

    Ok(())
}

/// Insert or replace a file version record for an MR file.
pub async fn upsert_file_version(
    pool: &DbPool,
    mr_id: i64,
    file_path: &str,
    version_type: &str,
    sha: &str,
    instance_id: &str,
    project_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT OR REPLACE INTO file_versions
          (mr_id, file_path, version_type, sha, instance_id, project_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        "#,
    )
    .bind(mr_id)
    .bind(file_path)
    .bind(version_type)
    .bind(sha)
    .bind(instance_id)
    .bind(project_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Get cached file content for a specific MR file and version type.
pub async fn get_cached_file_content(
    pool: &DbPool,
    mr_id: i64,
    file_path: &str,
    version_type: &str,
) -> Result<Option<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        r#"
        SELECT fb.content
        FROM file_versions fv
        JOIN file_blobs fb ON fb.sha = fv.sha
        WHERE fv.mr_id = ? AND fv.file_path = ? AND fv.version_type = ?
        "#,
    )
    .bind(mr_id)
    .bind(file_path)
    .bind(version_type)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(content,)| content))
}

/// Get both base and head cached file content for an MR file in one call.
pub async fn get_cached_file_pair(
    pool: &DbPool,
    mr_id: i64,
    file_path: &str,
) -> Result<(Option<String>, Option<String>), AppError> {
    let base = get_cached_file_content(pool, mr_id, file_path, "base").await?;
    let head = get_cached_file_content(pool, mr_id, file_path, "head").await?;
    Ok((base, head))
}

/// Check if a cached file version exists for a given MR, file path, and version type.
pub async fn has_cached_version(
    pool: &DbPool,
    mr_id: i64,
    file_path: &str,
    version_type: &str,
) -> Result<bool, AppError> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM file_versions WHERE mr_id = ? AND file_path = ? AND version_type = ?",
    )
    .bind(mr_id)
    .bind(file_path)
    .bind(version_type)
    .fetch_optional(pool)
    .await?;

    Ok(row.is_some())
}

/// Get the previously cached diff SHAs (base_sha, head_sha) for an MR.
pub async fn get_cached_diff_shas(
    pool: &DbPool,
    mr_id: i64,
) -> Result<Option<(String, String)>, AppError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT base_sha, head_sha FROM diffs WHERE mr_id = ?")
            .bind(mr_id)
            .fetch_optional(pool)
            .await?;

    Ok(row)
}

/// Delete all file version records for a given MR.
pub async fn delete_file_versions_for_mr(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM file_versions WHERE mr_id = ?")
        .bind(mr_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Delete file blobs that are no longer referenced by any file version.
pub async fn delete_orphaned_blobs(pool: &DbPool) -> Result<(), AppError> {
    sqlx::query("DELETE FROM file_blobs WHERE sha NOT IN (SELECT sha FROM file_versions)")
        .execute(pool)
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn setup_pool() -> crate::db::pool::DbPool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = crate::db::initialize(&db_path).await.unwrap();
        std::mem::forget(dir); // keep dir alive for pool lifetime
        pool
    }

    #[tokio::test]
    async fn upsert_file_version_sets_updated_at_to_now() {
        let pool = setup_pool().await;

        upsert_file_blob(&pool, "sha1", "hello", 5).await.unwrap();
        upsert_file_version(&pool, 1, "foo.txt", "head", "sha1", "inst", 42)
            .await
            .unwrap();

        let (ts,): (i64,) = sqlx::query_as(
            "SELECT updated_at FROM file_versions WHERE mr_id = 1 AND file_path = 'foo.txt' AND version_type = 'head'"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(ts > 0, "updated_at should be set (got {})", ts);
        assert!(ts <= now && ts >= now - 5, "updated_at should be ~now (got {}, now {})", ts, now);
    }

    #[tokio::test]
    async fn upsert_file_version_bumps_updated_at_on_replace() {
        let pool = setup_pool().await;

        upsert_file_blob(&pool, "sha1", "hello", 5).await.unwrap();
        upsert_file_version(&pool, 1, "foo.txt", "head", "sha1", "inst", 42)
            .await
            .unwrap();

        let (ts1,): (i64,) = sqlx::query_as(
            "SELECT updated_at FROM file_versions WHERE mr_id = 1 AND file_path = 'foo.txt' AND version_type = 'head'"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        upsert_file_blob(&pool, "sha2", "world", 5).await.unwrap();
        upsert_file_version(&pool, 1, "foo.txt", "head", "sha2", "inst", 42)
            .await
            .unwrap();

        let (ts2,): (i64,) = sqlx::query_as(
            "SELECT updated_at FROM file_versions WHERE mr_id = 1 AND file_path = 'foo.txt' AND version_type = 'head'"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(ts2 > ts1, "updated_at should be bumped on replace (ts1={}, ts2={})", ts1, ts2);
    }
}
