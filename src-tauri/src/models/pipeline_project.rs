//! Pipeline project model for the pipelines dashboard.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A project tracked on the pipelines dashboard, joined with project metadata.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PipelineProject {
    /// GitLab project ID.
    pub project_id: i64,

    /// Local instance ID.
    pub instance_id: i64,

    /// Whether this project is pinned to the top.
    pub pinned: bool,

    /// ISO 8601 timestamp of last visit.
    pub last_visited_at: Option<String>,

    /// Custom sort order.
    pub sort_order: Option<i64>,

    /// Project name (from projects table).
    pub name: String,

    /// Full namespaced name (from projects table).
    pub name_with_namespace: String,

    /// Path with namespace (from projects table).
    pub path_with_namespace: String,

    /// Web URL for the project (from projects table).
    pub web_url: String,
}

/// List all pipeline projects for an instance, joined with project metadata.
/// Returns pinned projects first, then by last_visited_at descending.
pub async fn list_pipeline_projects(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
) -> Result<Vec<PipelineProject>, sqlx::Error> {
    sqlx::query_as::<_, PipelineProject>(
        r#"
        SELECT pp.project_id, pp.instance_id, pp.pinned, pp.last_visited_at, pp.sort_order,
               p.name, p.name_with_namespace, p.path_with_namespace, p.web_url
        FROM pipeline_projects pp
        JOIN projects p ON p.id = pp.project_id AND p.instance_id = pp.instance_id
        WHERE pp.instance_id = ?
        ORDER BY pp.pinned DESC, pp.last_visited_at DESC
        "#,
    )
    .bind(instance_id)
    .fetch_all(pool)
    .await
}

/// Upsert a pipeline project: insert or update last_visited_at on conflict.
pub async fn upsert_pipeline_project(
    pool: &sqlx::SqlitePool,
    project_id: i64,
    instance_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO pipeline_projects (project_id, instance_id, last_visited_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(project_id, instance_id) DO UPDATE SET
          last_visited_at = datetime('now')
        "#,
    )
    .bind(project_id)
    .bind(instance_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Toggle the pinned flag for a pipeline project.
pub async fn toggle_pin(
    pool: &sqlx::SqlitePool,
    project_id: i64,
    instance_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE pipeline_projects
        SET pinned = CASE WHEN pinned = 0 THEN 1 ELSE 0 END
        WHERE project_id = ? AND instance_id = ?
        "#,
    )
    .bind(project_id)
    .bind(instance_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Remove a pipeline project from the dashboard.
pub async fn remove_pipeline_project(
    pool: &sqlx::SqlitePool,
    project_id: i64,
    instance_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM pipeline_projects WHERE project_id = ? AND instance_id = ?")
        .bind(project_id)
        .bind(instance_id)
        .execute(pool)
        .await?;

    Ok(())
}
