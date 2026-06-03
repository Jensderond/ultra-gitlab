//! Pipeline orchestration shared between the Tauri commands and the `ultra` CLI.
//!
//! Functions take `&DbPool` (not Tauri `State`) and return domain types
//! (`GitLabPipeline`, `PipelineProject`, `Project`). The Tauri command layer
//! maps these into camelCase DTOs; the CLI uses them directly.

use crate::core::create_client;
use crate::db::pipeline_cache;
use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::pipeline_project::{self, PipelineProject};
use crate::models::project::{self, Project};
use crate::services::gitlab_client::{GitLabJob, GitLabPipeline};
use futures::future::join_all;
use std::collections::HashSet;

/// List all tracked pipeline projects for an instance.
pub async fn list_projects(
    pool: &DbPool,
    instance_id: i64,
) -> Result<Vec<PipelineProject>, AppError> {
    Ok(pipeline_project::list_pipeline_projects(pool, instance_id).await?)
}

/// Search projects: local cache first; if fewer than 5 hits, also query the
/// GitLab API, cache new results, and dedup by id.
pub async fn search_projects(
    pool: &DbPool,
    instance_id: i64,
    query: &str,
) -> Result<Vec<Project>, AppError> {
    let like = format!("%{}%", query);
    let local: Vec<Project> = sqlx::query_as(
        "SELECT id, instance_id, name, name_with_namespace, path_with_namespace, web_url, created_at, updated_at, starred, custom_name
         FROM projects WHERE instance_id = ? AND name_with_namespace LIKE ? LIMIT 10",
    )
    .bind(instance_id)
    .bind(&like)
    .fetch_all(pool)
    .await?;

    let mut seen: HashSet<i64> = local.iter().map(|p| p.id).collect();
    let mut results = local;

    if results.len() < 5 {
        let client = create_client(pool, instance_id).await?;
        if let Ok(api) = client.search_projects(query, 10).await {
            for gp in api {
                let p = Project {
                    id: gp.id,
                    instance_id,
                    name: gp.name,
                    name_with_namespace: gp.name_with_namespace,
                    path_with_namespace: gp.path_with_namespace,
                    web_url: gp.web_url,
                    created_at: gp.created_at,
                    updated_at: gp.updated_at,
                    starred: false,
                    custom_name: None,
                };
                let _ = project::upsert_project(pool, &p).await;
                if seen.insert(p.id) {
                    results.push(p);
                }
            }
        }
    }
    Ok(results)
}

/// Add (or touch) a project on the pipelines dashboard. Fetches and caches
/// project metadata from the API if it isn't cached yet.
pub async fn add_project(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    if project::get_project(pool, instance_id, project_id).await?.is_none() {
        let client = create_client(pool, instance_id).await?;
        let gp = client.get_project(project_id).await?;
        let p = Project {
            id: gp.id,
            instance_id,
            name: gp.name,
            name_with_namespace: gp.name_with_namespace,
            path_with_namespace: gp.path_with_namespace,
            web_url: gp.web_url,
            created_at: gp.created_at,
            updated_at: gp.updated_at,
            starred: false,
            custom_name: None,
        };
        project::upsert_project(pool, &p).await?;
    }
    // note: callee takes (pool, project_id, instance_id)
    pipeline_project::upsert_pipeline_project(pool, project_id, instance_id).await?;
    Ok(())
}

/// Toggle a project's pinned flag.
pub async fn toggle_pin(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    // note: callee takes (pool, project_id, instance_id)
    pipeline_project::toggle_pin(pool, project_id, instance_id).await?;
    Ok(())
}

/// Remove a project from the dashboard.
pub async fn remove_project(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    // note: callee takes (pool, project_id, instance_id)
    pipeline_project::remove_pipeline_project(pool, project_id, instance_id).await?;
    Ok(())
}

/// Persist a new ordering for pinned projects.
pub async fn reorder_pinned(
    pool: &DbPool,
    instance_id: i64,
    project_ids: &[i64],
) -> Result<(), AppError> {
    pipeline_project::reorder_pinned(pool, instance_id, project_ids).await?;
    Ok(())
}

