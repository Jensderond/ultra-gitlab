//! Database queries for the per-instance custom MR filter (issue #28).

use crate::models::CustomMrFilter;

/// Get the custom filter for an instance (None when never configured).
pub async fn get_custom_filter(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
) -> Result<Option<CustomMrFilter>, sqlx::Error> {
    sqlx::query_as::<_, CustomMrFilter>(
        "SELECT instance_id, enabled, draft, author_username, not_author_username, labels, updated_at
         FROM custom_mr_filters WHERE instance_id = ?",
    )
    .bind(instance_id)
    .fetch_optional(pool)
    .await
}

/// Insert or update the custom filter for `filter.instance_id`.
pub async fn upsert_custom_filter(
    pool: &sqlx::SqlitePool,
    filter: &CustomMrFilter,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO custom_mr_filters
            (instance_id, enabled, draft, author_username, not_author_username, labels, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id) DO UPDATE SET
            enabled = excluded.enabled,
            draft = excluded.draft,
            author_username = excluded.author_username,
            not_author_username = excluded.not_author_username,
            labels = excluded.labels,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(filter.instance_id)
    .bind(filter.enabled)
    .bind(&filter.draft)
    .bind(&filter.author_username)
    .bind(&filter.not_author_username)
    .bind(&filter.labels)
    .bind(filter.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Temp DB with one gitlab instance; returns (dir, pool, instance_id).
    async fn pool_with_instance() -> (tempfile::TempDir, crate::db::pool::DbPool, i64) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::initialize(&dir.path().join("t.db")).await.unwrap();
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
        (dir, pool, inst)
    }

    fn sample_filter(instance_id: i64) -> CustomMrFilter {
        CustomMrFilter {
            instance_id,
            enabled: true,
            draft: Some("no".to_string()),
            author_username: None,
            not_author_username: Some("renovate-bot".to_string()),
            labels: Some("magento".to_string()),
            updated_at: 123,
        }
    }

    #[tokio::test]
    async fn get_returns_none_when_never_configured() {
        let (_dir, pool, inst) = pool_with_instance().await;
        let got = get_custom_filter(&pool, inst).await.unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn upsert_then_get_roundtrips() {
        let (_dir, pool, inst) = pool_with_instance().await;
        upsert_custom_filter(&pool, &sample_filter(inst)).await.unwrap();
        let got = get_custom_filter(&pool, inst).await.unwrap().unwrap();
        assert!(got.enabled);
        assert_eq!(got.draft.as_deref(), Some("no"));
        assert_eq!(got.not_author_username.as_deref(), Some("renovate-bot"));
        assert_eq!(got.labels.as_deref(), Some("magento"));
        assert_eq!(got.updated_at, 123);
    }

    #[tokio::test]
    async fn upsert_twice_updates_in_place() {
        let (_dir, pool, inst) = pool_with_instance().await;
        upsert_custom_filter(&pool, &sample_filter(inst)).await.unwrap();
        let mut second = sample_filter(inst);
        second.enabled = false;
        second.labels = None;
        second.updated_at = 456;
        upsert_custom_filter(&pool, &second).await.unwrap();

        let got = get_custom_filter(&pool, inst).await.unwrap().unwrap();
        assert!(!got.enabled);
        assert_eq!(got.labels, None);
        assert_eq!(got.updated_at, 456);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM custom_mr_filters")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "upsert must not create a second row");
    }
}
