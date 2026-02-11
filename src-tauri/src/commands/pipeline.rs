//! Pipeline dashboard commands for managing tracked projects and their pipeline statuses.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::pipeline_project::{self, PipelineProject};
use crate::models::project::{self, Project};
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use futures::future::join_all;
use serde::Serialize;
use std::collections::HashSet;
use tauri::State;

/// Search result item returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchResult {
    pub id: i64,
    pub name: String,
    pub name_with_namespace: String,
    pub path_with_namespace: String,
    pub web_url: String,
}

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

/// Search projects: local cache first, then GitLab API if local results < 5.
/// Returns deduplicated, combined results.
#[tauri::command]
pub async fn search_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
    query: String,
) -> Result<Vec<ProjectSearchResult>, AppError> {
    // 1. Query local projects cache
    let like_pattern = format!("%{}%", query);
    let local_projects: Vec<Project> = sqlx::query_as(
        r#"
        SELECT id, instance_id, name, name_with_namespace, path_with_namespace, web_url, created_at, updated_at
        FROM projects
        WHERE instance_id = ? AND name_with_namespace LIKE ?
        LIMIT 10
        "#,
    )
    .bind(instance_id)
    .bind(&like_pattern)
    .fetch_all(pool.inner())
    .await?;

    let mut results: Vec<ProjectSearchResult> = local_projects
        .iter()
        .map(|p| ProjectSearchResult {
            id: p.id,
            name: p.name.clone(),
            name_with_namespace: p.name_with_namespace.clone(),
            path_with_namespace: p.path_with_namespace.clone(),
            web_url: p.web_url.clone(),
        })
        .collect();

    let mut seen_ids: HashSet<i64> = local_projects.iter().map(|p| p.id).collect();

    // 2. If local results < 5, also query GitLab API
    if local_projects.len() < 5 {
        let client = create_gitlab_client(&pool, instance_id).await?;
        if let Ok(api_projects) = client.search_projects(&query, 10).await {
            // Cache API results
            for gp in &api_projects {
                let project = Project {
                    id: gp.id,
                    instance_id,
                    name: gp.name.clone(),
                    name_with_namespace: gp.name_with_namespace.clone(),
                    path_with_namespace: gp.path_with_namespace.clone(),
                    web_url: gp.web_url.clone(),
                    created_at: gp.created_at.clone(),
                    updated_at: gp.updated_at.clone(),
                };
                let _ = project::upsert_project(pool.inner(), &project).await;
            }

            // Add API-only results (deduplicated)
            for gp in api_projects {
                if seen_ids.insert(gp.id) {
                    results.push(ProjectSearchResult {
                        id: gp.id,
                        name: gp.name,
                        name_with_namespace: gp.name_with_namespace,
                        path_with_namespace: gp.path_with_namespace,
                        web_url: gp.web_url,
                    });
                }
            }
        }
    }

    Ok(results)
}

/// Pipeline status DTO returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStatus {
    pub id: i64,
    pub project_id: i64,
    pub status: String,
    pub ref_name: String,
    pub sha: String,
    pub web_url: String,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub duration: Option<i64>,
}

/// Fetch latest pipeline status for multiple projects in parallel.
#[tauri::command]
pub async fn get_pipeline_statuses(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;

    let futures = project_ids.iter().map(|&pid| {
        let client = client.clone();
        async move {
            client.get_latest_pipeline(pid).await.ok().flatten()
        }
    });

    let results = join_all(futures).await;

    let statuses: Vec<PipelineStatus> = results
        .into_iter()
        .flatten()
        .map(|p| PipelineStatus {
            id: p.id,
            project_id: p.project_id,
            status: p.status,
            ref_name: p.ref_name,
            sha: if p.sha.len() > 8 { p.sha[..8].to_string() } else { p.sha },
            web_url: p.web_url,
            created_at: p.created_at,
            updated_at: p.updated_at,
            duration: p.duration,
        })
        .collect();

    Ok(statuses)
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
