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
            starred: false,
            custom_name: None,
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
        SELECT id, instance_id, name, name_with_namespace, path_with_namespace, web_url, created_at, updated_at, starred, custom_name
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
                    starred: false,
                    custom_name: None,
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
        async move { client.get_latest_pipeline(pid).await.ok().flatten() }
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
            sha: if p.sha.len() > 8 {
                p.sha[..8].to_string()
            } else {
                p.sha
            },
            web_url: p.web_url,
            created_at: p.created_at,
            updated_at: p.updated_at,
            duration: p.duration,
        })
        .collect();

    // Cache the fetched statuses for instant display on next page load
    for s in &statuses {
        let _ = crate::db::pipeline_cache::upsert_pipeline_status(
            pool.inner(),
            instance_id,
            s.project_id,
            s.id,
            &s.status,
            &s.ref_name,
            &s.sha,
            &s.web_url,
            &s.created_at,
            s.updated_at.as_deref(),
            s.duration,
        )
        .await;
    }

    Ok(statuses)
}

/// Load cached pipeline statuses from the local DB for instant display.
#[tauri::command]
pub async fn get_cached_pipeline_statuses(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let cached = crate::db::pipeline_cache::get_cached_pipeline_statuses(
        pool.inner(),
        instance_id,
        &project_ids,
    )
    .await?;

    Ok(cached
        .into_iter()
        .map(|c| PipelineStatus {
            id: c.pipeline_id,
            project_id: c.project_id,
            status: c.status,
            ref_name: c.ref_name,
            sha: c.sha,
            web_url: c.web_url,
            created_at: c.created_at,
            updated_at: c.updated_at,
            duration: c.duration,
        })
        .collect())
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

/// Fetch all jobs for a specific pipeline.
#[tauri::command]
pub async fn get_pipeline_jobs(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<PipelineJob>, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;

    let mut jobs: Vec<PipelineJob> = client
        .get_pipeline_jobs(project_id, pipeline_id)
        .await?
        .into_iter()
        .map(|j| PipelineJob {
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
        })
        .collect();

    // Also fetch bridge jobs (child pipeline triggers)
    if let Ok(bridges) = client.get_pipeline_bridges(project_id, pipeline_id).await {
        for b in bridges {
            jobs.push(PipelineJob {
                id: b.id,
                name: b.name,
                stage: b.stage,
                status: b.status,
                web_url: b.web_url,
                created_at: b.created_at,
                started_at: b.started_at,
                finished_at: b.finished_at,
                duration: b.duration,
                queued_duration: b.queued_duration,
                allow_failure: b.allow_failure,
                runner_description: b.runner.and_then(|r| r.description),
            });
        }
    }

    Ok(jobs)
}

/// Fetch recent pipelines for a project.
#[tauri::command]
pub async fn get_project_pipelines(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    limit: Option<u32>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;
    let pipelines = client
        .get_project_pipelines(project_id, limit.unwrap_or(20))
        .await?;

    let statuses: Vec<PipelineStatus> = pipelines
        .into_iter()
        .map(|p| PipelineStatus {
            id: p.id,
            project_id: p.project_id,
            status: p.status,
            ref_name: p.ref_name,
            sha: if p.sha.len() > 8 {
                p.sha[..8].to_string()
            } else {
                p.sha
            },
            web_url: p.web_url,
            created_at: p.created_at,
            updated_at: p.updated_at,
            duration: p.duration,
        })
        .collect();

    Ok(statuses)
}

/// Play (trigger) a manual job. Returns the updated job.
#[tauri::command]
pub async fn play_pipeline_job(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<PipelineJob, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;
    let j = client.play_job(project_id, job_id).await?;
    Ok(PipelineJob {
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
    })
}

/// Retry a failed or canceled job. Returns the new job.
#[tauri::command]
pub async fn retry_pipeline_job(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<PipelineJob, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;
    let j = client.retry_job(project_id, job_id).await?;
    Ok(PipelineJob {
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
    })
}

/// Cancel a running or pending job. Returns the updated job.
#[tauri::command]
pub async fn cancel_pipeline_job(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<PipelineJob, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;
    let j = client.cancel_job(project_id, job_id).await?;
    Ok(PipelineJob {
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
    })
}

/// Cancel a running or pending pipeline.
#[tauri::command]
pub async fn cancel_pipeline(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<PipelineStatus, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;
    let p = client.cancel_pipeline(project_id, pipeline_id).await?;
    Ok(PipelineStatus {
        id: p.id,
        project_id: p.project_id,
        status: p.status,
        ref_name: p.ref_name,
        sha: if p.sha.len() > 8 {
            p.sha[..8].to_string()
        } else {
            p.sha
        },
        web_url: p.web_url,
        created_at: p.created_at,
        updated_at: p.updated_at,
        duration: p.duration,
    })
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
