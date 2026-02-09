//! Gitattributes cache commands.
//!
//! These commands handle fetching and caching `.gitattributes` patterns
//! for identifying linguist-generated files in merge requests.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::GitLabInstance;
use crate::services::gitattributes::parse_gitattributes;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use tauri::State;

/// Get cached gitattributes patterns for a project.
///
/// Returns the cached patterns from the local database. If no cache exists,
/// returns an empty Vec (not an error).
///
/// # Arguments
/// * `instance_id` - The GitLab instance ID
/// * `project_id` - The GitLab project ID
///
/// # Returns
/// A Vec of glob pattern strings, or empty Vec if no cache exists.
#[tauri::command]
pub async fn get_gitattributes(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT patterns FROM gitattributes_cache WHERE instance_id = ? AND project_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .fetch_optional(pool.inner())
    .await?;

    match row {
        Some((patterns_json,)) => {
            let patterns: Vec<String> = serde_json::from_str(&patterns_json)?;
            Ok(patterns)
        }
        None => Ok(Vec::new()),
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
///
/// # Arguments
/// * `instance_id` - The GitLab instance ID
/// * `project_id` - The GitLab project ID
///
/// # Returns
/// The parsed patterns (may be empty).
#[tauri::command]
pub async fn refresh_gitattributes(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<String>, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;

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
    .execute(pool.inner())
    .await?;

    Ok(patterns)
}

/// Helper to create a GitLab client from an instance ID.
async fn create_gitlab_client(
    pool: &State<'_, DbPool>,
    instance_id: i64,
) -> Result<GitLabClient, AppError> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        "SELECT id, url, name, token, created_at FROM gitlab_instances WHERE id = $1",
    )
    .bind(instance_id)
    .fetch_optional(pool.inner())
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
