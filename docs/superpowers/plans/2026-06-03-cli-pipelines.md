# CLI Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring GitLab pipelines to the `ultra` CLI — a Pipelines tab (pinned projects → pipelines → jobs with play/retry/cancel) and a pipelines panel on the MR detail screen — built on a shared `core::pipelines` primitive.

**Architecture:** Extract pipeline orchestration from the Tauri commands into a new `core::pipelines` module that takes `&DbPool` and returns domain types; rewrite the desktop commands as thin DTO-mappers over it (no desktop behavior change). The CLI's `data.rs` calls `core::pipelines` directly and adapts results into TUI row types, rendered by a new `ui/pipelines.rs` and driven by new state/keys in `pipelines.rs`.

**Tech Stack:** Rust, Tauri 2, ratatui 0.29, crossterm, tokio, sqlx (SQLite), futures.

**Conventions for every task:**
- Run lib tests/check from repo root: `cargo test --manifest-path src-tauri/Cargo.toml <filter>` and `cargo check --manifest-path src-tauri/Cargo.toml`.
- Run CLI check from repo root: `cargo check --manifest-path src-tauri/cli/Cargo.toml`.
- A pre-commit hook runs ESLint on the JS side; it does not block Rust commits.
- `DbPool` is an alias for `sqlx::SqlitePool`; model helpers typed `&sqlx::SqlitePool` accept `&DbPool`. `AppError` implements `From<sqlx::Error>`, so `?` converts automatically.

---

## Phase 1 — `core::pipelines` primitive + command delegation

### Task 1: Create `core::pipelines` with DB-backed functions (TDD)

**Files:**
- Create: `src-tauri/src/core/pipelines.rs`
- Modify: `src-tauri/src/core/mod.rs` (add `pub mod pipelines;`)
- Test: inline `#[cfg(test)]` module in `src-tauri/src/core/pipelines.rs`

- [ ] **Step 1: Register the module**

In `src-tauri/src/core/mod.rs`, the module list currently reads:

```rust
pub mod mr_actions;
pub mod mr_query;
```

Change it to:

```rust
pub mod mr_actions;
pub mod mr_query;
pub mod pipelines;
```

- [ ] **Step 2: Create the module with the DB-backed functions**

Create `src-tauri/src/core/pipelines.rs`:

```rust
//! Pipeline orchestration shared between the Tauri commands and the `ultra` CLI.
//!
//! Functions take `&DbPool` (not Tauri `State`) and return domain types
//! (`GitLabPipeline`, `GitLabJob`, `PipelineProject`, `Project`). The Tauri
//! command layer maps these into camelCase DTOs; the CLI uses them directly.

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
    pipeline_project::upsert_pipeline_project(pool, project_id, instance_id).await?;
    Ok(())
}

/// Toggle a project's pinned flag.
pub async fn toggle_pin(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    pipeline_project::toggle_pin(pool, project_id, instance_id).await?;
    Ok(())
}

/// Remove a project from the dashboard.
pub async fn remove_project(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
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
```

- [ ] **Step 3: Write failing tests for the DB-backed functions**

Append to `src-tauri/src/core/pipelines.rs`:

```rust
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

        // add (metadata already cached → no network)
        add_project(&pool, inst, 10).await.unwrap();
        let listed = list_projects(&pool, inst).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].project_id, 10);
        assert!(!listed[0].pinned);

        // pin
        toggle_pin(&pool, inst, 10).await.unwrap();
        let listed = list_projects(&pool, inst).await.unwrap();
        assert!(listed[0].pinned);

        // remove
        remove_project(&pool, inst, 10).await.unwrap();
        assert!(list_projects(&pool, inst).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn reorder_sets_sort_order() {
        let (_dir, pool, inst) = seed(true).await;
        // second project
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
        // sort_order 0 → project 11 first
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
}
```

- [ ] **Step 4: Run tests to verify they fail (compile error / missing fns)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml core::pipelines`
Expected: build error or test failure until Step 2 code is in place. (If Step 2 was already saved, the four tests should compile; run them to confirm they PASS — the DB-backed functions are complete. If they fail, fix before continuing.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml core::pipelines`
Expected: PASS (4 tests: `add_lists_toggles_removes_project`, `reorder_sets_sort_order`, `cached_statuses_roundtrip`, plus any others).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/core/mod.rs src-tauri/src/core/pipelines.rs
git commit -m "feat(core): add core::pipelines with DB-backed project functions"
```

---

### Task 2: Add the network functions to `core::pipelines`

**Files:**
- Modify: `src-tauri/src/core/pipelines.rs`

These wrap the GitLab client and are verified by `cargo check` + later manual testing (no unit tests — they require a live server).

- [ ] **Step 1: Add the network functions**

Insert these functions into `src-tauri/src/core/pipelines.rs` immediately before the `#[cfg(test)]` module:

```rust
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean (warnings about unused functions are OK — they're consumed in Task 3 and the CLI phases).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/core/pipelines.rs
git commit -m "feat(core): add pipeline/job network functions to core::pipelines"
```

---

### Task 3: Delegate the desktop commands to `core::pipelines`

**Files:**
- Modify: `src-tauri/src/commands/pipeline.rs`

Keep all DTO structs, command names, and signatures identical (the React app is untouched). Rewrite the bodies of the pipeline/project/job commands to call `core::pipelines` and map to DTOs. Leave `resolve_project_by_path`, `get_job_trace`, and the `create_gitlab_client` helper exactly as they are.

- [ ] **Step 1: Add two DTO-mapping helpers**

In `src-tauri/src/commands/pipeline.rs`, add these helpers near the top (after the `use` block). They centralize the SHA-truncation and runner mapping that previously lived inline in each command:

```rust
use crate::services::gitlab_client::{GitLabJob, GitLabPipeline};

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
```

