//! Pipeline dashboard commands for managing tracked projects and their pipeline statuses.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::pipeline_project::PipelineProject;
use crate::models::project::{self, Project};
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig, GitLabJob, GitLabPipeline};
use serde::Serialize;
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

/// Pipeline job DTO returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineJob {
    pub id: i64,
    pub name: String,
    pub stage: String,
    pub status: String,
    pub web_url: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration: Option<f64>,
    pub queued_duration: Option<f64>,
    pub allow_failure: bool,
    pub runner_description: Option<String>,
}

fn to_status_dto(p: GitLabPipeline) -> PipelineStatus {
    PipelineStatus {
        id: p.id,
        project_id: p.project_id,
        status: p.status,
        ref_name: p.ref_name,
        sha: if p.sha.len() > 8 { p.sha[..8].to_string() } else { p.sha },
        web_url: p.web_url,
        created_at: p.created_at,
        updated_at: p.updated_at,
        duration: p.duration,
    }
}

fn to_job_dto(j: GitLabJob) -> PipelineJob {
    PipelineJob {
        id: j.id,
        name: j.name,
        stage: j.stage,
        status: j.status,
        web_url: j.web_url,
        created_at: j.created_at,
        started_at: j.started_at,
        finished_at: j.finished_at,
        duration: j.duration,
        queued_duration: j.queued_duration,
        allow_failure: j.allow_failure,
        runner_description: j.runner.and_then(|r| r.description),
    }
}

/// List all pipeline projects for an instance with project metadata.
#[tauri::command]
pub async fn list_pipeline_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Vec<PipelineProject>, AppError> {
    crate::core::pipelines::list_projects(pool.inner(), instance_id).await
}

/// Visit (add/touch) a pipeline project on the dashboard.
/// Upserts project metadata into the projects table if not cached, then upserts into pipeline_projects.
#[tauri::command]
pub async fn visit_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    crate::core::pipelines::add_project(pool.inner(), instance_id, project_id).await
}

/// Toggle the pinned state of a pipeline project.
#[tauri::command]
pub async fn toggle_pin_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    crate::core::pipelines::toggle_pin(pool.inner(), instance_id, project_id).await
}

/// Persist a new ordering for pinned pipeline projects.
#[tauri::command]
pub async fn reorder_pinned_pipeline_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<(), AppError> {
    crate::core::pipelines::reorder_pinned(pool.inner(), instance_id, &project_ids).await
}

/// Remove a pipeline project from the dashboard.
#[tauri::command]
pub async fn remove_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    crate::core::pipelines::remove_project(pool.inner(), instance_id, project_id).await
}

/// Search projects: local cache first, then GitLab API if local results < 5.
/// Returns deduplicated, combined results.
#[tauri::command]
pub async fn search_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
    query: String,
) -> Result<Vec<ProjectSearchResult>, AppError> {
    let projects = crate::core::pipelines::search_projects(pool.inner(), instance_id, &query).await?;
    Ok(projects
        .into_iter()
        .map(|p| ProjectSearchResult {
            id: p.id,
            name: p.name,
            name_with_namespace: p.name_with_namespace,
            path_with_namespace: p.path_with_namespace,
            web_url: p.web_url,
        })
        .collect())
}

/// Fetch latest pipeline status for multiple projects in parallel.
#[tauri::command]
pub async fn get_pipeline_statuses(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let statuses = crate::core::pipelines::latest_statuses(pool.inner(), instance_id, &project_ids).await?;
    Ok(statuses.into_iter().map(to_status_dto).collect())
}

/// Load cached pipeline statuses from the local DB for instant display.
#[tauri::command]
pub async fn get_cached_pipeline_statuses(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let statuses = crate::core::pipelines::cached_statuses(pool.inner(), instance_id, &project_ids).await?;
    Ok(statuses.into_iter().map(to_status_dto).collect())
}

