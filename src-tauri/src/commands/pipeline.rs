//! Pipeline dashboard commands for managing tracked projects and their pipeline statuses.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::pipeline_project::{self, PipelineProject};
use crate::models::project::{self, Project};
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use tauri::State;

/// List all pipeline projects for an instance with project metadata.
#[tauri::command]
pub async fn list_pipeline_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Vec<PipelineProject>, AppError> {
    let projects = pipeline_project::list_pipeline_projects(pool.inner(), instance_id).await?;
    Ok(projects)
}

/// Visit (add/touch) a pipeline project on the dashboard.
/// Upserts project metadata into the projects table if not cached, then upserts into pipeline_projects.
#[tauri::command]
pub async fn visit_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    // Check if project metadata is cached
    let existing = project::get_project(pool.inner(), instance_id, project_id).await?;

    if existing.is_none() {
        // Fetch from GitLab API and cache
        let client = create_gitlab_client(&pool, instance_id).await?;
        let gitlab_project = client.get_project(project_id).await?;

        let project = Project {
            id: gitlab_project.id,
            instance_id,
            name: gitlab_project.name,
            name_with_namespace: gitlab_project.name_with_namespace,
            path_with_namespace: gitlab_project.path_with_namespace,
            web_url: gitlab_project.web_url,
            created_at: gitlab_project.created_at,
            updated_at: gitlab_project.updated_at,
        };
        project::upsert_project(pool.inner(), &project).await?;
    }

    // Upsert into pipeline_projects with current timestamp
    pipeline_project::upsert_pipeline_project(pool.inner(), project_id, instance_id).await?;

    Ok(())
}

/// Toggle the pinned state of a pipeline project.
#[tauri::command]
pub async fn toggle_pin_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    pipeline_project::toggle_pin(pool.inner(), project_id, instance_id).await?;
    Ok(())
}

/// Remove a pipeline project from the dashboard.
#[tauri::command]
pub async fn remove_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    pipeline_project::remove_pipeline_project(pool.inner(), project_id, instance_id).await?;
    Ok(())
}

/// Helper to create a GitLab API client from an instance ID.
async fn create_gitlab_client(
    pool: &State<'_, DbPool>,
    instance_id: i64,
) -> Result<GitLabClient, AppError> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        r#"
        SELECT id, url, name, token, created_at, authenticated_username
        FROM gitlab_instances
        WHERE id = $1
        "#,
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