(If `GitLabJob`/`GitLabPipeline` are already imported elsewhere in the file, don't duplicate the `use`.)

- [ ] **Step 2: Rewrite the command bodies to delegate**

Replace the bodies (keep each `#[tauri::command]` attribute and signature) as follows:

```rust
#[tauri::command]
pub async fn list_pipeline_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Vec<PipelineProject>, AppError> {
    crate::core::pipelines::list_projects(pool.inner(), instance_id).await
}

#[tauri::command]
pub async fn visit_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    crate::core::pipelines::add_project(pool.inner(), instance_id, project_id).await
}

#[tauri::command]
pub async fn toggle_pin_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    crate::core::pipelines::toggle_pin(pool.inner(), instance_id, project_id).await
}

#[tauri::command]
pub async fn reorder_pinned_pipeline_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<(), AppError> {
    crate::core::pipelines::reorder_pinned(pool.inner(), instance_id, &project_ids).await
}

#[tauri::command]
pub async fn remove_pipeline_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<(), AppError> {
    crate::core::pipelines::remove_project(pool.inner(), instance_id, project_id).await
}

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

#[tauri::command]
pub async fn get_pipeline_statuses(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let statuses =
        crate::core::pipelines::latest_statuses(pool.inner(), instance_id, &project_ids).await?;
    Ok(statuses.into_iter().map(to_status_dto).collect())
}

#[tauri::command]
pub async fn get_cached_pipeline_statuses(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let statuses =
        crate::core::pipelines::cached_statuses(pool.inner(), instance_id, &project_ids).await?;
    Ok(statuses.into_iter().map(to_status_dto).collect())
}

#[tauri::command]
pub async fn get_pipeline_jobs(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<PipelineJob>, AppError> {
    let jobs =
        crate::core::pipelines::pipeline_jobs(pool.inner(), instance_id, project_id, pipeline_id)
            .await?;
    Ok(jobs.into_iter().map(to_job_dto).collect())
}

#[tauri::command]
pub async fn get_project_pipelines(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    limit: Option<u32>,
) -> Result<Vec<PipelineStatus>, AppError> {
    let pipelines = crate::core::pipelines::project_pipelines(
        pool.inner(),
        instance_id,
        project_id,
        limit.unwrap_or(20),
    )
    .await?;
    Ok(pipelines.into_iter().map(to_status_dto).collect())
}

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

#[tauri::command]
pub async fn cancel_pipeline(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<PipelineStatus, AppError> {
    let p =
        crate::core::pipelines::cancel_pipeline(pool.inner(), instance_id, project_id, pipeline_id)
            .await?;
    Ok(to_status_dto(p))
}
```

Leave `resolve_project_by_path`, `get_job_trace`, and `create_gitlab_client` unchanged. After editing, some imports (`join_all`, `HashSet`, `pipeline_cache`, `project`, `GitLabInstance`) may become unused in this file — remove only the ones the compiler flags as unused; keep whatever `resolve_project_by_path`/`get_job_trace`/`create_gitlab_client` still need.

- [ ] **Step 3: Verify the whole lib compiles and tests pass**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean (resolve any "unused import" warnings by deleting those imports).

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (existing tests + the Task 1 tests).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/pipeline.rs
git commit -m "refactor(commands): delegate pipeline commands to core::pipelines"
```

---

## Phase 2 — CLI Pipelines tab

### Task 4: CLI data adapters for pipelines

**Files:**
- Modify: `src-tauri/cli/src/data.rs`
- Test: inline `#[cfg(test)]` in `src-tauri/cli/src/data.rs`

- [ ] **Step 1: Add row types, conversions, and loaders**

At the top of `src-tauri/cli/src/data.rs`, add to the existing `use` block:

```rust
use ultra_gitlab_lib::core::pipelines;
use ultra_gitlab_lib::models::{PipelineProject, Project};
use ultra_gitlab_lib::services::gitlab_client::{GitLabJob, GitLabPipeline};
```

(The file already imports `DbPool` and `AppError`; don't duplicate.)

Then append the following to `src-tauri/cli/src/data.rs` (above the `#[cfg(test)]` module):

```rust
/// Truncate a git SHA to its short 8-char form for display.
pub fn short_sha(sha: &str) -> String {
    if sha.len() > 8 {
        sha[..8].to_string()
    } else {
        sha.to_string()
    }
}

/// Latest pipeline status shown next to a project in the Projects view.
#[derive(Debug, Clone)]
pub struct PipeStatus {
    pub status: String,
    pub ref_name: String,
    pub sha: String,
    pub web_url: String,
    pub duration: Option<i64>,
}

/// A tracked project row in the Pipelines tab.
#[derive(Debug, Clone)]
pub struct PipeProjectRow {
    pub project_id: i64,
    pub name: String,
    pub web_url: String,
    pub pinned: bool,
    pub status: Option<PipeStatus>,
}

/// A pipeline row (project pipelines or MR pipelines).
#[derive(Debug, Clone)]
pub struct PipeRow {
    pub id: i64,
    pub project_id: i64,
    pub status: String,
    pub ref_name: String,
    pub sha: String,
    pub web_url: String,
    pub created_at: String,
    pub duration: Option<i64>,
}

impl From<GitLabPipeline> for PipeRow {
    fn from(p: GitLabPipeline) -> Self {
        PipeRow {
            id: p.id,
            project_id: p.project_id,
            status: p.status,
            ref_name: p.ref_name,
            sha: short_sha(&p.sha),
            web_url: p.web_url,
            created_at: p.created_at,
            duration: p.duration,
        }
    }
}

/// A job row within a pipeline.
#[derive(Debug, Clone)]
pub struct JobRow {
    pub id: i64,
    pub name: String,
    pub stage: String,
    pub status: String,
    pub web_url: String,
    pub allow_failure: bool,
    pub duration: Option<f64>,
}

impl From<GitLabJob> for JobRow {
    fn from(j: GitLabJob) -> Self {
        JobRow {
            id: j.id,
            name: j.name,
            stage: j.stage,
            status: j.status,
            web_url: j.web_url,
            allow_failure: j.allow_failure,
            duration: j.duration,
        }
    }
}

/// A project search result in the add-project overlay.
#[derive(Debug, Clone)]
pub struct ProjectHit {
    pub id: i64,
    pub name: String,
    pub web_url: String,
}

fn project_row(p: PipelineProject, status: Option<PipeStatus>) -> PipeProjectRow {
    PipeProjectRow {
        project_id: p.project_id,
        name: p.name_with_namespace,
        web_url: p.web_url,
        pinned: p.pinned,
        status,
    }
}

/// Load tracked projects with their cached statuses for instant glyphs.
pub async fn load_pipeline_projects(
    pool: &DbPool,
    instance_id: i64,
) -> Result<Vec<PipeProjectRow>, AppError> {
    let projects = pipelines::list_projects(pool, instance_id).await?;
    let ids: Vec<i64> = projects.iter().map(|p| p.project_id).collect();
    let cached = pipelines::cached_statuses(pool, instance_id, &ids).await?;
    let mut by_pid: std::collections::HashMap<i64, PipeStatus> = std::collections::HashMap::new();
    for c in cached {
        by_pid.insert(
            c.project_id,
            PipeStatus {
                status: c.status,
                ref_name: c.ref_name,
                sha: short_sha(&c.sha),
                web_url: c.web_url,
                duration: c.duration,
            },
        );
    }
    Ok(projects
        .into_iter()
        .map(|p| {
            let st = by_pid.remove(&p.project_id);
            project_row(p, st)
        })
        .collect())
}

/// Fetch live latest statuses for the given projects.
pub async fn load_project_statuses(
    pool: &DbPool,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<(i64, PipeStatus)>, AppError> {
    let live = pipelines::latest_statuses(pool, instance_id, &project_ids).await?;
    Ok(live
        .into_iter()
        .map(|p| {
            (
                p.project_id,
                PipeStatus {
                    status: p.status,
                    ref_name: p.ref_name,
                    sha: short_sha(&p.sha),
                    web_url: p.web_url,
                    duration: p.duration,
                },
            )
        })
        .collect())
}

/// Recent pipelines for a project.
pub async fn load_project_pipelines(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<PipeRow>, AppError> {
    Ok(pipelines::project_pipelines(pool, instance_id, project_id, 20)
        .await?
        .into_iter()
        .map(PipeRow::from)
        .collect())
}

/// Jobs (and bridges) for a pipeline.
pub async fn load_pipeline_jobs(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<JobRow>, AppError> {
    Ok(
        pipelines::pipeline_jobs(pool, instance_id, project_id, pipeline_id)
            .await?
            .into_iter()
            .map(JobRow::from)
            .collect(),
    )
}

/// Search projects to add to the dashboard.
pub async fn search_pipeline_projects(
    pool: &DbPool,
    instance_id: i64,
    query: String,
) -> Result<Vec<ProjectHit>, AppError> {
    Ok(pipelines::search_projects(pool, instance_id, &query)
        .await?
        .into_iter()
        .map(|p| ProjectHit {
            id: p.id,
            name: p.name_with_namespace,
            web_url: p.web_url,
        })
        .collect())
}

/// Pipelines attached to an MR (for the detail-screen panel).
pub async fn load_mr_pipelines(pool: &DbPool, mr_id: i64) -> Result<Vec<PipeRow>, AppError> {
    Ok(pipelines::mr_pipelines(pool, mr_id)
        .await?
        .into_iter()
        .map(PipeRow::from)
        .collect())
}
```

- [ ] **Step 2: Add a unit test for the pure conversion**

Append inside (or create) the `#[cfg(test)] mod tests` block in `src-tauri/cli/src/data.rs`:

```rust
#[test]
fn pipe_row_shortens_sha() {
    let p = ultra_gitlab_lib::services::gitlab_client::GitLabPipeline {
        id: 1,
        project_id: 10,
        status: "success".into(),
        ref_name: "main".into(),
        sha: "abcdef0123456789".into(),
        web_url: "http://x".into(),
        created_at: "2026-06-03T00:00:00Z".into(),
        updated_at: None,
        duration: Some(12),
    };
    let row = PipeRow::from(p);
    assert_eq!(row.sha, "abcdef01");
    assert_eq!(row.status, "success");
}
```

- [ ] **Step 3: Verify CLI compiles and the test passes**

Run: `cargo test --manifest-path src-tauri/cli/Cargo.toml data::`
Expected: PASS (includes `pipe_row_shortens_sha`). Unused-function warnings are expected here — they're wired up in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/data.rs
git commit -m "feat(cli): add pipeline data adapters and loaders"
```

---

### Task 5: Shared `status_style` helper + `open_url` util

**Files:**
- Modify: `src-tauri/cli/src/ui/mod.rs` (add `status_style`)
- Modify: `src-tauri/cli/src/ui/list.rs` (use shared helper)
- Create: `src-tauri/cli/src/util.rs`
- Modify: `src-tauri/cli/src/main.rs` (add `mod util;`)

- [ ] **Step 1: Add `status_style` to `ui/mod.rs`**

In `src-tauri/cli/src/ui/mod.rs`, add this public function at the end of the file:

```rust
/// Map a pipeline/job status string to a glyph and color, shared by the list,
/// pipelines, and detail views. `None` status renders a dim dot.
pub fn status_style(status: Option<&str>) -> (&'static str, Color) {
    match status {
        Some("success") => ("●", Color::Green),
        Some("failed") => ("●", Color::Red),
        Some("running") => ("●", Color::Yellow),
        Some("pending") | Some("created") | Some("waiting_for_resource") | Some("preparing")
        | Some("scheduled") => ("●", Color::Cyan),
        Some("canceled") | Some("skipped") => ("●", Color::DarkGray),
        Some("manual") => ("◆", Color::Magenta),
        Some(_) => ("●", Color::DarkGray),
        None => ("·", Color::DarkGray),
    }
}
```

(`Color` is already imported in `ui/mod.rs`.)

- [ ] **Step 2: Use the shared helper in `list.rs`**

In `src-tauri/cli/src/ui/list.rs`, replace the existing `pipeline_glyph` function:

```rust
fn pipeline_glyph(status: Option<&str>) -> Span<'static> {
    let (sym, color) = match status {
        Some("success") => ("●", Color::Green),
        Some("failed") => ("●", Color::Red),
        Some("running") => ("●", Color::Yellow),
        Some(_) => ("●", Color::DarkGray),
        None => ("·", Color::DarkGray),
    };
    Span::styled(sym, Style::default().fg(color))
}
```

with a thin wrapper over the shared helper:

```rust
fn pipeline_glyph(status: Option<&str>) -> Span<'static> {
    let (sym, color) = crate::ui::status_style(status);
    Span::styled(sym, Style::default().fg(color))
}
```

- [ ] **Step 3: Create the `open_url` util**

Create `src-tauri/cli/src/util.rs`:

```rust
//! Small CLI utilities.

