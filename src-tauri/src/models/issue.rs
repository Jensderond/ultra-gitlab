//! GitLab issue model and CRUD helpers.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// State of a GitLab issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueState {
    Opened,
    Closed,
}

impl From<&str> for IssueState {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "closed" => Self::Closed,
            _ => Self::Opened,
        }
    }
}

impl std::fmt::Display for IssueState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Opened => write!(f, "opened"),
            Self::Closed => write!(f, "closed"),
        }
    }
}

/// A cached GitLab issue.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// GitLab global issue ID.
    pub id: i64,

    /// Parent GitLab instance ID.
    pub instance_id: i64,

    /// Project-scoped issue number (`#42`).
    pub iid: i64,

    /// GitLab project ID.
    pub project_id: i64,

    /// Issue title.
    pub title: String,

    /// Issue body (Markdown).
    pub description: Option<String>,

    /// Current state: `opened` | `closed`.
    pub state: String,

    /// URL on GitLab web UI.
    pub web_url: String,

    /// Author's username.
    pub author_username: String,

    /// JSON array of assignee usernames.
    pub assignee_usernames: String,

    /// JSON array of label names.
    pub labels: String,

    /// Creation timestamp (Unix seconds).
    pub created_at: i64,

    /// Last-updated timestamp (Unix seconds).
    pub updated_at: i64,

    /// When the issue was closed (Unix seconds), if ever.
    pub closed_at: Option<i64>,

    /// Optional due date (ISO 8601 date).
    pub due_date: Option<String>,

    /// Whether the issue is confidential.
    pub confidential: bool,

    /// User-visible note count.
    pub user_notes_count: i64,

    /// Whether the user has starred this issue (local-only).
    pub starred: bool,

    /// Whether this issue is assigned to the authenticated user
    /// for the instance (snapshot at sync time).
    pub assigned_to_me: bool,

    /// When this row was last written locally (Unix seconds).
    pub cached_at: i64,
}

impl Issue {
    /// Parse the state string into an enum.
    pub fn state_enum(&self) -> IssueState {
        IssueState::from(self.state.as_str())
    }

    /// Parse labels from JSON.
    pub fn labels_vec(&self) -> Vec<String> {
        serde_json::from_str(&self.labels).unwrap_or_default()
    }

    /// Parse assignee usernames from JSON.
    pub fn assignees_vec(&self) -> Vec<String> {
        serde_json::from_str(&self.assignee_usernames).unwrap_or_default()
    }
}

/// Subset of fields accepted when upserting an issue from the GitLab API.
#[derive(Debug, Clone)]
pub struct UpsertIssue {
    pub id: i64,
    pub instance_id: i64,
    pub iid: i64,
    pub project_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub web_url: String,
    pub author_username: String,
    pub assignee_usernames: Vec<String>,
    pub labels: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
    pub due_date: Option<String>,
    pub confidential: bool,
    pub user_notes_count: i64,
    pub assigned_to_me: bool,
}

/// Insert or update an issue, preserving the local `starred` flag.
pub async fn upsert_issue(
    pool: &sqlx::SqlitePool,
    issue: &UpsertIssue,
) -> Result<(), sqlx::Error> {
    let labels_json = serde_json::to_string(&issue.labels).unwrap_or_else(|_| "[]".to_string());
    let assignees_json =
        serde_json::to_string(&issue.assignee_usernames).unwrap_or_else(|_| "[]".to_string());
    let now = chrono::Utc::now().timestamp();

    sqlx::query(
        r#"
        INSERT INTO issues (
            id, instance_id, iid, project_id, title, description, state, web_url,
            author_username, assignee_usernames, labels, created_at, updated_at,
            closed_at, due_date, confidential, user_notes_count, starred,
            assigned_to_me, cached_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id, instance_id) DO UPDATE SET
            iid = excluded.iid,
            project_id = excluded.project_id,
            title = excluded.title,
            description = excluded.description,
            state = excluded.state,
            web_url = excluded.web_url,
            author_username = excluded.author_username,
            assignee_usernames = excluded.assignee_usernames,
            labels = excluded.labels,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            closed_at = excluded.closed_at,
            due_date = excluded.due_date,
            confidential = excluded.confidential,
            user_notes_count = excluded.user_notes_count,
            assigned_to_me = excluded.assigned_to_me,
            cached_at = excluded.cached_at
        "#,
    )
    .bind(issue.id)
    .bind(issue.instance_id)
    .bind(issue.iid)
    .bind(issue.project_id)
    .bind(&issue.title)
    .bind(&issue.description)
    .bind(&issue.state)
    .bind(&issue.web_url)
    .bind(&issue.author_username)
    .bind(&assignees_json)
    .bind(&labels_json)
    .bind(issue.created_at)
    .bind(issue.updated_at)
    .bind(issue.closed_at)
    .bind(&issue.due_date)
    .bind(issue.confidential as i64)
    .bind(issue.user_notes_count)
    .bind(issue.assigned_to_me as i64)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(())
}

/// Toggle the `starred` flag on an issue. Returns the new state.
pub async fn toggle_issue_star(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
    issue_id: i64,
) -> Result<bool, sqlx::Error> {
    sqlx::query(
        "UPDATE issues
         SET starred = CASE WHEN starred = 0 THEN 1 ELSE 0 END
         WHERE instance_id = ? AND id = ?",
    )
    .bind(instance_id)
    .bind(issue_id)
    .execute(pool)
    .await?;

    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT starred FROM issues WHERE instance_id = ? AND id = ?",
    )
    .bind(instance_id)
    .bind(issue_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(s,)| s != 0).unwrap_or(false))
}

/// List issues for an instance, optionally filtered by project.
pub async fn list_issues(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
    project_id: Option<i64>,
    only_assigned_to_me: bool,
    only_starred: bool,
) -> Result<Vec<Issue>, sqlx::Error> {
    let mut sql = String::from(
        "SELECT id, instance_id, iid, project_id, title, description, state, web_url,
                author_username, assignee_usernames, labels, created_at, updated_at,
                closed_at, due_date, confidential, user_notes_count, starred,
                assigned_to_me, cached_at
         FROM issues
         WHERE instance_id = ?",
    );

    if project_id.is_some() {
        sql.push_str(" AND project_id = ?");
    }
    if only_assigned_to_me {
        sql.push_str(" AND assigned_to_me = 1");
    }
    if only_starred {
        sql.push_str(" AND starred = 1");
    }

    sql.push_str(" ORDER BY starred DESC, state = 'opened' DESC, updated_at DESC");

    let mut q = sqlx::query_as::<_, Issue>(&sql).bind(instance_id);
    if let Some(pid) = project_id {
        q = q.bind(pid);
    }
    q.fetch_all(pool).await
}

/// Look up a single cached issue by (instance_id, project_id, iid).
pub async fn get_issue_by_iid(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
    project_id: i64,
    iid: i64,
) -> Result<Option<Issue>, sqlx::Error> {
    sqlx::query_as::<_, Issue>(
        "SELECT id, instance_id, iid, project_id, title, description, state, web_url,
                author_username, assignee_usernames, labels, created_at, updated_at,
                closed_at, due_date, confidential, user_notes_count, starred,
                assigned_to_me, cached_at
         FROM issues
         WHERE instance_id = ? AND project_id = ? AND iid = ?"
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(iid)
    .fetch_optional(pool)
    .await
}
