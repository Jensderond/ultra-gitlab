//! Backend operations shared between the Tauri commands and the `ultra` CLI.
//!
//! Functions here take `&DbPool` (not Tauri `State`) so they can run in any
//! process. The Tauri command handlers delegate to these; the CLI calls them
//! directly against the same SQLite database.

pub mod comments;
pub mod mr_actions;
pub mod mr_query;
pub mod pipelines;

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};

/// Build a GitLab API client for the given instance from its stored token.
pub async fn create_client(pool: &DbPool, instance_id: i64) -> Result<GitLabClient, AppError> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        r#"
        SELECT id, url, name, token, created_at, authenticated_username, session_cookie, is_default
        FROM gitlab_instances
        WHERE id = $1
        "#,
    )
    .bind(instance_id)
    .fetch_optional(pool)
    .await?;

    let instance = instance
        .ok_or_else(|| AppError::not_found_with_id("GitLabInstance", instance_id.to_string()))?;
    let token = instance
        .token
        .ok_or_else(|| AppError::authentication("No token configured for GitLab instance"))?;

    GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token,
        timeout_secs: 30,
    })
}

/// Return the default instance id, falling back to the lowest id if none is
/// explicitly marked default. `None` means no instances are configured.
pub async fn default_instance_id(pool: &DbPool) -> Result<Option<i64>, AppError> {
    let id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM gitlab_instances ORDER BY is_default DESC, id ASC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

/// Read cached `.gitattributes` `linguist-generated` glob patterns for a project.
///
/// Returns an empty vec when nothing is cached yet — the desktop sync engine
/// populates and refreshes the `gitattributes_cache` table, so this is a pure
/// read against the shared database and never touches the network. Callers
/// combine these with the user's collapse patterns to classify generated files.
pub async fn cached_gitattributes(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<String>, AppError> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT patterns FROM gitattributes_cache WHERE instance_id = ? AND project_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    match row {
        Some((patterns_json,)) => Ok(serde_json::from_str(&patterns_json).unwrap_or_default()),
        None => Ok(Vec::new()),
    }
}

/// Return the authenticated username stored for an instance, if any.
pub async fn authenticated_username(
    pool: &DbPool,
    instance_id: i64,
) -> Result<Option<String>, AppError> {
    let name: Option<String> =
        sqlx::query_scalar("SELECT authenticated_username FROM gitlab_instances WHERE id = ?")
            .bind(instance_id)
            .fetch_optional(pool)
            .await?
            .flatten();
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    /// Build a temp DB and insert one default instance. Returns (pool, id).
    pub async fn seed_instance(default: bool) -> (DbPool, i64) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("t.db");
        // Keep the tempdir alive for the test process lifetime.
        std::mem::forget(dir);
        let pool = db::initialize(&path).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (url, name, token, created_at, authenticated_username, is_default)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("https://gitlab.example.com")
        .bind("test")
        .bind("tok")
        .bind(0i64)
        .bind("me")
        .bind(default as i64)
        .execute(&pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar("SELECT id FROM gitlab_instances LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        (pool, id)
    }

    #[tokio::test]
    async fn default_instance_id_returns_seeded() {
        let (pool, id) = seed_instance(true).await;
        assert_eq!(default_instance_id(&pool).await.unwrap(), Some(id));
    }

    #[tokio::test]
    async fn default_instance_id_none_when_empty() {
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        assert_eq!(default_instance_id(&pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn authenticated_username_reads_value() {
        let (pool, id) = seed_instance(true).await;
        assert_eq!(
            authenticated_username(&pool, id).await.unwrap(),
            Some("me".to_string())
        );
    }

    #[tokio::test]
    async fn cached_gitattributes_empty_when_missing() {
        let (pool, id) = seed_instance(true).await;
        assert!(cached_gitattributes(&pool, id, 42).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn cached_gitattributes_parses_stored_patterns() {
        let (pool, id) = seed_instance(true).await;
        sqlx::query(
            "INSERT INTO gitattributes_cache (instance_id, project_id, patterns, fetched_at) VALUES (?, ?, ?, ?)",
        )
        .bind(id)
        .bind(42i64)
        .bind(r#"["*.lock","dist/**/*"]"#)
        .bind(0i64)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(
            cached_gitattributes(&pool, id, 42).await.unwrap(),
            vec!["*.lock".to_string(), "dist/**/*".to_string()]
        );
    }
}