/// Open a URL in the user's default browser. Best-effort; errors are ignored by
/// callers (the TUI shows a status line instead of failing).
pub fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", "", url]);
        c
    };
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}
```

- [ ] **Step 4: Register the module**

In `src-tauri/cli/src/main.rs`, the module list currently includes:

```rust
mod syntax;
mod ui;
mod update;
```

Add `mod util;` (and `mod pipelines;` will be added in Task 6 — add it now too to avoid a second edit):

```rust
mod pipelines;
mod syntax;
mod ui;
mod update;
mod util;
```

(Adding `mod pipelines;` now will cause a compile error until Task 6 creates the file. If executing strictly task-by-task, add only `mod util;` here and add `mod pipelines;` in Task 6 Step 1.)

- [ ] **Step 5: Verify compile (util + status_style)**

If you added only `mod util;` in Step 4:
Run: `cargo check --manifest-path src-tauri/cli/Cargo.toml`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/cli/src/ui/mod.rs src-tauri/cli/src/ui/list.rs src-tauri/cli/src/util.rs src-tauri/cli/src/main.rs
git commit -m "feat(cli): shared status_style helper and open_url util"
```

---

### Task 6: Pipelines state module (`pipelines.rs`)

**Files:**
- Create: `src-tauri/cli/src/pipelines.rs`
- Modify: `src-tauri/cli/src/main.rs` (`mod pipelines;` if not already added)
- Test: inline `#[cfg(test)]` in `src-tauri/cli/src/pipelines.rs`

This task defines the state types, view transitions, and spawn helpers. Key handling is added in Task 8 (needs the `App` fields from Task 7). To keep this task self-contained and testable, define the state types and pure transition helpers here first.

- [ ] **Step 1: Create the state module**

Create `src-tauri/cli/src/pipelines.rs`:

```rust
//! Pipelines tab: state, async spawns, and key handling.
//!
//! State lives on `App` (`app.pipelines`); the rendering lives in
//! `ui/pipelines.rs`. These functions operate on `&App`/`&mut App`, mirroring
//! the structure of `actions.rs`.

use crate::data;
use crate::event::AppEvent;
use ratatui::widgets::ListState;

/// Which level of the Pipelines tab drill is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipeView {
    Projects,
    Pipelines,
    Jobs,
}

/// The add-project search overlay.
#[derive(Debug, Default)]
pub struct SearchState {
    pub query: String,
    pub results: Vec<data::ProjectHit>,
    pub state: ListState,
    pub searching: bool,
}

/// A pending y/N confirmation for a pipeline/job cancel.
#[derive(Debug, Clone)]
pub struct PipeConfirm {
    pub action: PipeAction,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy)]
pub enum PipeAction {
    CancelPipeline { project_id: i64, pipeline_id: i64 },
    CancelJob { project_id: i64, job_id: i64 },
}

/// All Pipelines-tab state, held on `App`.
pub struct PipelinesState {
    pub view: PipeView,
    pub projects: Vec<data::PipeProjectRow>,
    pub proj_state: ListState,
    pub selected_project: Option<i64>,
    pub pipelines: Vec<data::PipeRow>,
    pub pipe_state: ListState,
    pub selected_pipeline: Option<i64>,
    pub jobs: Vec<data::JobRow>,
    pub job_state: ListState,
    pub search: Option<SearchState>,
    pub confirm: Option<PipeConfirm>,
    pub loaded: bool,
}

impl Default for PipelinesState {
    fn default() -> Self {
        PipelinesState {
            view: PipeView::Projects,
            projects: Vec::new(),
            proj_state: ListState::default(),
            selected_project: None,
            pipelines: Vec::new(),
            pipe_state: ListState::default(),
            selected_pipeline: None,
            jobs: Vec::new(),
            job_state: ListState::default(),
            search: None,
            confirm: None,
            loaded: false,
        }
    }
}

impl PipelinesState {
    /// Currently selected project id, if any.
    pub fn selected_project_id(&self) -> Option<i64> {
        self.proj_state
            .selected()
            .and_then(|i| self.projects.get(i))
            .map(|p| p.project_id)
    }

    /// Currently selected pipeline row, if any.
    pub fn selected_pipe(&self) -> Option<&data::PipeRow> {
        self.pipe_state.selected().and_then(|i| self.pipelines.get(i))
    }

    /// Currently selected job row, if any.
    pub fn selected_job(&self) -> Option<&data::JobRow> {
        self.job_state.selected().and_then(|i| self.jobs.get(i))
    }

    /// True if any visible pipeline/job is in flight (drives auto-refresh).
    pub fn has_inflight(&self) -> bool {
        let p = self
            .pipelines
            .iter()
            .any(|r| r.status == "running" || r.status == "pending");
        let j = self
            .jobs
            .iter()
            .any(|r| r.status == "running" || r.status == "pending");
        let proj = self.projects.iter().any(|r| {
            matches!(
                r.status.as_ref().map(|s| s.status.as_str()),
                Some("running") | Some("pending")
            )
        });
        match self.view {
            PipeView::Projects => proj,
            PipeView::Pipelines => p,
            PipeView::Jobs => j,
        }
    }
}

/// Clamp a ListState selection within `len` after a list changes.
pub fn clamp_selection(state: &mut ListState, len: usize) {
    if len == 0 {
        state.select(None);
    } else {
        let cur = state.selected().unwrap_or(0).min(len - 1);
        state.select(Some(cur));
    }
}

/// Move a ListState selection by `delta`, clamped to `[0, len)`.
pub fn move_in_list(state: &mut ListState, len: usize, delta: i32) {
    if len == 0 {
        return;
    }
    let cur = state.selected().unwrap_or(0) as i32;
    let next = (cur + delta).clamp(0, len as i32 - 1) as usize;
    state.select(Some(next));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(id: i64, status: Option<&str>) -> data::PipeProjectRow {
        data::PipeProjectRow {
            project_id: id,
            name: format!("group/p{id}"),
            web_url: "http://x".into(),
            pinned: false,
            status: status.map(|s| data::PipeStatus {
                status: s.into(),
                ref_name: "main".into(),
                sha: "abc".into(),
                web_url: "http://x".into(),
                duration: None,
            }),
        }
    }

    #[test]
    fn move_in_list_clamps() {
        let mut s = ListState::default();
        s.select(Some(0));
        move_in_list(&mut s, 3, -1);
        assert_eq!(s.selected(), Some(0));
        move_in_list(&mut s, 3, 1);
        assert_eq!(s.selected(), Some(1));
        move_in_list(&mut s, 3, 10);
        assert_eq!(s.selected(), Some(2));
    }

    #[test]
    fn has_inflight_checks_active_view() {
        let mut st = PipelinesState::default();
        st.projects = vec![proj(1, Some("running")), proj(2, Some("success"))];
        st.view = PipeView::Projects;
        assert!(st.has_inflight());
        st.projects = vec![proj(1, Some("success"))];
        assert!(!st.has_inflight());
    }

    #[test]
    fn clamp_selection_handles_empty() {
        let mut s = ListState::default();
        s.select(Some(5));
        clamp_selection(&mut s, 0);
        assert_eq!(s.selected(), None);
        clamp_selection(&mut s, 3);
        // was None now; clamp leaves None until re-selected
        s.select(Some(5));
        clamp_selection(&mut s, 3);
        assert_eq!(s.selected(), Some(2));
    }
}
```

- [ ] **Step 2: Ensure `mod pipelines;` is registered**

If not already added in Task 5 Step 4, add `mod pipelines;` to `src-tauri/cli/src/main.rs` alongside the other `mod` declarations.

- [ ] **Step 3: Run tests**

Run: `cargo test --manifest-path src-tauri/cli/Cargo.toml pipelines::`
Expected: PASS (`move_in_list_clamps`, `has_inflight_checks_active_view`, `clamp_selection_handles_empty`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/pipelines.rs src-tauri/cli/src/main.rs
git commit -m "feat(cli): add pipelines state module with view transitions"
```

---

### Task 7: Wire Pipelines state + events into `App`

**Files:**
- Modify: `src-tauri/cli/src/app.rs`
- Modify: `src-tauri/cli/src/event.rs`

- [ ] **Step 1: Add the `Pipelines` tab and `Pipeline` focus variants**

In `src-tauri/cli/src/app.rs`, change the `Tab` enum:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Review,
    Mine,
    Pipelines,
}
```

and the `Focus` enum:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    Tree,
    Diff,
    Pipeline,
}
```

- [ ] **Step 2: Add pipelines state fields to `App`**

In the `App` struct in `src-tauri/cli/src/app.rs`, add these fields (after `pub viewed: HashSet<String>,`):

```rust
    pub pipelines: crate::pipelines::PipelinesState,
    pub detail_pipes: crate::pipelines::DetailPipelines,
```

In `App::new`, initialize them (after `viewed: HashSet::new(),`):

```rust
            pipelines: crate::pipelines::PipelinesState::default(),
            detail_pipes: crate::pipelines::DetailPipelines::default(),
```

(`DetailPipelines` is defined in Task 11; if executing strictly in order, temporarily omit the `detail_pipes` field and its init, add them in Task 11. Otherwise define `DetailPipelines` now per Task 11 Step 1.)

- [ ] **Step 3: Add the new event variants**

In `src-tauri/cli/src/event.rs`, replace the `use` line and add variants:

```rust
use crate::data::{
    DetailData, JobRow, MrRow, PipeProjectRow, PipeRow, PipeStatus, ProjectHit,
};