/// Fetch all jobs for a specific pipeline.
#[tauri::command]
pub async fn get_pipeline_jobs(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<PipelineJob>, AppError> {
    let jobs = crate::core::pipelines::pipeline_jobs(pool.inner(), instance_id, project_id, pipeline_id).await?;
    Ok(jobs.into_iter().map(to_job_dto).collect())
}

/// Fetch recent pipelines for a project.
#[tauri::command]
pub async fn get_project_pipelines(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    limit: Option<u32>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let pipelines = crate::core::pipelines::project_pipelines(pool.inner(), instance_id, project_id, limit.unwrap_or(20)).await?;
    Ok(pipelines.into_iter().map(to_status_dto).collect())
}

/// Play (trigger) a manual job. Returns the updated job.
#[tauri::command]
pub async fn play_pipeline_job(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<PipelineJob, AppError> {
    let j = crate::core::pipelines::play_job(pool.inner(), instance_id, project_id, job_id).await?;
    Ok(to_job_dto(j))
}

/// Retry a failed or canceled job. Returns the new job.
#[tauri::command]
pub async fn retry_pipeline_job(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<PipelineJob, AppError> {
    let j = crate::core::pipelines::retry_job(pool.inner(), instance_id, project_id, job_id).await?;
    Ok(to_job_dto(j))
}

/// Cancel a running or pending job. Returns the updated job.
#[tauri::command]
pub async fn cancel_pipeline_job(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<PipelineJob, AppError> {
    let j = crate::core::pipelines::cancel_job(pool.inner(), instance_id, project_id, job_id).await?;
    Ok(to_job_dto(j))
}

/// Cancel a running or pending pipeline.
#[tauri::command]
pub async fn cancel_pipeline(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<PipelineStatus, AppError> {
    let p = crate::core::pipelines::cancel_pipeline(pool.inner(), instance_id, project_id, pipeline_id).await?;
    Ok(to_status_dto(p))
}

/// Fetch the raw log trace for a specific job.
#[tauri::command]
pub async fn get_job_trace(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<String, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;
    client.get_job_trace(project_id, job_id).await
}

/// Resolve a project by its path (e.g. "group/subgroup/project") and return its numeric ID and name.
/// Used by deep links to resolve pipeline URLs to in-app routes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProject {
    pub id: i64,
    pub name_with_namespace: String,
}

#[tauri::command]
pub async fn resolve_project_by_path(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_path: String,
) -> Result<ResolvedProject, AppError> {
    // Check local cache first
    let cached: Option<Project> = sqlx::query_as(
        r#"
        SELECT id, instance_id, name, name_with_namespace, path_with_namespace, web_url, created_at, updated_at, starred, custom_name
        FROM projects
        WHERE instance_id = ? AND path_with_namespace = ?
        "#,
    )
    .bind(instance_id)
    .bind(&project_path)
    .fetch_optional(pool.inner())
    .await?;

    if let Some(p) = cached {
        return Ok(ResolvedProject {
            id: p.id,
            name_with_namespace: p.name_with_namespace,
        });
    }

    // Fetch from GitLab API
    let client = create_gitlab_client(&pool, instance_id).await?;
    let gitlab_project = client.get_project_by_path(&project_path).await?;

    // Cache it
    let project = Project {
        id: gitlab_project.id,
        instance_id,
        name: gitlab_project.name.clone(),
        name_with_namespace: gitlab_project.name_with_namespace.clone(),
        path_with_namespace: gitlab_project.path_with_namespace,
        web_url: gitlab_project.web_url,
        created_at: gitlab_project.created_at,
        updated_at: gitlab_project.updated_at,
        starred: false,
        custom_name: None,
    };
    let _ = project::upsert_project(pool.inner(), &project).await;

    Ok(ResolvedProject {
        id: gitlab_project.id,
        name_with_namespace: gitlab_project.name_with_namespace,
    })
}

/// Helper to create a GitLab API client from an instance ID.
async fn create_gitlab_client(
    pool: &State<'_, DbPool>,
    instance_id: i64,
) -> Result<GitLabClient, AppError> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        r#"
        SELECT id, url, name, token, created_at, authenticated_username, session_cookie, is_default
        FROM gitlab_instances
        WHERE id = $1
        "#,
    )
    .bind(instance_id)
    .fetch_optional(pool.inner())
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
