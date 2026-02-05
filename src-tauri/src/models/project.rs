//! GitLab project metadata model.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Cached GitLab project metadata.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// GitLab project ID.
    pub id: i64,

    /// Local instance ID (FK to gitlab_instances).
    pub instance_id: i64,

    /// Short project name (e.g., "GitLab").
    pub name: String,

    /// Full namespaced name (e.g., "GitLab.org / GitLab").
    pub name_with_namespace: String,

    /// Path with namespace (e.g., "gitlab-org/gitlab").
    pub path_with_namespace: String,

    /// Web URL for the project.
    pub web_url: String,

    /// ISO 8601 creation timestamp from GitLab.
    pub created_at: Option<String>,

    /// ISO 8601 update timestamp from GitLab.
    pub updated_at: Option<String>,
}

/// Look up a project by (instance_id, project_id).
pub async fn get_project(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
    project_id: i64,
) -> Result<Option<Project>, sqlx::Error> {
    sqlx::query_as::<_, Project>(
        "SELECT id, instance_id, name, name_with_namespace, path_with_namespace, web_url, created_at, updated_at
         FROM projects WHERE instance_id = ? AND id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
}

/// Upsert a project (insert or update on conflict).
pub async fn upsert_project(
    pool: &sqlx::SqlitePool,
    project: &Project,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO projects (id, instance_id, name, name_with_namespace, path_with_namespace, web_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id, instance_id) DO UPDATE SET
           name = excluded.name,
           name_with_namespace = excluded.name_with_namespace,
           path_with_namespace = excluded.path_with_namespace,
           web_url = excluded.web_url,
           updated_at = excluded.updated_at",
    )
    .bind(project.id)
    .bind(project.instance_id)
    .bind(&project.name)
    .bind(&project.name_with_namespace)
    .bind(&project.path_with_namespace)
    .bind(&project.web_url)
    .bind(&project.created_at)
    .bind(&project.updated_at)
    .execute(pool)
    .await?;

    Ok(())
}

/// Check which project IDs from a list are NOT yet cached for a given instance.
pub async fn get_missing_project_ids(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
    project_ids: &[i64],
) -> Result<Vec<i64>, sqlx::Error> {
    if project_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Get IDs that ARE cached
    let placeholders: String = project_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "SELECT id FROM projects WHERE instance_id = ? AND id IN ({})",
        placeholders
    );

    let mut q = sqlx::query_as::<_, (i64,)>(&query).bind(instance_id);
    for id in project_ids {
        q = q.bind(*id);
    }

    let cached: Vec<(i64,)> = q.fetch_all(pool).await?;
    let cached_set: std::collections::HashSet<i64> = cached.into_iter().map(|(id,)| id).collect();

    Ok(project_ids
        .iter()
        .filter(|id| !cached_set.contains(id))
        .copied()
        .collect())
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

        // Insert a test instance
        sqlx::query("INSERT INTO gitlab_instances (url, name) VALUES ('https://gitlab.com', 'GitLab')")
            .execute(&pool)
            .await
            .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_upsert_and_get_project() {
        let pool = setup_test_db().await;

        let project = Project {
            id: 42,
            instance_id: 1,
            name: "My Project".to_string(),
            name_with_namespace: "My Group / My Project".to_string(),
            path_with_namespace: "my-group/my-project".to_string(),
            web_url: "https://gitlab.com/my-group/my-project".to_string(),
            created_at: Some("2026-01-01T00:00:00Z".to_string()),
            updated_at: Some("2026-01-02T00:00:00Z".to_string()),
        };

        upsert_project(&pool, &project).await.unwrap();

        let fetched = get_project(&pool, 1, 42).await.unwrap();
        assert!(fetched.is_some());
        let fetched = fetched.unwrap();
        assert_eq!(fetched.name_with_namespace, "My Group / My Project");
    }

    #[tokio::test]
    async fn test_upsert_updates_existing() {
        let pool = setup_test_db().await;

        let mut project = Project {
            id: 42,
            instance_id: 1,
            name: "Old Name".to_string(),
            name_with_namespace: "Group / Old Name".to_string(),
            path_with_namespace: "group/old-name".to_string(),
            web_url: "https://gitlab.com/group/old-name".to_string(),
            created_at: None,
            updated_at: None,
        };

        upsert_project(&pool, &project).await.unwrap();

        project.name = "New Name".to_string();
        project.name_with_namespace = "Group / New Name".to_string();
        upsert_project(&pool, &project).await.unwrap();

        let fetched = get_project(&pool, 1, 42).await.unwrap().unwrap();
        assert_eq!(fetched.name, "New Name");
        assert_eq!(fetched.name_with_namespace, "Group / New Name");
    }

    #[tokio::test]
    async fn test_get_missing_project_ids() {
        let pool = setup_test_db().await;

        let project = Project {
            id: 10,
            instance_id: 1,
            name: "Cached".to_string(),
            name_with_namespace: "Group / Cached".to_string(),
            path_with_namespace: "group/cached".to_string(),
            web_url: "https://gitlab.com/group/cached".to_string(),
            created_at: None,
            updated_at: None,
        };
        upsert_project(&pool, &project).await.unwrap();

        let missing = get_missing_project_ids(&pool, 1, &[10, 20, 30]).await.unwrap();
        assert_eq!(missing, vec![20, 30]);
    }

    #[tokio::test]
    async fn test_get_project_not_found() {
        let pool = setup_test_db().await;
        let result = get_project(&pool, 1, 999).await.unwrap();
        assert!(result.is_none());
    }
}