/// A message produced by a background task and consumed by the event loop.
#[derive(Debug)]
pub enum AppEvent {
    Review(Result<Vec<MrRow>, String>),
    Mine(Result<Vec<MrRow>, String>),
    Detail(Result<DetailData, String>),
    /// (verb, result) for an action like "merge", "approve".
    ActionDone(String, Result<String, String>),

    // Pipelines tab
    PipeProjects(Result<Vec<PipeProjectRow>, String>),
    PipeStatuses(Result<Vec<(i64, PipeStatus)>, String>),
    PipeList(Result<Vec<PipeRow>, String>),
    PipeJobs(Result<Vec<JobRow>, String>),
    PipeSearch(Result<Vec<ProjectHit>, String>),
    /// Result message after pin/remove/add/play/retry/cancel.
    PipeActionDone(Result<String, String>),

    // MR detail pipelines panel
    MrPipes(Result<Vec<PipeRow>, String>),
    MrPipeJobs(Result<Vec<JobRow>, String>),
}
```

- [ ] **Step 4: Add event-handling arms**

In `src-tauri/cli/src/app.rs`, in `handle_event`, add arms before the final error-handling arms. Add this block inside the `match ev { ... }`:

```rust
        AppEvent::PipeProjects(Ok(rows)) => {
            app.busy = false;
            app.status = "Ready".into();
            if app.pipelines.proj_state.selected().is_none() && !rows.is_empty() {
                app.pipelines.proj_state.select(Some(0));
            }
            app.pipelines.projects = rows;
            app.pipelines.loaded = true;
            crate::pipelines::clamp_selection(
                &mut app.pipelines.proj_state,
                app.pipelines.projects.len(),
            );
            crate::pipelines::spawn_refresh_statuses(app);
        }
        AppEvent::PipeStatuses(Ok(pairs)) => {
            for (pid, st) in pairs {
                if let Some(row) = app
                    .pipelines
                    .projects
                    .iter_mut()
                    .find(|p| p.project_id == pid)
                {
                    row.status = Some(st);
                }
            }
        }
        AppEvent::PipeList(Ok(rows)) => {
            app.busy = false;
            app.status = "Ready".into();
            app.pipelines.pipelines = rows;
            if app.pipelines.pipe_state.selected().is_none()
                && !app.pipelines.pipelines.is_empty()
            {
                app.pipelines.pipe_state.select(Some(0));
            }
            crate::pipelines::clamp_selection(
                &mut app.pipelines.pipe_state,
                app.pipelines.pipelines.len(),
            );
        }
        AppEvent::PipeJobs(Ok(rows)) => {
            app.busy = false;
            app.status = "Ready".into();
            app.pipelines.jobs = rows;
            if app.pipelines.job_state.selected().is_none() && !app.pipelines.jobs.is_empty() {
                app.pipelines.job_state.select(Some(0));
            }
            crate::pipelines::clamp_selection(
                &mut app.pipelines.job_state,
                app.pipelines.jobs.len(),
            );
        }
        AppEvent::PipeSearch(Ok(rows)) => {
            if let Some(s) = app.pipelines.search.as_mut() {
                s.results = rows;
                s.searching = false;
                if s.state.selected().is_none() && !s.results.is_empty() {
                    s.state.select(Some(0));
                }
            }
        }
        AppEvent::PipeActionDone(Ok(msg)) => {
            app.busy = false;
            app.status = msg;
            crate::pipelines::reload_active_view(app);
        }
        AppEvent::MrPipes(Ok(rows)) => {
            app.detail_pipes.pipelines = rows;
            if app.detail_pipes.pipe_state.selected().is_none()
                && !app.detail_pipes.pipelines.is_empty()
            {
                app.detail_pipes.pipe_state.select(Some(0));
            }
        }
        AppEvent::MrPipeJobs(Ok(rows)) => {
            app.detail_pipes.jobs = Some(rows);
            app.detail_pipes.job_state.select(Some(0));
        }
        AppEvent::PipeProjects(Err(e))
        | AppEvent::PipeStatuses(Err(e))
        | AppEvent::PipeList(Err(e))
        | AppEvent::PipeJobs(Err(e))
        | AppEvent::PipeSearch(Err(e))
        | AppEvent::PipeActionDone(Err(e))
        | AppEvent::MrPipes(Err(e))
        | AppEvent::MrPipeJobs(Err(e)) => {
            app.busy = false;
            app.status = format!("Error: {e}");
        }
```

(The `spawn_refresh_statuses`, `reload_active_view` functions are added in Task 8. If executing strictly in order, stub them in Task 8 before this compiles — Task 8 adds them. To keep Task 7 compiling on its own, you may temporarily comment out the two `crate::pipelines::spawn_refresh_statuses(app);` / `reload_active_view(app)` calls and restore them in Task 8.)

- [ ] **Step 5: Verify compile (after Task 8 lands the spawn helpers)**

Defer the full `cargo check` to Task 8 Step 4, since the spawn helpers referenced here are added there. If you want Task 7 to compile standalone, comment out the two referenced calls noted above.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/cli/src/app.rs src-tauri/cli/src/event.rs
git commit -m "feat(cli): add Pipelines tab/focus state and events to App"
```

---

### Task 8: Pipelines spawn helpers + key handling

**Files:**
- Modify: `src-tauri/cli/src/pipelines.rs`
- Modify: `src-tauri/cli/src/app.rs` (routing + confirm interception + tab switching)

- [ ] **Step 1: Add spawn helpers and reload logic to `pipelines.rs`**

Add to `src-tauri/cli/src/pipelines.rs` (after the `move_in_list` function, before tests). Note the `use` additions at top of the file:

```rust
use crate::app::{App, Tab};
use std::sync::Arc;
use ultra_gitlab_lib::db::pool::DbPool;
```

```rust
/// Entering the Pipelines tab: load projects if not yet loaded.
pub fn enter_tab(app: &mut App) {
    app.busy = true;
    app.status = "Loading pipelines…".into();
    spawn_load_projects(app);
}

pub fn spawn_load_projects(app: &App) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_pipeline_projects(&pool, inst)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeProjects(r));
    });
}

/// Refresh live statuses for all currently-listed projects.
pub fn spawn_refresh_statuses(app: &App) {
    let ids: Vec<i64> = app.pipelines.projects.iter().map(|p| p.project_id).collect();
    if ids.is_empty() {
        return;
    }
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_project_statuses(&pool, inst, ids)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeStatuses(r));
    });
}

pub fn spawn_load_pipelines(app: &App, project_id: i64) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_project_pipelines(&pool, inst, project_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeList(r));
    });
}

pub fn spawn_load_jobs(app: &App, project_id: i64, pipeline_id: i64) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_pipeline_jobs(&pool, inst, project_id, pipeline_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeJobs(r));
    });
}

pub fn spawn_search(app: &App, query: String) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::search_pipeline_projects(&pool, inst, query)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeSearch(r));
    });
}

/// Spawn a fire-and-reload action (pin/remove/add/play/retry/cancel).
fn spawn_action<F, Fut>(app: &mut App, label: &str, f: F)
where
    F: FnOnce(Arc<DbPool>, i64) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<String, String>> + Send + 'static,
{
    app.busy = true;
    app.status = format!("{label}…");
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = f(pool, inst).await;
        let _ = tx.send(AppEvent::PipeActionDone(r));
    });
}

/// After a successful action, reload whichever view is active.
pub fn reload_active_view(app: &mut App) {
    match app.pipelines.view {
        PipeView::Projects => spawn_load_projects(app),
        PipeView::Pipelines => {
            if let Some(pid) = app.pipelines.selected_project {
                spawn_load_pipelines(app, pid);
            }
        }
        PipeView::Jobs => {
            if let (Some(pid), Some(plid)) =
                (app.pipelines.selected_project, app.pipelines.selected_pipeline)
            {
                spawn_load_jobs(app, pid, plid);
            }
        }
    }
}

/// Run a confirmed cancel.
pub fn run_confirmed(app: &mut App, action: PipeAction) {
    match action {
        PipeAction::CancelPipeline { project_id, pipeline_id } => {
            spawn_action(app, "cancel pipeline", move |pool, inst| async move {
                ultra_gitlab_lib::core::pipelines::cancel_pipeline(&pool, inst, project_id, pipeline_id)
                    .await
                    .map(|_| "pipeline canceled".to_string())
                    .map_err(|e| e.to_string())
            });
        }
        PipeAction::CancelJob { project_id, job_id } => {
            spawn_action(app, "cancel job", move |pool, inst| async move {
                ultra_gitlab_lib::core::pipelines::cancel_job(&pool, inst, project_id, job_id)
                    .await
                    .map(|_| "job canceled".to_string())
                    .map_err(|e| e.to_string())
            });
        }
    }
}
```

- [ ] **Step 2: Add the key handler to `pipelines.rs`**

Add to `src-tauri/cli/src/pipelines.rs` (after `run_confirmed`). Needs `use crossterm::event::KeyCode;` at the top of the file:

