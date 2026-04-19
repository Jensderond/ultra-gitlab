//! GitLab issues commands.
//!
//! Covers: syncing issues assigned to the user and for individual projects,
//! listing cached issues with filtering, starring issues, starring projects,
//! and renaming projects (with the original name retained for tooltips).

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::issue::{self, Issue, UpsertIssue};
use crate::models::project::{self, Project};
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig, GitLabIssue, IssuesQuery};
use chrono::DateTime;
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;

/// Filter arguments accepted by `list_cached_issues`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueFilter {
    /// Filter on a single project.
    pub project_id: Option<i64>,

    /// Only issues whose `assigned_to_me` flag is set.
    pub only_assigned_to_me: Option<bool>,

    /// Only starred issues.
    pub only_starred: Option<bool>,
}

/// Rich issue row returned to the frontend — joins in project metadata so
/// the UI can render "name · namespace" and fall back to the custom name.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueWithProject {
    #[serde(flatten)]
    pub issue: Issue,

    pub project_name: Option<String>,
    pub project_name_with_namespace: Option<String>,
    pub project_path_with_namespace: Option<String>,
    pub project_custom_name: Option<String>,
    pub project_starred: bool,
}

/// Parse an ISO 8601 timestamp to Unix seconds. Falls back to `now` if parsing fails.
fn parse_ts(s: &str) -> i64 {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp())
        .unwrap_or_else(|_| chrono::Utc::now().timestamp())
}

fn parse_opt_ts(s: Option<&String>) -> Option<i64> {
    s.and_then(|raw| DateTime::parse_from_rfc3339(raw).ok().map(|d| d.timestamp()))
}

fn to_upsert(issue: GitLabIssue, instance_id: i64, assigned_to_me: bool) -> UpsertIssue {
    let assignees = issue
        .assignees
        .unwrap_or_default()
        .into_iter()
        .map(|u| u.username)
        .collect();

    UpsertIssue {
        id: issue.id,
        instance_id,
        iid: issue.iid,
        project_id: issue.project_id,
        title: issue.title,
        description: issue.description,
        state: issue.state,
        web_url: issue.web_url,
        author_username: issue.author.username,
        assignee_usernames: assignees,
        labels: issue.labels,
        created_at: parse_ts(&issue.created_at),
        updated_at: parse_ts(&issue.updated_at),
        closed_at: parse_opt_ts(issue.closed_at.as_ref()),
        due_date: issue.due_date,
        confidential: issue.confidential.unwrap_or(false),
        user_notes_count: issue.user_notes_count.unwrap_or(0),
        assigned_to_me,
    }
}

/// Make sure the `projects` cache knows about every referenced project.
/// Missing projects are fetched in parallel and inserted with default
/// star / custom_name values.
async fn ensure_projects_cached(
    client: &GitLabClient,
    pool: &sqlx::SqlitePool,
    instance_id: i64,
    project_ids: &[i64],
) -> Result<(), AppError> {
    let missing = project::get_missing_project_ids(pool, instance_id, project_ids).await?;
    if missing.is_empty() {
        return Ok(());
    }

    let futures = missing.into_iter().map(|pid| {
        let client = client.clone();
        async move { (pid, client.get_project(pid).await) }
    });

    for (pid, res) in join_all(futures).await {
        match res {
            Ok(gp) => {
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
            }
            Err(e) => log::warn!("Failed to fetch project {}: {}", pid, e),
        }
    }

    Ok(())
}