/// Load cached pipeline statuses (instant display before a live refresh).
pub async fn cached_statuses(
    pool: &DbPool,
    instance_id: i64,
    project_ids: &[i64],
) -> Result<Vec<GitLabPipeline>, AppError> {
    let cached =
        pipeline_cache::get_cached_pipeline_statuses(pool, instance_id, project_ids).await?;
    Ok(cached
        .into_iter()
        .map(|c| GitLabPipeline {
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

/// Fetch the latest pipeline for each project in parallel and cache results.
pub async fn latest_statuses(
    pool: &DbPool,
    instance_id: i64,
    project_ids: &[i64],
) -> Result<Vec<GitLabPipeline>, AppError> {
    let client = create_client(pool, instance_id).await?;
    let futures = project_ids.iter().map(|&pid| {
        let client = client.clone();
        async move { client.get_latest_pipeline(pid).await.ok().flatten() }
    });
    let statuses: Vec<GitLabPipeline> = join_all(futures).await.into_iter().flatten().collect();
    for s in &statuses {
        let _ = pipeline_cache::upsert_pipeline_status(
            pool,
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

/// Recent pipelines for a project (newest first), up to `limit`.
pub async fn project_pipelines(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    limit: u32,
) -> Result<Vec<GitLabPipeline>, AppError> {
    let client = create_client(pool, instance_id).await?;
    client.get_project_pipelines(project_id, limit).await
}

/// Jobs for a pipeline, including bridge (child-pipeline trigger) jobs.
pub async fn pipeline_jobs(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<GitLabJob>, AppError> {
    let client = create_client(pool, instance_id).await?;
    let mut jobs = client.get_pipeline_jobs(project_id, pipeline_id).await?;
    let bridges = client.get_pipeline_bridges(project_id, pipeline_id).await?;
    jobs.extend(bridges);
    Ok(jobs)
}

/// Play (trigger) a manual job.
pub async fn play_job(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<GitLabJob, AppError> {
    create_client(pool, instance_id).await?.play_job(project_id, job_id).await
}

/// Retry a failed or canceled job.
pub async fn retry_job(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<GitLabJob, AppError> {
    create_client(pool, instance_id).await?.retry_job(project_id, job_id).await
}

/// Cancel a running or pending job.
pub async fn cancel_job(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<GitLabJob, AppError> {
    create_client(pool, instance_id).await?.cancel_job(project_id, job_id).await
}

/// Cancel a running or pending pipeline.
pub async fn cancel_pipeline(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<GitLabPipeline, AppError> {
    create_client(pool, instance_id)
        .await?
        .cancel_pipeline(project_id, pipeline_id)
        .await
}

/// Pipelines attached to a merge request (resolves the local `mr_id` to API ids).
pub async fn mr_pipelines(pool: &DbPool, mr_id: i64) -> Result<Vec<GitLabPipeline>, AppError> {
    let (instance_id, project_id, mr_iid) =
        crate::core::mr_actions::mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.get_mr_pipelines(project_id, mr_iid).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::{tempdir, TempDir};

    /// Temp DB with one instance and one cached project (id=10). Returns the
    /// kept-alive TempDir, the pool, and the instance id.
    async fn seed(pool_project: bool) -> (TempDir, DbPool, i64) {
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (url, token, created_at, authenticated_username, is_default)
             VALUES ('u', 't', 0, 'me', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let inst: i64 = sqlx::query_scalar("SELECT id FROM gitlab_instances LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        if pool_project {
            sqlx::query(
                "INSERT INTO projects (id, instance_id, name, name_with_namespace, path_with_namespace, web_url)
                 VALUES (10, ?, 'proj', 'group/proj', 'group/proj', 'http://x/group/proj')",
            )
            .bind(inst)
            .execute(&pool)
            .await
            .unwrap();
        }
        (dir, pool, inst)
    }

    #[tokio::test]
    async fn add_lists_toggles_removes_project() {
        let (_dir, pool, inst) = seed(true).await;

        add_project(&pool, inst, 10).await.unwrap();
        let listed = list_projects(&pool, inst).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].project_id, 10);
        assert!(!listed[0].pinned);

        toggle_pin(&pool, inst, 10).await.unwrap();
        let listed = list_projects(&pool, inst).await.unwrap();
        assert!(listed[0].pinned);

        remove_project(&pool, inst, 10).await.unwrap();
        assert!(list_projects(&pool, inst).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn reorder_sets_sort_order() {
        let (_dir, pool, inst) = seed(true).await;
        sqlx::query(
            "INSERT INTO projects (id, instance_id, name, name_with_namespace, path_with_namespace, web_url)
             VALUES (11, ?, 'p2', 'group/p2', 'group/p2', 'http://x/group/p2')",
        )
        .bind(inst)
        .execute(&pool)
        .await
        .unwrap();
        add_project(&pool, inst, 10).await.unwrap();
        add_project(&pool, inst, 11).await.unwrap();
        toggle_pin(&pool, inst, 10).await.unwrap();
        toggle_pin(&pool, inst, 11).await.unwrap();

        reorder_pinned(&pool, inst, &[11, 10]).await.unwrap();
        let listed = list_projects(&pool, inst).await.unwrap();
        assert_eq!(listed[0].project_id, 11);
        assert_eq!(listed[1].project_id, 10);
    }

    #[tokio::test]
    async fn cached_statuses_roundtrip() {
        let (_dir, pool, inst) = seed(true).await;
        pipeline_cache::upsert_pipeline_status(
            &pool, inst, 10, 999, "success", "main", "abcdef0123456789",
            "http://x/p/999", "2026-06-03T00:00:00Z", None, Some(42),
        )
        .await
        .unwrap();

        let got = cached_statuses(&pool, inst, &[10]).await.unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, 999);
        assert_eq!(got[0].status, "success");
        assert_eq!(got[0].duration, Some(42));
    }

    #[tokio::test]
    async fn search_matches_local_by_namespace() {
        // seed(true) inserts project id=10 with name_with_namespace='group/proj'
        let (_dir, pool, inst) = seed(true).await;

        // "proj" matches locally; API fallback errors (fake token/URL) but is
        // swallowed by the `if let Ok(api) = ...` guard, so local results still
        // come back.
        let results = search_projects(&pool, inst, "proj").await.unwrap();
        assert!(
            results.iter().any(|p| p.id == 10),
            "expected project id=10 in results for 'proj', got {:?}",
            results.iter().map(|p| p.id).collect::<Vec<_>>()
        );

        // "zzznomatch" finds nothing locally; API fallback also errors/returns
        // nothing, so id=10 must not appear.
        let no_results = search_projects(&pool, inst, "zzznomatch").await.unwrap();
        assert!(
            !no_results.iter().any(|p| p.id == 10),
            "did not expect project id=10 in results for 'zzznomatch'"
        );
    }
}