```rust
/// Handle a key while the Pipelines tab is active (and no global key matched).
pub fn handle_key(app: &mut App, code: KeyCode) {
    // Search overlay swallows input.
    if app.pipelines.search.is_some() {
        handle_search_key(app, code);
        return;
    }
    match app.pipelines.view {
        PipeView::Projects => handle_projects_key(app, code),
        PipeView::Pipelines => handle_pipelines_key(app, code),
        PipeView::Jobs => handle_jobs_key(app, code),
    }
}

fn handle_projects_key(app: &mut App, code: KeyCode) {
    let len = app.pipelines.projects.len();
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.pipelines.proj_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.pipelines.proj_state, len, -1),
        KeyCode::Char('r') => {
            spawn_load_projects(app);
            app.status = "Refreshing…".into();
        }
        KeyCode::Char('n') => {
            app.pipelines.search = Some(SearchState::default());
            app.status = "Search projects to add (esc to cancel)".into();
        }
        KeyCode::Char('p') => {
            if let Some(pid) = app.pipelines.selected_project_id() {
                spawn_action(app, "toggle pin", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::toggle_pin(&pool, inst, pid)
                        .await
                        .map(|_| "pin toggled".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('x') => {
            if let Some(pid) = app.pipelines.selected_project_id() {
                spawn_action(app, "remove", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::remove_project(&pool, inst, pid)
                        .await
                        .map(|_| "project removed".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('o') => {
            if let Some(p) = app
                .pipelines
                .proj_state
                .selected()
                .and_then(|i| app.pipelines.projects.get(i))
            {
                let _ = crate::util::open_url(&p.web_url);
            }
        }
        KeyCode::Enter => {
            if let Some(pid) = app.pipelines.selected_project_id() {
                app.pipelines.selected_project = Some(pid);
                app.pipelines.view = PipeView::Pipelines;
                app.pipelines.pipelines.clear();
                app.pipelines.pipe_state.select(None);
                app.busy = true;
                app.status = "Loading pipelines…".into();
                spawn_load_pipelines(app, pid);
            }
        }
        _ => {}
    }
}

fn handle_pipelines_key(app: &mut App, code: KeyCode) {
    let len = app.pipelines.pipelines.len();
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.pipelines.pipe_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.pipelines.pipe_state, len, -1),
        KeyCode::Esc => {
            app.pipelines.view = PipeView::Projects;
        }
        KeyCode::Char('o') => {
            if let Some(p) = app.pipelines.selected_pipe() {
                let _ = crate::util::open_url(&p.web_url);
            }
        }
        KeyCode::Char('c') => {
            if let Some(p) = app.pipelines.selected_pipe() {
                app.pipelines.confirm = Some(PipeConfirm {
                    action: PipeAction::CancelPipeline {
                        project_id: p.project_id,
                        pipeline_id: p.id,
                    },
                    prompt: format!("Cancel pipeline #{}? (y/N)", p.id),
                });
                app.status = "Cancel pipeline? Press y to confirm.".into();
            }
        }
        KeyCode::Enter => {
            if let Some(p) = app.pipelines.selected_pipe() {
                let (pid, plid) = (p.project_id, p.id);
                app.pipelines.selected_pipeline = Some(plid);
                app.pipelines.view = PipeView::Jobs;
                app.pipelines.jobs.clear();
                app.pipelines.job_state.select(None);
                app.busy = true;
                app.status = "Loading jobs…".into();
                spawn_load_jobs(app, pid, plid);
            }
        }
        _ => {}
    }
}

fn handle_jobs_key(app: &mut App, code: KeyCode) {
    let len = app.pipelines.jobs.len();
    let project_id = app.pipelines.selected_project.unwrap_or(0);
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.pipelines.job_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.pipelines.job_state, len, -1),
        KeyCode::Esc => {
            app.pipelines.view = PipeView::Pipelines;
        }
        KeyCode::Char('o') => {
            if let Some(j) = app.pipelines.selected_job() {
                let _ = crate::util::open_url(&j.web_url);
            }
        }
        KeyCode::Char('p') => {
            if let Some(j) = app.pipelines.selected_job() {
                let job_id = j.id;
                spawn_action(app, "play", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::play_job(&pool, inst, project_id, job_id)
                        .await
                        .map(|_| "job started".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('R') => {
            if let Some(j) = app.pipelines.selected_job() {
                let job_id = j.id;
                spawn_action(app, "retry", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::retry_job(&pool, inst, project_id, job_id)
                        .await
                        .map(|_| "job retried".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('c') => {
            if let Some(j) = app.pipelines.selected_job() {
                app.pipelines.confirm = Some(PipeConfirm {
                    action: PipeAction::CancelJob {
                        project_id,
                        job_id: j.id,
                    },
                    prompt: format!("Cancel job {}? (y/N)", j.name),
                });
                app.status = "Cancel job? Press y to confirm.".into();
            }
        }
        _ => {}
    }
}

fn handle_search_key(app: &mut App, code: KeyCode) {
    let Some(search) = app.pipelines.search.as_mut() else { return };
    match code {
        KeyCode::Esc => {
            app.pipelines.search = None;
            app.status = "Ready".into();
        }
        KeyCode::Backspace => {
            search.query.pop();
        }
        KeyCode::Char(c) => {
            search.query.push(c);
        }
        KeyCode::Down => move_in_list(&mut search.state, search.results.len(), 1),
        KeyCode::Up => move_in_list(&mut search.state, search.results.len(), -1),
        KeyCode::Enter => {
            // If a result is highlighted, add it; otherwise run the search.
            if !search.results.is_empty() {
                if let Some(hit) = search.state.selected().and_then(|i| search.results.get(i)) {
                    let pid = hit.id;
                    app.pipelines.search = None;
                    spawn_action(app, "add project", move |pool, inst| async move {
                        ultra_gitlab_lib::core::pipelines::add_project(&pool, inst, pid)
                            .await
                            .map(|_| "project added".to_string())
                            .map_err(|e| e.to_string())
                    });
                    return;
                }
            }
            let q = search.query.clone();
            if !q.is_empty() {
                search.searching = true;
                spawn_search(app, q);
            }
        }
        _ => {}
    }
}
```

Note: `KeyCode::Char(c)` in `handle_search_key` intentionally captures `1`/`2`/`3` so they type into the query — the global tab keys in `app.rs` are bypassed while the overlay is open (see Step 3).

- [ ] **Step 3: Route keys, intercept the pipeline confirm, and switch tabs in `app.rs`**

In `src-tauri/cli/src/app.rs`, at the very top of `handle_key` (before the existing MR `confirm` interception), add the pipeline-confirm interception:

```rust
    // Pipeline cancel confirmation intercepts keys first when active.
    if app.tab == Tab::Pipelines {
        if let Some(c) = app.pipelines.confirm.clone() {
            match code {
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    app.pipelines.confirm = None;
                    crate::pipelines::run_confirmed(app, c.action);
                }
                _ => {
                    app.pipelines.confirm = None;
                    app.status = "Cancelled".into();
                }
            }
            return;
        }
    }
```

(For this to compile, derive `Clone` on `PipeConfirm` — already done in Task 6.)

Then replace `handle_list_key` in `src-tauri/cli/src/app.rs` with:

```rust
fn handle_list_key(app: &mut App, code: KeyCode) {
    // While the add-project overlay is open, all keys go to the overlay.
    if app.tab == Tab::Pipelines && app.pipelines.search.is_some() {
        crate::pipelines::handle_key(app, code);
        return;
    }

    // Global keys: tab switch + quit work in every list tab.
    match code {
        KeyCode::Char('q') => {
            app.should_quit = true;
            return;
        }
        KeyCode::Char('1') => {
            switch_tab(app, Tab::Review);
            return;
        }
        KeyCode::Char('2') => {
            switch_tab(app, Tab::Mine);
            return;
        }
        KeyCode::Char('3') => {
            switch_tab(app, Tab::Pipelines);
            return;
        }
        KeyCode::Tab => {
            toggle_tab(app);
            return;
        }
        _ => {}
    }

    if app.tab == Tab::Pipelines {
        crate::pipelines::handle_key(app, code);
        return;
    }

    match code {
        KeyCode::Char('j') | KeyCode::Down => move_selection(app, 1),
        KeyCode::Char('k') | KeyCode::Up => move_selection(app, -1),
        KeyCode::Char('r') => app.load_lists(),
        KeyCode::Enter => open_detail(app),
        _ => {}
    }
}

fn switch_tab(app: &mut App, tab: Tab) {
    app.tab = tab;
    app.list_state.select(Some(0));
    if tab == Tab::Pipelines && !app.pipelines.loaded {
        crate::pipelines::enter_tab(app);
    }
}
```

Replace the existing `toggle_tab` with a three-way cycle:

```rust
fn toggle_tab(app: &mut App) {
    let next = match app.tab {
        Tab::Review => Tab::Mine,
        Tab::Mine => Tab::Pipelines,
        Tab::Pipelines => Tab::Review,
    };
    switch_tab(app, next);
}
```

- [ ] **Step 4: Verify compile**

Run: `cargo check --manifest-path src-tauri/cli/Cargo.toml`
Expected: clean. Fix any unused-import or pattern-match-exhaustiveness errors (e.g. ensure all `match app.tab` sites that must be exhaustive handle `Tab::Pipelines`).

- [ ] **Step 5: Run all CLI tests**

Run: `cargo test --manifest-path src-tauri/cli/Cargo.toml`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/cli/src/pipelines.rs src-tauri/cli/src/app.rs
git commit -m "feat(cli): pipelines tab key handling, spawns, and tab switching"
```

---

### Task 9: Render the Pipelines tab (`ui/pipelines.rs`)

**Files:**
- Create: `src-tauri/cli/src/ui/pipelines.rs`
- Modify: `src-tauri/cli/src/ui/mod.rs` (declare module + dispatch + tab bar)

- [ ] **Step 1: Declare the module and dispatch to it**

In `src-tauri/cli/src/ui/mod.rs`, add to the module declarations at the top:

```rust
pub mod detail;
pub mod diff;
pub mod footer;
pub mod list;
pub mod pipelines;
```

Change the `draw` body's screen match to route the Pipelines tab:

```rust
    match app.screen {
        Screen::List => match app.tab {
            Tab::Pipelines => pipelines::render(f, app, chunks[1]),
            _ => list::render(f, app, chunks[1]),
        },
        Screen::Detail => detail::render(f, app, chunks[1]),
    }
