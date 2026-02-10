//! Gitattributes cache commands.
//!
//! These commands handle fetching and caching `.gitattributes` patterns
//! for identifying linguist-generated files in merge requests.
//!
//! Uses stale-while-revalidate: cached data is returned immediately, and
//! a background refresh is spawned when the cache is older than 24 hours.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::GitLabInstance;
use crate::services::gitattributes::parse_gitattributes;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use tauri::State;

/// Cache entries older than this are considered stale and trigger a background refresh.
const STALE_THRESHOLD_SECS: i64 = 24 * 60 * 60; // 24 hours

/// Get cached gitattributes patterns for a project.
///
/// Uses stale-while-revalidate strategy:
/// - If cached data exists and is fresh (< 24h old), returns it immediately.
/// - If cached data exists but is stale (>= 24h old), returns it immediately
///   AND spawns a background task to refresh the cache.
/// - If no cache exists at all, fetches synchronously so the caller gets data
///   on the first call.
#[tauri::command]
pub async fn get_gitattributes(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<String>, AppError> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT patterns, fetched_at FROM gitattributes_cache WHERE instance_id = ? AND project_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .fetch_optional(pool.inner())
    .await?;

    match row {
        Some((patterns_json, fetched_at)) => {
            let patterns: Vec<String> = serde_json::from_str(&patterns_json)?;

            // Check if cache is stale
            let now = chrono::Utc::now().timestamp();
            if now - fetched_at >= STALE_THRESHOLD_SECS {
                // Spawn background refresh — don't block the response
                let bg_pool = pool.inner().clone();
                tokio::spawn(async move {
                    if let Err(e) = refresh_gitattributes_inner(&bg_pool, instance_id, project_id).await {
                        eprintln!("[gitattributes] Background refresh failed for instance={} project={}: {}", instance_id, project_id, e);
                    }
                });
            }

            Ok(patterns)
        }
        None => {
            // No cache at all — fetch synchronously so the frontend gets data
            refresh_gitattributes_inner(pool.inner(), instance_id, project_id).await
        }
    }
}

/// Fetch .gitattributes from GitLab and update the local cache.
///
/// Fetches the `.gitattributes` file from the project's default branch via
/// the GitLab Repository Files API, parses it for `linguist-generated` patterns,
/// and upserts the result into the `gitattributes_cache` table.
///
/// Handles 404 gracefully — if the project has no `.gitattributes`, the cache
/// is updated with an empty patterns array.
#[tauri::command]
pub async fn refresh_gitattributes(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<String>, AppError> {
    refresh_gitattributes_inner(pool.inner(), instance_id, project_id).await
}

/// Refresh the gitattributes cache for a project if it's stale or missing.
///
/// Called by the sync engine during the regular MR sync cycle.
/// Returns Ok(true) if a refresh was performed, Ok(false) if the cache was fresh.
pub async fn refresh_gitattributes_if_stale(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<bool, AppError> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT fetched_at FROM gitattributes_cache WHERE instance_id = ? AND project_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await?;

    let needs_refresh = match row {
        Some((fetched_at,)) => {
            let now = chrono::Utc::now().timestamp();
            now - fetched_at >= STALE_THRESHOLD_SECS
        }
        None => true, // No cache at all
    };

    if needs_refresh {
        refresh_gitattributes_inner(pool, instance_id, project_id).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Inner implementation of refresh_gitattributes that takes a `&DbPool` directly.
///
/// This is separated from the Tauri command so it can be called from both
/// the command handler, background tasks, and the sync engine.
pub async fn refresh_gitattributes_inner(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<String>, AppError> {
    let client = create_gitlab_client_from_pool(pool, instance_id).await?;

    // Fetch .gitattributes from the default branch (HEAD)
    let content = client
        .get_file_content(project_id, ".gitattributes", "HEAD")
        .await?;

    // Parse the content — empty string (404) gives empty patterns
    let patterns = parse_gitattributes(&content);

    // Upsert into cache
    let now = chrono::Utc::now().timestamp();
    let patterns_json = serde_json::to_string(&patterns)?;

    sqlx::query(
        r#"
        INSERT INTO gitattributes_cache (instance_id, project_id, patterns, fetched_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(instance_id, project_id) DO UPDATE SET patterns = excluded.patterns, fetched_at = excluded.fetched_at
        "#,
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(&patterns_json)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(patterns)
}

/// Helper to create a GitLab client from a pool and instance ID.
async fn create_gitlab_client_from_pool(
    pool: &DbPool,
    instance_id: i64,
) -> Result<GitLabClient, AppError> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        "SELECT id, url, name, token, created_at, authenticated_username FROM gitlab_instances WHERE id = $1",
    )
    .bind(instance_id)
    .fetch_optional(pool)
    .await?;

    let instance = instance.ok_or_else(|| {
        AppError::not_found_with_id("GitLabInstance", instance_id.to_string())
    })?;

    let token = instance.token.ok_or_else(|| {
        AppError::authentication("No token configured for GitLab instance")
    })?;

    GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token,
        timeout_secs: 30,
    })
}
