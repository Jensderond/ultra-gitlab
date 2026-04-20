//! CRUD helpers for the `issue_notes` cache.

use crate::db::pool::DbPool;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A cached GitLab issue note (comment).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IssueNoteRow {
    pub id: i64,
    pub instance_id: i64,
    pub project_id: i64,
    pub issue_iid: i64,
    pub body: String,
    pub author_username: String,
    pub author_name: String,
    pub author_avatar_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub system: bool,
    pub cached_at: i64,
}

/// Fields accepted by `upsert_issue_note`.
#[derive(Debug, Clone)]
pub struct UpsertIssueNote {
    pub id: i64,
    pub instance_id: i64,
    pub project_id: i64,
    pub issue_iid: i64,
    pub body: String,
    pub author_username: String,
    pub author_name: String,
    pub author_avatar_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub system: bool,
}

/// Insert or update a cached note. Uses (id, instance_id) as the natural key.
pub async fn upsert_issue_note(pool: &DbPool, note: &UpsertIssueNote) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        r#"
        INSERT INTO issue_notes (
            id, instance_id, project_id, issue_iid, body,
            author_username, author_name, author_avatar_url,
            created_at, updated_at, system, cached_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, instance_id) DO UPDATE SET
            body = excluded.body,
            author_username = excluded.author_username,
            author_name = excluded.author_name,
            author_avatar_url = excluded.author_avatar_url,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            system = excluded.system,
            cached_at = excluded.cached_at
        "#,
    )
    .bind(note.id)
    .bind(note.instance_id)
    .bind(note.project_id)
    .bind(note.issue_iid)
    .bind(&note.body)
    .bind(&note.author_username)
    .bind(&note.author_name)
    .bind(&note.author_avatar_url)
    .bind(note.created_at)
    .bind(note.updated_at)
    .bind(note.system as i64)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// List cached notes for an issue, oldest first.
pub async fn list_cached_notes(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
) -> Result<Vec<IssueNoteRow>, AppError> {
    let rows = sqlx::query_as::<_, IssueNoteRow>(
        r#"
        SELECT id, instance_id, project_id, issue_iid, body,
               author_username, author_name, author_avatar_url,
               created_at, updated_at, system, cached_at
        FROM issue_notes
        WHERE instance_id = ? AND project_id = ? AND issue_iid = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(issue_iid)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Delete cached notes for an issue whose GitLab ids are NOT in `keep_ids`.
/// Called after a refresh so notes deleted on GitLab disappear locally.
pub async fn prune_missing_notes(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
    keep_ids: &[i64],
) -> Result<(), AppError> {
    // Build `(?, ?, ...)` placeholder list; empty list means delete ALL for the issue.
    if keep_ids.is_empty() {
        sqlx::query(
            "DELETE FROM issue_notes
             WHERE instance_id = ? AND project_id = ? AND issue_iid = ?",
        )
        .bind(instance_id)
        .bind(project_id)
        .bind(issue_iid)
        .execute(pool)
        .await?;
        return Ok(());
    }

    let placeholders = vec!["?"; keep_ids.len()].join(",");
    let sql = format!(
        "DELETE FROM issue_notes
         WHERE instance_id = ? AND project_id = ? AND issue_iid = ?
           AND id NOT IN ({})",
        placeholders
    );
    let mut q = sqlx::query(&sql)
        .bind(instance_id)
        .bind(project_id)
        .bind(issue_iid);
    for id in keep_ids {
        q = q.bind(*id);
    }
    q.execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    async fn setup_test_db() -> sqlx::SqlitePool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = db::initialize(&db_path).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (url, name) VALUES ('https://gitlab.com', 'GitLab')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn sample_note(id: i64) -> UpsertIssueNote {
        UpsertIssueNote {
            id,
            instance_id: 1,
            project_id: 10,
            issue_iid: 5,
            body: format!("note body {}", id),
            author_username: "alice".to_string(),
            author_name: "Alice".to_string(),
            author_avatar_url: None,
            created_at: 1_700_000_000 + id,
            updated_at: 1_700_000_000 + id,
            system: false,
        }
    }

    #[tokio::test]
    async fn test_upsert_and_list_notes_ordered_by_created_at() {
        let pool = setup_test_db().await;
        upsert_issue_note(&pool, &sample_note(3)).await.unwrap();
        upsert_issue_note(&pool, &sample_note(1)).await.unwrap();
        upsert_issue_note(&pool, &sample_note(2)).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].id, 1);
        assert_eq!(rows[1].id, 2);
        assert_eq!(rows[2].id, 3);
    }

    #[tokio::test]
    async fn test_upsert_updates_existing_body() {
        let pool = setup_test_db().await;
        let mut note = sample_note(1);
        upsert_issue_note(&pool, &note).await.unwrap();

        note.body = "edited".to_string();
        upsert_issue_note(&pool, &note).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].body, "edited");
    }

    #[tokio::test]
    async fn test_prune_missing_notes_keeps_listed_ids() {
        let pool = setup_test_db().await;
        for id in [1, 2, 3] {
            upsert_issue_note(&pool, &sample_note(id)).await.unwrap();
        }

        prune_missing_notes(&pool, 1, 10, 5, &[2]).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 2);
    }

    #[tokio::test]
    async fn test_prune_with_empty_keep_list_clears_issue() {
        let pool = setup_test_db().await;
        upsert_issue_note(&pool, &sample_note(1)).await.unwrap();

        prune_missing_notes(&pool, 1, 10, 5, &[]).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn test_notes_for_other_issues_not_returned() {
        let pool = setup_test_db().await;
        upsert_issue_note(&pool, &sample_note(1)).await.unwrap();

        let mut other = sample_note(2);
        other.issue_iid = 99;
        upsert_issue_note(&pool, &other).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 1);
    }
}
