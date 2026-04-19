//! Pipeline status cache DB helpers.

use crate::db::pool::DbPool;

/// A row from the `pipeline_status_cache` table.
#[derive(Debug, Clone)]
pub struct CachedPipelineStatus {
    pub pipeline_id: i64,
    pub project_id: i64,
    pub status: String,
    pub ref_name: String,
    pub sha: String,
    pub web_url: String,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub duration: Option<i64>,
}

/// Upsert a single pipeline status into the cache.
pub async fn upsert_pipeline_status(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
    status: &str,
    ref_name: &str,
    sha: &str,
    web_url: &str,
    created_at: &str,
    updated_at: Option<&str>,
    duration: Option<i64>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR REPLACE INTO pipeline_status_cache \
         (project_id, instance_id, pipeline_id, status, ref_name, sha, web_url, created_at, updated_at, duration, cached_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    )
    .bind(project_id)
    .bind(instance_id)
    .bind(pipeline_id)
    .bind(status)
    .bind(ref_name)
    .bind(sha)
    .bind(web_url)
    .bind(created_at)
    .bind(updated_at)
    .bind(duration)
    .execute(pool)
    .await?;
    Ok(())
}

/// Load cached pipeline statuses for the given projects on an instance.
pub async fn get_cached_pipeline_statuses(
    pool: &DbPool,
    instance_id: i64,
    project_ids: &[i64],
) -> Result<Vec<CachedPipelineStatus>, sqlx::Error> {
    if project_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Build placeholders for the IN clause
    let placeholders: Vec<String> = project_ids.iter().map(|_| "?".to_string()).collect();
    let sql = format!(
        "SELECT pipeline_id, project_id, status, ref_name, sha, web_url, created_at, updated_at, duration \
         FROM pipeline_status_cache \
         WHERE instance_id = ? AND project_id IN ({})",
        placeholders.join(", ")
    );

    let mut query = sqlx::query_as::<_, (i64, i64, String, String, String, String, String, Option<String>, Option<i64>)>(&sql)
        .bind(instance_id);

    for &pid in project_ids {
        query = query.bind(pid);
    }

    let rows = query.fetch_all(pool).await?;

    Ok(rows
        .into_iter()
        .map(|(pipeline_id, project_id, status, ref_name, sha, web_url, created_at, updated_at, duration)| {
            CachedPipelineStatus {
                pipeline_id,
                project_id,
                status,
                ref_name,
                sha,
                web_url,
                created_at,
                updated_at,
                duration,
            }
        })
        .collect())
}