/// Refresh issues assigned to the authenticated user across all projects.
#[tauri::command]
pub async fn sync_my_issues(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<i64, AppError> {
    let (client, username) = create_client_with_username(&pool, instance_id).await?;

    let query = IssuesQuery {
        state: Some("opened".to_string()),
        scope: Some("assigned_to_me".to_string()),
        assignee_username: Some(username),
        per_page: Some(100),
        ..Default::default()
    };

    let issues = client.list_issues(&query).await?;

    let project_ids: Vec<i64> = {
        let set: HashSet<i64> = issues.iter().map(|i| i.project_id).collect();
        set.into_iter().collect()
    };
    ensure_projects_cached(&client, pool.inner(), instance_id, &project_ids).await?;

    let count = issues.len() as i64;
    for gi in issues {
        let upsert = to_upsert(gi, instance_id, true);
        issue::upsert_issue(pool.inner(), &upsert).await?;
    }

    Ok(count)
}

/// Refresh issues for a specific project.
#[tauri::command]
pub async fn sync_project_issues(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<i64, AppError> {
    let (client, username) = create_client_with_username(&pool, instance_id).await?;

    // Make sure the project row exists so later joins work.
    ensure_projects_cached(&client, pool.inner(), instance_id, &[project_id]).await?;

    let query = IssuesQuery {
        state: Some("opened".to_string()),
        per_page: Some(100),
        ..Default::default()
    };
    let issues = client.list_project_issues(project_id, &query).await?;

    let count = issues.len() as i64;
    for gi in issues {
        let assignees: Vec<String> = gi
            .assignees
            .as_ref()
            .map(|a| a.iter().map(|u| u.username.clone()).collect())
            .unwrap_or_default();
        let assigned_to_me = assignees.iter().any(|u| u == &username);
        let upsert = to_upsert(gi, instance_id, assigned_to_me);
        issue::upsert_issue(pool.inner(), &upsert).await?;
    }

    Ok(count)
}

/// List cached issues joined with project metadata.
#[tauri::command]
pub async fn list_cached_issues(
    pool: State<'_, DbPool>,
    instance_id: i64,
    filter: Option<IssueFilter>,
) -> Result<Vec<IssueWithProject>, AppError> {
    let filter = filter.unwrap_or_default();
    let rows = issue::list_issues(
        pool.inner(),
        instance_id,
        filter.project_id,
        filter.only_assigned_to_me.unwrap_or(false),
        filter.only_starred.unwrap_or(false),
    )
    .await?;

    // Batch-load the relevant projects to avoid N+1.
    let project_ids: Vec<i64> = {
        let set: HashSet<i64> = rows.iter().map(|i| i.project_id).collect();
        set.into_iter().collect()
    };

    let mut projects: std::collections::HashMap<i64, Project> =
        std::collections::HashMap::with_capacity(project_ids.len());
    for pid in project_ids {
        if let Some(p) = project::get_project(pool.inner(), instance_id, pid).await? {
            projects.insert(pid, p);
        }
    }

    Ok(rows
        .into_iter()
        .map(|i| {
            let project = projects.get(&i.project_id);
            IssueWithProject {
                project_name: project.map(|p| p.name.clone()),
                project_name_with_namespace: project.map(|p| p.name_with_namespace.clone()),
                project_path_with_namespace: project.map(|p| p.path_with_namespace.clone()),
                project_custom_name: project.and_then(|p| p.custom_name.clone()),
                project_starred: project.map(|p| p.starred).unwrap_or(false),
                issue: i,
            }
        })
        .collect())
}

/// Toggle the starred flag on an issue. Returns the new value.
#[tauri::command]
pub async fn toggle_issue_star(
    pool: State<'_, DbPool>,
    instance_id: i64,
    issue_id: i64,
) -> Result<bool, AppError> {
    let starred = issue::toggle_issue_star(pool.inner(), instance_id, issue_id).await?;
    Ok(starred)
}

/// Toggle the starred flag on a project. Returns the new value.
#[tauri::command]
pub async fn toggle_project_star(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
) -> Result<bool, AppError> {
    let starred = project::toggle_project_star(pool.inner(), instance_id, project_id).await?;
    Ok(starred)
}

/// List projects that the user has interacted with for the Issues dashboard
/// header. Includes starred projects and any project that has cached issues,
/// so the UI can show counts and renamed titles up front.
#[tauri::command]
pub async fn list_issue_projects(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Vec<Project>, AppError> {
    let projects: Vec<Project> = sqlx::query_as(
        r#"
        SELECT p.id, p.instance_id, p.name, p.name_with_namespace, p.path_with_namespace,
               p.web_url, p.created_at, p.updated_at, p.starred, p.custom_name
        FROM projects p
        WHERE p.instance_id = ? AND (
            p.starred = 1
            OR EXISTS (SELECT 1 FROM issues i WHERE i.project_id = p.id AND i.instance_id = p.instance_id)
        )
        ORDER BY p.starred DESC,
                 COALESCE(NULLIF(p.custom_name, ''), p.name_with_namespace) ASC
        "#,
    )
    .bind(instance_id)
    .fetch_all(pool.inner())
    .await?;

    Ok(projects)
}

/// Set (or clear) a user-chosen display name for a project. Empty / whitespace
/// clears the custom name.
#[tauri::command]
pub async fn rename_project(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    custom_name: Option<String>,
) -> Result<(), AppError> {
    project::set_project_custom_name(pool.inner(), instance_id, project_id, custom_name).await?;
    Ok(())
}

/// Load both the client and the authenticated username for an instance.
async fn create_client_with_username(
    pool: &State<'_, DbPool>,
    instance_id: i64,
) -> Result<(GitLabClient, String), AppError> {
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
        .clone()
        .ok_or_else(|| AppError::authentication("No token configured for GitLab instance"))?;

    let client = GitLabClient::new(GitLabClientConfig {
        base_url: instance.url.clone(),
        token,
        timeout_secs: 30,
    })?;

    // Ensure we know the username (for matching assignees). If we haven't
    // cached one yet, fetch it now.
    let username = match instance.authenticated_username.clone() {
        Some(u) => u,
        None => {
            let user = client.validate_token().await?;
            user.username
        }
    };

    Ok((client, username))
}