```

Update `render_tabs` to add the third tab:

```rust
    let line = Line::from(vec![
        span("1 Review", app.tab == Tab::Review),
        Span::raw(" "),
        span("2 Mine", app.tab == Tab::Mine),
        Span::raw(" "),
        span("3 Pipelines", app.tab == Tab::Pipelines),
        Span::raw("   "),
        Span::styled(
            app.username.as_deref().map(|u| format!("@{u}")).unwrap_or_default(),
            Style::default().fg(Color::DarkGray),
        ),
    ]);
```

- [ ] **Step 2: Create the renderer**

Create `src-tauri/cli/src/ui/pipelines.rs`:

```rust
//! Pipelines tab rendering: projects → pipelines → jobs, plus the add-project
//! search overlay.

use crate::app::App;
use crate::pipelines::PipeView;
use crate::ui::status_style;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph};
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &mut App, area: Rect) {
    match app.pipelines.view {
        PipeView::Projects => render_projects(f, app, area),
        PipeView::Pipelines => render_pipelines(f, app, area),
        PipeView::Jobs => render_jobs(f, app, area),
    }
    if app.pipelines.search.is_some() {
        render_search(f, app, area);
    }
}

fn glyph(status: Option<&str>) -> Span<'static> {
    let (sym, color) = status_style(status);
    Span::styled(sym, Style::default().fg(color))
}

fn fmt_duration(secs: Option<i64>) -> String {
    match secs {
        Some(s) if s > 0 => format!("{}m{:02}s", s / 60, s % 60),
        _ => "-".to_string(),
    }
}

fn render_projects(f: &mut Frame, app: &mut App, area: Rect) {
    if app.pipelines.projects.is_empty() {
        let msg = if app.busy {
            "Loading…"
        } else {
            "No projects pinned. Press n to search and add a project."
        };
        let block = Block::default().borders(Borders::ALL).title(" Pipelines ");
        f.render_widget(Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = app
        .pipelines
        .projects
        .iter()
        .map(|p| {
            let pin = if p.pinned {
                Span::styled("📌 ", Style::default())
            } else {
                Span::raw("   ")
            };
            let st = p.status.as_ref();
            let mut spans = vec![
                glyph(st.map(|s| s.status.as_str())),
                Span::raw(" "),
                pin,
                Span::styled(
                    p.name.clone(),
                    Style::default().fg(Color::Blue),
                ),
            ];
            if let Some(s) = st {
                spans.push(Span::raw("  "));
                spans.push(Span::styled(
                    s.status.clone(),
                    Style::default().fg(Color::DarkGray),
                ));
                spans.push(Span::styled(
                    format!("  {}", s.ref_name),
                    Style::default().fg(Color::DarkGray),
                ));
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Pipelines · Projects "),
        )
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.pipelines.proj_state);
}

fn render_pipelines(f: &mut Frame, app: &mut App, area: Rect) {
    let title = " Pipelines ".to_string();
    if app.pipelines.pipelines.is_empty() {
        let msg = if app.busy { "Loading…" } else { "No pipelines." };
        let block = Block::default().borders(Borders::ALL).title(title);
        f.render_widget(Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = app
        .pipelines
        .pipelines
        .iter()
        .map(|p| {
            let spans = vec![
                glyph(Some(p.status.as_str())),
                Span::raw(" "),
                Span::styled(format!("#{}", p.id), Style::default().fg(Color::Cyan)),
                Span::raw("  "),
                Span::styled(p.status.clone(), Style::default().fg(Color::DarkGray)),
                Span::raw("  "),
                Span::raw(p.ref_name.clone()),
                Span::raw("  "),
                Span::styled(p.sha.clone(), Style::default().fg(Color::DarkGray)),
                Span::raw("  "),
                Span::styled(fmt_duration(p.duration), Style::default().fg(Color::DarkGray)),
            ];
            ListItem::new(Line::from(spans))
        })
        .collect();
    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Pipelines · esc: back "),
        )
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.pipelines.pipe_state);
}

fn render_jobs(f: &mut Frame, app: &mut App, area: Rect) {
    if app.pipelines.jobs.is_empty() {
        let msg = if app.busy { "Loading…" } else { "No jobs." };
        let block = Block::default().borders(Borders::ALL).title(" Jobs ");
        f.render_widget(Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = app
        .pipelines
        .jobs
        .iter()
        .map(|j| {
            let mut spans = vec![
                glyph(Some(j.status.as_str())),
                Span::raw(" "),
                Span::styled(format!("{:<10}", j.stage), Style::default().fg(Color::DarkGray)),
                Span::raw(" "),
                Span::raw(j.name.clone()),
                Span::raw("  "),
                Span::styled(j.status.clone(), Style::default().fg(Color::DarkGray)),
            ];
            if j.allow_failure {
                spans.push(Span::styled(
                    " (allowed to fail)",
                    Style::default().fg(Color::DarkGray),
                ));
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Jobs · p play · R retry · c cancel · esc back "),
        )
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.pipelines.job_state);
}

fn render_search(f: &mut Frame, app: &mut App, area: Rect) {
    let Some(search) = app.pipelines.search.as_mut() else { return };
    // Centered overlay box.
    let w = area.width.saturating_mul(3) / 4;
    let h = (search.results.len() as u16 + 4).clamp(6, area.height.saturating_sub(2));
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };

    f.render_widget(Clear, popup);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)])
        .split(popup);

    let query_line = Line::from(vec![
        Span::styled("Search: ", Style::default().fg(Color::DarkGray)),
        Span::raw(search.query.clone()),
        Span::styled("▌", Style::default().fg(Color::Cyan)),
    ]);
    f.render_widget(
        Paragraph::new(query_line).block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Add project (enter: search/add · esc: cancel) "),
        ),
        chunks[0],
    );

    let items: Vec<ListItem> = search
        .results
        .iter()
        .map(|h| ListItem::new(Line::from(Span::raw(h.name.clone()))))
        .collect();
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Results "))
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, chunks[1], &mut search.state);
}
```

- [ ] **Step 3: Verify compile**

Run: `cargo check --manifest-path src-tauri/cli/Cargo.toml`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/ui/pipelines.rs src-tauri/cli/src/ui/mod.rs
git commit -m "feat(cli): render pipelines tab (projects/pipelines/jobs + search)"
```

---

### Task 10: Footer hints + auto-refresh tick

**Files:**
- Modify: `src-tauri/cli/src/ui/footer.rs`
- Modify: `src-tauri/cli/src/app.rs` (event loop interval)

- [ ] **Step 1: Add footer hints for the Pipelines tab**

In `src-tauri/cli/src/ui/footer.rs`, replace the `hints` match. The current `Screen::List` arm is a single string; make it tab-aware:

```rust
pub fn render(f: &mut Frame, app: &App, area: Rect) {
    let hints = match app.screen {
        Screen::List => match app.tab {
            Tab::Review | Tab::Mine => "1/2/3 tabs · j/k move · enter open · r refresh · q quit",
            Tab::Pipelines => match app.pipelines.view {
                crate::pipelines::PipeView::Projects => {
                    "1/2/3 tabs · j/k · enter open · p pin · x remove · n add · o browser · r refresh · q quit"
                }
                crate::pipelines::PipeView::Pipelines => {
                    "j/k · enter jobs · c cancel · o browser · esc back · q quit"
                }
                crate::pipelines::PipeView::Jobs => {
                    "j/k · p play · R retry · c cancel · o browser · esc back · q quit"
                }
            },
        },
        Screen::Detail => match app.tab {
            Tab::Review => "→/← focus · j/k scroll · V viewed · a approve/unapprove · esc back",
            Tab::Mine => "→/← focus · j/k scroll · V viewed · R rebase · M merge · U undraft · A auto-merge · esc back",
            Tab::Pipelines => "esc back",
        },
    };
    let line = if let Some(confirm) = &app.confirm {
        format!(" {}", confirm.prompt)
    } else if let Some(c) = &app.pipelines.confirm {
        format!(" {}", c.prompt)
    } else {
        let spinner = if app.busy { "⏳ " } else { "" };
        format!(" {spinner}{}  |  {hints}", app.status)
    };
    f.render_widget(
        Paragraph::new(line).style(Style::default().fg(Color::Gray)),
        area,
    );
}
```

(`Tab` is already imported in `footer.rs`.)

- [ ] **Step 2: Add a 10s auto-refresh tick to the event loop**

In `src-tauri/cli/src/app.rs`, in `run`, add a tokio interval and a third `select!` branch. Replace the loop setup and `tokio::select!` block:

```rust
    let mut keys = EventStream::new();
    app.load_lists();
    terminal.draw(|f| ui::draw(f, &mut app))?;

    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(10));
    // The first tick fires immediately; skip it so we don't double-load on start.
    ticker.tick().await;

    loop {
        tokio::select! {
            maybe_key = keys.next() => {
                if let Some(Ok(Event::Key(key))) = maybe_key {
                    if key.kind == KeyEventKind::Press {
                        handle_key(&mut app, key.code);
                    }
                }
            }
            Some(ev) = rx.recv() => {
                handle_event(&mut app, ev);
            }
            _ = ticker.tick() => {
                on_tick(&mut app);
            }
        }
        if app.should_quit {
            break;
        }
        if app.force_clear {
            terminal.clear()?;
            app.force_clear = false;
        }
        terminal.draw(|f| ui::draw(f, &mut app))?;
    }
    Ok(())
```

