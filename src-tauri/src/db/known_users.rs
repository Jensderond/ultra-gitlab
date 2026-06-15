//! Read-only helper for assembling the list of GitLab users we have cached
//! locally, used to power @mention autocomplete in the issue comment composer.
//!
//! User identity is fragmented across cached tables. Only `issue_notes` stores
//! username + display name together; `user_avatars` stores the username (and an
//! avatar blob) but no name. We union both, dedupe by username, and prefer a
//! row that carries a name. Avatars are not returned here — the frontend
//! `UserAvatar` component resolves those from the cached blob by username.

use crate::db::pool::DbPool;
use crate::error::AppError;
use sqlx::FromRow;

/// A user we have seen before, suitable as a mention candidate.
#[derive(Debug, Clone, FromRow)]
pub struct KnownUserRow {
    pub username: String,
    /// Display name when we have ever cached one for this username, else `None`.
    pub name: Option<String>,
}

/// List distinct cached usernames for an instance, alphabetically.
///
/// `MAX(name)` collapses duplicate usernames to a single row, keeping a
/// non-null display name when any source had one (NULLs are ignored by `MAX`).
pub async fn list_known_users(
    pool: &DbPool,
    instance_id: i64,
) -> Result<Vec<KnownUserRow>, AppError> {
    let rows = sqlx::query_as::<_, KnownUserRow>(
        r#"
        SELECT username, MAX(name) AS name
        FROM (
            SELECT username, NULL AS name
            FROM user_avatars
            WHERE instance_id = ?
            UNION ALL
            SELECT author_username AS username, author_name AS name
            FROM issue_notes
            WHERE instance_id = ? AND system = 0
        )
        GROUP BY username
        ORDER BY username COLLATE NOCASE
        "#,
    )
    .bind(instance_id)
    .bind(instance_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    async fn setup_test_db() -> DbPool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = db::initialize(&db_path).await.unwrap();
        sqlx::query("INSERT INTO gitlab_instances (url, name) VALUES ('https://gitlab.com', 'GitLab')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn insert_avatar(pool: &DbPool, username: &str) {
        sqlx::query("INSERT INTO user_avatars (instance_id, username) VALUES (1, ?)")
            .bind(username)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn insert_note(pool: &DbPool, id: i64, username: &str, name: &str, system: bool) {
        sqlx::query(
            r#"INSERT INTO issue_notes
               (id, instance_id, project_id, issue_iid, body, author_username,
                author_name, created_at, updated_at, system, cached_at)
               VALUES (?, 1, 10, 5, 'b', ?, ?, 0, 0, ?, 0)"#,
        )
        .bind(id)
        .bind(username)
        .bind(name)
        .bind(system as i64)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn dedups_and_prefers_a_known_name() {
        let pool = setup_test_db().await;
        // Same username appears in both tables; only issue_notes carries a name.
        insert_avatar(&pool, "alice").await;
        insert_note(&pool, 1, "alice", "Alice Liddell", false).await;

        let rows = list_known_users(&pool, 1).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].username, "alice");
        assert_eq!(rows[0].name.as_deref(), Some("Alice Liddell"));
    }

    #[tokio::test]
    async fn avatar_only_user_has_no_name() {
        let pool = setup_test_db().await;
        insert_avatar(&pool, "bob").await;

        let rows = list_known_users(&pool, 1).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].username, "bob");
        assert_eq!(rows[0].name, None);
    }

    #[tokio::test]
    async fn excludes_system_note_authors_and_sorts() {
        let pool = setup_test_db().await;
        insert_note(&pool, 1, "zoe", "Zoe", false).await;
        insert_note(&pool, 2, "amy", "Amy", false).await;
        insert_note(&pool, 3, "system-bot", "GitLab", true).await;

        let rows = list_known_users(&pool, 1).await.unwrap();
        let names: Vec<&str> = rows.iter().map(|r| r.username.as_str()).collect();
        assert_eq!(names, vec!["amy", "zoe"]);
    }
}