Add the `on_tick` function below `run`:

```rust
/// Periodic refresh: while the active pipelines view (or MR-detail panel) has an
/// in-flight pipeline/job, re-fetch it so status changes appear without input.
fn on_tick(app: &mut App) {
    if app.busy {
        return;
    }
    if app.tab == Tab::Pipelines && app.screen == Screen::List && app.pipelines.search.is_none() {
        if app.pipelines.has_inflight() {
            crate::pipelines::reload_active_view(app);
        }
        return;
    }
    if app.screen == Screen::Detail {
        let inflight = app
            .detail_pipes
            .jobs
            .as_ref()
            .map(|jobs| jobs.iter().any(|j| j.status == "running" || j.status == "pending"))
            .unwrap_or_else(|| {
                app.detail_pipes
                    .pipelines
                    .iter()
                    .any(|p| p.status == "running" || p.status == "pending")
            });
        if inflight {
            crate::pipelines::refresh_detail(app);
        }
    }
}
```

(`refresh_detail` is added in Task 12. If executing strictly in order, guard the `Screen::Detail` block behind a comment until Task 12, or add `refresh_detail` now per Task 12 Step 2.)

- [ ] **Step 3: Verify compile + run the app manually**

Run: `cargo check --manifest-path src-tauri/cli/Cargo.toml`
Expected: clean.

Manual (requires the desktop app DB with a signed-in instance — see CLAUDE.md test credentials):
Run: `cargo run --manifest-path src-tauri/cli/Cargo.toml`
Verify: press `3` → Pipelines tab loads; `n` opens search, type a project name, `enter` searches, `enter` on a result adds it; `p` pins; `enter` drills into pipelines then jobs; `o` opens browser; `esc` walks back; `q` quits.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/ui/footer.rs src-tauri/cli/src/app.rs
git commit -m "feat(cli): pipelines footer hints and 10s auto-refresh tick"
```

---

## Phase 3 — Pipelines in MR detail (third panel)

### Task 11: `DetailPipelines` state + load on detail open

**Files:**
- Modify: `src-tauri/cli/src/pipelines.rs` (add `DetailPipelines`)
- Modify: `src-tauri/cli/src/app.rs` (init field if not already; load + reset on open; reset on close)

- [ ] **Step 1: Define `DetailPipelines`**

Add to `src-tauri/cli/src/pipelines.rs` (near `PipelinesState`):

```rust
/// Pipelines panel state on the MR detail screen, reset per MR.
#[derive(Default)]
pub struct DetailPipelines {
    pub pipelines: Vec<data::PipeRow>,
    pub pipe_state: ListState,
    /// `Some` => the panel is showing the selected pipeline's jobs inline.
    pub jobs: Option<Vec<data::JobRow>>,
    pub job_state: ListState,
}

impl DetailPipelines {
    pub fn reset(&mut self) {
        self.pipelines.clear();
        self.pipe_state = ListState::default();
        self.jobs = None;
        self.job_state = ListState::default();
    }

    pub fn selected_pipe(&self) -> Option<&data::PipeRow> {
        self.pipe_state.selected().and_then(|i| self.pipelines.get(i))
    }

    pub fn selected_job(&self) -> Option<&data::JobRow> {
        self.jobs
            .as_ref()
            .and_then(|jobs| self.job_state.selected().and_then(|i| jobs.get(i)))
    }
}
```

- [ ] **Step 2: Ensure the `App` field exists**

Confirm `src-tauri/cli/src/app.rs` `App` has `pub detail_pipes: crate::pipelines::DetailPipelines,` and `App::new` initializes it with `crate::pipelines::DetailPipelines::default()` (added in Task 7 Step 2).

- [ ] **Step 3: Load MR pipelines when detail opens; reset on close**

In `src-tauri/cli/src/app.rs`, in `open_detail`, after the existing diff-load spawn, add the MR-pipelines spawn and reset. The current tail of `open_detail` is:

```rust
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_detail(&pool, mr_id).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Detail(r));
    });
}
```

Replace it with:

```rust
    app.detail_pipes.reset();
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_detail(&pool, mr_id).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Detail(r));
    });
    let pool2 = app.pool.clone();
    let tx2 = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_mr_pipelines(&pool2, mr_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx2.send(AppEvent::MrPipes(r));
    });
}
```

In `handle_detail_key`, the Esc/q arm that leaves the detail screen currently is:

```rust
        KeyCode::Esc | KeyCode::Char('q') => {
            app.screen = Screen::List;
            app.detail = None;
            app.force_clear = true;
        }
```

Add a reset:

```rust
        KeyCode::Esc | KeyCode::Char('q') => {
            app.screen = Screen::List;
            app.detail = None;
            app.detail_pipes.reset();
            app.force_clear = true;
        }
```

- [ ] **Step 4: Verify compile**

Run: `cargo check --manifest-path src-tauri/cli/Cargo.toml`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/cli/src/pipelines.rs src-tauri/cli/src/app.rs
git commit -m "feat(cli): load MR pipelines on detail open with reset lifecycle"
```

---

### Task 12: MR-detail panel focus + keys

**Files:**
- Modify: `src-tauri/cli/src/app.rs` (focus cycle + detail panel keys)
- Modify: `src-tauri/cli/src/pipelines.rs` (detail panel spawns + key handler)

- [ ] **Step 1: Add the focus cycle to the `Pipeline` panel**

In `src-tauri/cli/src/app.rs`, in `handle_detail_key`, replace the `Tab`/left/right arms:

```rust
        KeyCode::Tab => {
            app.focus = match app.focus {
                Focus::Tree => Focus::Diff,
                Focus::Diff => Focus::Tree,
            };
        }
        // Right (or vim l) jumps into the diff to scroll it; Left (or h) back to files.
        KeyCode::Right | KeyCode::Char('l') => app.focus = Focus::Diff,
        KeyCode::Left | KeyCode::Char('h') => app.focus = Focus::Tree,
```

with:

```rust
        KeyCode::Tab => {
            app.focus = match app.focus {
                Focus::Tree => Focus::Diff,
                Focus::Diff => Focus::Pipeline,
                Focus::Pipeline => Focus::Tree,
            };
        }
        // Right (or vim l) jumps into the diff; Left (or h) back to files. The
        // pipelines panel is reached via Tab.
        KeyCode::Right | KeyCode::Char('l') => app.focus = Focus::Diff,
        KeyCode::Left | KeyCode::Char('h') => app.focus = Focus::Tree,
```

Then route detail keys to the pipelines panel handler when it's focused. The `handle_detail_key` body currently routes scroll keys by `app.focus` (Tree/Diff) and ends with `other => crate::actions::handle_action_key(app, other)`. Add a Pipeline branch to the `j`/`k` arms and to the catch-all. Replace the `j`/`k` arms:

```rust
        KeyCode::Char('j') | KeyCode::Down => match app.focus {
            Focus::Tree => move_file(app, 1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_add(1),
        },
        KeyCode::Char('k') | KeyCode::Up => match app.focus {
            Focus::Tree => move_file(app, -1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_sub(1),
        },
        // Actions handled in Task 8.
        other => crate::actions::handle_action_key(app, other),
```

with:

```rust
        KeyCode::Char('j') | KeyCode::Down => match app.focus {
            Focus::Tree => move_file(app, 1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_add(1),
            Focus::Pipeline => crate::pipelines::handle_detail_key(app, KeyCode::Char('j')),
        },
        KeyCode::Char('k') | KeyCode::Up => match app.focus {
            Focus::Tree => move_file(app, -1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_sub(1),
            Focus::Pipeline => crate::pipelines::handle_detail_key(app, KeyCode::Char('k')),
        },
        other => {
            if app.focus == Focus::Pipeline {
                crate::pipelines::handle_detail_key(app, other);
            } else {
                crate::actions::handle_action_key(app, other);
            }
        }
```

- [ ] **Step 2: Add detail-panel spawns and key handler to `pipelines.rs`**

Add to `src-tauri/cli/src/pipelines.rs`:

```rust
/// Load jobs for a pipeline shown in the MR-detail panel.
pub fn spawn_detail_jobs(app: &App, project_id: i64, pipeline_id: i64) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_pipeline_jobs(&pool, inst, project_id, pipeline_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::MrPipeJobs(r));
    });
}

/// Re-fetch the MR-detail panel's current view (pipeline list or inline jobs).
pub fn refresh_detail(app: &mut App) {
    let Some(mr_id) = app.detail.as_ref().map(|d| d.row.id) else { return };
    if let Some(pipe) = app.detail_pipes.selected_pipe() {
        if app.detail_pipes.jobs.is_some() {
            let (pid, plid) = (pipe.project_id, pipe.id);
            spawn_detail_jobs(app, pid, plid);
            return;
        }
    }
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_mr_pipelines(&pool, mr_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::MrPipes(r));
    });
}

/// Keys while the MR-detail pipelines panel is focused.
pub fn handle_detail_key(app: &mut App, code: KeyCode) {
    // Inline jobs mode.
    if app.detail_pipes.jobs.is_some() {
        let job_len = app.detail_pipes.jobs.as_ref().map(|j| j.len()).unwrap_or(0);
        let project_id = app
            .detail_pipes
            .selected_pipe()
            .map(|p| p.project_id)
            .unwrap_or(0);
        match code {
            KeyCode::Char('j') | KeyCode::Down => {
                move_in_list(&mut app.detail_pipes.job_state, job_len, 1)
            }
            KeyCode::Char('k') | KeyCode::Up => {
                move_in_list(&mut app.detail_pipes.job_state, job_len, -1)
            }
            KeyCode::Esc => {
                app.detail_pipes.jobs = None;
            }
            KeyCode::Char('o') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    let _ = crate::util::open_url(&j.web_url);
                }
            }
            KeyCode::Char('p') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    let job_id = j.id;
                    spawn_action(app, "play", move |pool, inst| async move {
                        ultra_gitlab_lib::core::pipelines::play_job(&pool, inst, project_id, job_id)
                            .await
                            .map(|_| "job started".to_string())
                            .map_err(|e| e.to_string())
                    });
                }
            }
            KeyCode::Char('R') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    let job_id = j.id;
                    spawn_action(app, "retry", move |pool, inst| async move {
                        ultra_gitlab_lib::core::pipelines::retry_job(&pool, inst, project_id, job_id)
                            .await
                            .map(|_| "job retried".to_string())
                            .map_err(|e| e.to_string())
                    });
                }
            }
            KeyCode::Char('c') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    app.pipelines.confirm = Some(PipeConfirm {
                        action: PipeAction::CancelJob {
                            project_id,
                            job_id: j.id,
                        },
                        prompt: format!("Cancel job {}? (y/N)", j.name),
                    });
                    app.status = "Cancel job? Press y to confirm.".into();
                }
            }
            _ => {}
        }
        return;
    }

    // Pipeline list mode.
    let len = app.detail_pipes.pipelines.len();
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.detail_pipes.pipe_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.detail_pipes.pipe_state, len, -1),
        KeyCode::Char('o') => {
            if let Some(p) = app.detail_pipes.selected_pipe() {
                let _ = crate::util::open_url(&p.web_url);
            }
        }
        KeyCode::Enter => {
            if let Some(p) = app.detail_pipes.selected_pipe() {
                let (pid, plid) = (p.project_id, p.id);
                app.detail_pipes.jobs = Some(Vec::new());
                app.detail_pipes.job_state = ListState::default();
                app.status = "Loading jobs…".into();
                spawn_detail_jobs(app, pid, plid);
            }
        }
        _ => {}
    }
}
```

Note: the pipeline cancel confirm reuses `app.pipelines.confirm` and the interception added in Task 8 Step 3 — but that interception is guarded by `app.tab == Tab::Pipelines`. The MR-detail panel runs under Review/Mine tabs, so add a second interception. In `src-tauri/cli/src/app.rs` `handle_key`, broaden the pipeline-confirm interception to also fire on the detail screen. Change the guard from:

```rust
    if app.tab == Tab::Pipelines {
        if let Some(c) = app.pipelines.confirm.clone() {
```

to:

```rust
    if app.tab == Tab::Pipelines || app.screen == Screen::Detail {
        if let Some(c) = app.pipelines.confirm.clone() {
```

- [ ] **Step 3: Verify compile**

Run: `cargo check --manifest-path src-tauri/cli/Cargo.toml`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/app.rs src-tauri/cli/src/pipelines.rs
git commit -m "feat(cli): MR-detail pipelines panel focus and key handling"
```

---

### Task 13: Render the MR-detail pipelines panel

**Files:**
- Modify: `src-tauri/cli/src/ui/detail.rs`

- [ ] **Step 1: Split the left column and render the panel**

In `src-tauri/cli/src/ui/detail.rs`, change `render` so the left pane stacks Files over Pipelines. Replace the `panes` split and the two render calls:

```rust
    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
        .split(rows[1]);

    render_tree(f, app, &detail, panes[0]);
    render_diff(f, app, &detail, panes[1]);
}
```

with:

```rust
    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
        .split(rows[1]);

    let left = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(panes[0]);

    render_tree(f, app, &detail, left[0]);
    render_pipelines_panel(f, app, left[1]);
    render_diff(f, app, &detail, panes[1]);
}
```

- [ ] **Step 2: Add the panel renderer**

Add to `src-tauri/cli/src/ui/detail.rs` (the imports `App`, `Focus` are already in scope; add `use crate::ui::status_style;` at the top):

```rust
fn render_pipelines_panel(f: &mut Frame, app: &mut App, area: Rect) {
    let focused = app.focus == Focus::Pipeline;
    let glyph = |status: Option<&str>| {
        let (sym, color) = status_style(status);
        Span::styled(sym, Style::default().fg(color))
    };

    // Inline jobs mode.
    if let Some(jobs) = app.detail_pipes.jobs.clone() {
        let block = Block::default()
            .borders(Borders::ALL)
            .title(" Pipeline jobs · esc back ")
            .border_style(border_style(focused));
        if jobs.is_empty() {
            f.render_widget(Paragraph::new("Loading…").block(block), area);
            return;
        }
        let items: Vec<ListItem> = jobs
            .iter()
            .map(|j| {
                ListItem::new(Line::from(vec![
                    glyph(Some(j.status.as_str())),
                    Span::raw(" "),
                    Span::styled(format!("{:<8}", j.stage), Style::default().fg(Color::DarkGray)),
                    Span::raw(" "),
                    Span::raw(j.name.clone()),
                ]))
            })
            .collect();
        let list = List::new(items)
            .block(block)
            .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
            .highlight_symbol("▌");
        f.render_stateful_widget(list, area, &mut app.detail_pipes.job_state);
        return;
    }

    // Pipeline list mode.
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Pipelines · enter jobs ")
        .border_style(border_style(focused));
    if app.detail_pipes.pipelines.is_empty() {
        f.render_widget(Paragraph::new("No pipelines").block(block), area);
        return;
    }
    let items: Vec<ListItem> = app
        .detail_pipes
        .pipelines
        .iter()
        .map(|p| {
            ListItem::new(Line::from(vec![
                glyph(Some(p.status.as_str())),
                Span::raw(" "),
                Span::styled(format!("#{}", p.id), Style::default().fg(Color::Cyan)),
                Span::raw("  "),
                Span::styled(p.status.clone(), Style::default().fg(Color::DarkGray)),
            ]))
        })
        .collect();
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.detail_pipes.pipe_state);
}
```

- [ ] **Step 3: Verify compile + manual check**

Run: `cargo check --manifest-path src-tauri/cli/Cargo.toml`
Expected: clean.

Manual: `cargo run --manifest-path src-tauri/cli/Cargo.toml` → open an MR (`1`/`2` tab, `enter`), press `Tab` twice to focus the Pipelines panel, `j/k` to move, `enter` to view jobs inline, `p`/`R`/`c` on a job, `esc` back, `o` browser.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/ui/detail.rs
git commit -m "feat(cli): render MR-detail pipelines panel with inline jobs"
```

---

### Task 14: Final integration pass

**Files:**
- No new code; verification + any cleanup.

- [ ] **Step 1: Full build + tests + lint (Rust)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

Run: `cargo test --manifest-path src-tauri/cli/Cargo.toml`
Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/cli/Cargo.toml --all-targets`
Expected: no errors (address obvious warnings introduced by this work).

- [ ] **Step 2: Confirm desktop commands still compile and behave**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean. (The desktop React pipelines feature is unchanged because the command DTOs/names/signatures are identical.)

- [ ] **Step 3: End-to-end manual smoke test (real credentials)**

With the desktop DB signed in (CLAUDE.md test credentials), run `cargo run --manifest-path src-tauri/cli/Cargo.toml` and verify the full flow:
- `3` → Pipelines tab; projects load with status dots.
- `n` → search, add a project; `p` pin; `x` remove.
- `enter` → pipelines for a project; `enter` → jobs; `p`/`R`/`c` job actions; `c` on a pipeline cancels (y/N).
- A running pipeline updates within ~10s without input (auto-refresh).
- `1`/`2` → open an MR; `Tab` to the Pipelines panel; drill jobs inline; actions work.

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A
git commit -m "chore(cli): pipelines integration cleanup"
```

---

## Self-Review notes

- **Spec coverage:** Section 1 → Tasks 1–3. Section 2 (tab, full pin management, drill, actions, auto-refresh, search, footer, shared glyph, open_url) → Tasks 4–10. Section 3 (third focusable panel, inline jobs, actions, reset-per-MR) → Tasks 11–13. Final verification → Task 14.
- **Ordering caveat called out:** `App` field init (Task 7) references `DetailPipelines` (Task 11) and spawn helpers (Task 8); each such forward reference is flagged inline with how to keep the in-progress task compiling. Subagent-driven execution should follow task order; the `cargo check` gate that must pass standalone is at the end of Task 8 (Pipelines tab) and Task 12 (detail panel).
- **Type consistency:** row types (`PipeProjectRow`, `PipeRow`, `JobRow`, `ProjectHit`, `PipeStatus`) defined once in `data.rs` (Task 4) and used everywhere; event variants defined once (Task 7) and matched in `app.rs`; `status_style` defined once (Task 5) and reused by list/pipelines/detail.
- **Out of scope (per spec):** job trace viewing, CLI reorder UI, multi-instance views, desktop UI changes.
</content>
