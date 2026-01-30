//! Sync queue persistence service.
//!
//! Manages the local queue of actions pending synchronization to GitLab.
//! Actions are stored in SQLite and processed by the sync processor.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::sync_action::{ActionType, SyncAction};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};

/// Payload for an approval action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalPayload {
    pub project_id: i64,
    pub mr_iid: i64,
}

/// Payload for a comment action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentPayload {
    pub project_id: i64,
    pub mr_iid: i64,
    pub body: String,
    /// For inline comments
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line: Option<i64>,
}

/// Payload for a reply action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyPayload {
    pub project_id: i64,
    pub mr_iid: i64,
    pub discussion_id: String,
    pub body: String,
}

/// Payload for resolve/unresolve actions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvePayload {
    pub project_id: i64,
    pub mr_iid: i64,
    pub discussion_id: String,
}

/// Input for enqueuing a new action.
#[derive(Debug, Clone)]
pub struct EnqueueInput {
    pub mr_id: i64,
    pub action_type: ActionType,
    pub payload: String,
    pub local_reference_id: Option<i64>,
}

/// Get the current Unix timestamp.
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Add a new action to the sync queue.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `input` - Action input with type, payload, and optional local reference
///
/// # Returns
/// The created SyncAction with its ID
pub async fn enqueue_action(pool: &DbPool, input: EnqueueInput) -> Result<SyncAction, AppError> {
    let action_type_str = input.action_type.to_string();
    let created_at = now();

    let result = sqlx::query(
        r#"
        INSERT INTO sync_queue (mr_id, action_type, payload, local_reference_id, status, retry_count, created_at)
        VALUES (?, ?, ?, ?, 'pending', 0, ?)
        RETURNING id, mr_id, action_type, payload, local_reference_id, status, retry_count, last_error, created_at, synced_at
        "#,
    )
    .bind(input.mr_id)
    .bind(&action_type_str)
    .bind(&input.payload)
    .bind(input.local_reference_id)
    .bind(created_at)
    .fetch_one(pool)
    .await?;

    Ok(SyncAction {
        id: result.get("id"),
        mr_id: result.get("mr_id"),
        action_type: result.get("action_type"),
        payload: result.get("payload"),
        local_reference_id: result.get("local_reference_id"),
        status: result.get("status"),
        retry_count: result.get("retry_count"),
        last_error: result.get("last_error"),
        created_at: result.get("created_at"),
        synced_at: result.get("synced_at"),
    })
}

/// Get all pending actions from the queue, ordered by creation time.
///
/// # Arguments
/// * `pool` - Database connection pool
///
/// # Returns
/// List of pending actions (status = 'pending')
pub async fn get_pending_actions(pool: &DbPool) -> Result<Vec<SyncAction>, AppError> {
    let actions = sqlx::query_as::<_, SyncAction>(
        r#"
        SELECT id, mr_id, action_type, payload, local_reference_id, status, retry_count, last_error, created_at, synced_at
        FROM sync_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(actions)
}

/// Get all failed actions that can be retried.
///
/// # Arguments
/// * `pool` - Database connection pool
///
/// # Returns
/// List of failed actions with retry_count < MAX_RETRIES
pub async fn get_retryable_actions(pool: &DbPool) -> Result<Vec<SyncAction>, AppError> {
    let actions = sqlx::query_as::<_, SyncAction>(
        r#"
        SELECT id, mr_id, action_type, payload, local_reference_id, status, retry_count, last_error, created_at, synced_at
        FROM sync_queue
        WHERE status = 'failed' AND retry_count < ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(SyncAction::MAX_RETRIES)
    .fetch_all(pool)
    .await?;

    Ok(actions)
}

/// Get all actions for a specific MR.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `mr_id` - Merge request ID
///
/// # Returns
/// List of all actions for the MR
pub async fn get_actions_for_mr(pool: &DbPool, mr_id: i64) -> Result<Vec<SyncAction>, AppError> {
    let actions = sqlx::query_as::<_, SyncAction>(
        r#"
        SELECT id, mr_id, action_type, payload, local_reference_id, status, retry_count, last_error, created_at, synced_at
        FROM sync_queue
        WHERE mr_id = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(mr_id)
    .fetch_all(pool)
    .await?;

    Ok(actions)
}

/// Update action status to 'syncing'.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `action_id` - Action ID to update
pub async fn mark_syncing(pool: &DbPool, action_id: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE sync_queue SET status = 'syncing' WHERE id = ?")
        .bind(action_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Mark action as successfully synced.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `action_id` - Action ID to update
pub async fn mark_synced(pool: &DbPool, action_id: i64) -> Result<(), AppError> {
    let synced_at = now();

    sqlx::query("UPDATE sync_queue SET status = 'synced', synced_at = ? WHERE id = ?")
        .bind(synced_at)
        .bind(action_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Mark action as failed with error message.
///
/// Increments retry count and marks as permanently failed if max retries reached.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `action_id` - Action ID to update
/// * `error` - Error message
pub async fn mark_failed(pool: &DbPool, action_id: i64, error: &str) -> Result<(), AppError> {
    // First get current retry count
    let row = sqlx::query("SELECT retry_count FROM sync_queue WHERE id = ?")
        .bind(action_id)
        .fetch_optional(pool)
        .await?;

    let Some(row) = row else {
        return Err(AppError::not_found_with_id("SyncAction", action_id.to_string()));
    };

    let retry_count: i64 = row.get("retry_count");
    let new_retry_count = retry_count + 1;

    // If max retries reached, mark as permanently failed
    // Otherwise, reset to pending for retry
    let new_status = if new_retry_count >= SyncAction::MAX_RETRIES {
        "failed"
    } else {
        "pending"
    };

    sqlx::query(
        "UPDATE sync_queue SET status = ?, retry_count = ?, last_error = ? WHERE id = ?",
    )
    .bind(new_status)
    .bind(new_retry_count)
    .bind(error)
    .bind(action_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Reset a failed action to pending for retry.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `action_id` - Action ID to retry
pub async fn retry_action(pool: &DbPool, action_id: i64) -> Result<(), AppError> {
    let result = sqlx::query(
        "UPDATE sync_queue SET status = 'pending', last_error = NULL WHERE id = ? AND status = 'failed'",
    )
    .bind(action_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found_with_id("SyncAction", action_id.to_string()));
    }

    Ok(())
}

/// Delete an action from the queue.
///
/// Typically used for discarding failed actions.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `action_id` - Action ID to delete
pub async fn delete_action(pool: &DbPool, action_id: i64) -> Result<(), AppError> {
    let result = sqlx::query("DELETE FROM sync_queue WHERE id = ?")
        .bind(action_id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::not_found_with_id("SyncAction", action_id.to_string()));
    }

    Ok(())
}

/// Mark action as discarded because the MR is no longer actionable.
///
/// This is used when the MR has been merged, closed, or deleted on GitLab
/// while local actions were pending.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `action_id` - Action ID to update
/// * `reason` - Reason for discarding (e.g., "MR was merged", "MR not found")
pub async fn mark_discarded(pool: &DbPool, action_id: i64, reason: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE sync_queue SET status = 'discarded', last_error = ? WHERE id = ?")
        .bind(reason)
        .bind(action_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Get counts of actions by status.
///
/// # Arguments
/// * `pool` - Database connection pool
///
/// # Returns
/// Tuple of (pending_count, failed_count)
pub async fn get_action_counts(pool: &DbPool) -> Result<(i64, i64), AppError> {
    let row = sqlx::query(
        r#"
        SELECT
            COUNT(CASE WHEN status = 'pending' OR status = 'syncing' THEN 1 END) as pending,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
        FROM sync_queue
        "#,
    )
    .fetch_one(pool)
    .await?;

    Ok((row.get("pending"), row.get("failed")))
}

/// Delete all synced actions (cleanup).
///
/// # Arguments
/// * `pool` - Database connection pool
///
/// # Returns
/// Number of deleted actions
pub async fn cleanup_synced(pool: &DbPool) -> Result<u64, AppError> {
    let result = sqlx::query("DELETE FROM sync_queue WHERE status = 'synced'")
        .execute(pool)
        .await?;

    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn setup_test_db() -> DbPool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        // Keep the dir alive by leaking it (for test purposes)
        std::mem::forget(dir);

        let pool = crate::db::initialize(&db_path).await.unwrap();

        // Insert a test gitlab instance and MR for foreign key constraints
        sqlx::query(
            "INSERT INTO gitlab_instances (id, url, name, created_at) VALUES (1, 'https://gitlab.com', 'GitLab', 0)"
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"INSERT INTO merge_requests
            (id, instance_id, iid, project_id, title, author_username, source_branch, target_branch, state, web_url, created_at, updated_at, cached_at)
            VALUES (1, 1, 1, 1, 'Test MR', 'user', 'feature', 'main', 'opened', 'https://gitlab.com/mr/1', 0, 0, 0)"#
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    #[tokio::test]
    async fn test_enqueue_action() {
        let pool = setup_test_db().await;

        let payload = serde_json::to_string(&ApprovalPayload {
            project_id: 1,
            mr_iid: 1,
        })
        .unwrap();

        let action = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Approve,
                payload,
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(action.mr_id, 1);
        assert_eq!(action.action_type, "approve");
        assert_eq!(action.status, "pending");
        assert_eq!(action.retry_count, 0);
    }

    #[tokio::test]
    async fn test_get_pending_actions() {
        let pool = setup_test_db().await;

        // Enqueue two actions
        enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Approve,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Comment,
                payload: "{}".to_string(),
                local_reference_id: Some(100),
            },
        )
        .await
        .unwrap();

        let pending = get_pending_actions(&pool).await.unwrap();
        assert_eq!(pending.len(), 2);
    }

    #[tokio::test]
    async fn test_mark_synced() {
        let pool = setup_test_db().await;

        let action = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Approve,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        mark_syncing(&pool, action.id).await.unwrap();
        mark_synced(&pool, action.id).await.unwrap();

        let pending = get_pending_actions(&pool).await.unwrap();
        assert_eq!(pending.len(), 0);
    }

    #[tokio::test]
    async fn test_mark_failed_with_retry() {
        let pool = setup_test_db().await;

        let action = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Comment,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        // First failure should set back to pending
        mark_failed(&pool, action.id, "Network error").await.unwrap();

        let pending = get_pending_actions(&pool).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].retry_count, 1);
        assert_eq!(pending[0].last_error, Some("Network error".to_string()));
    }

    #[tokio::test]
    async fn test_mark_failed_max_retries() {
        let pool = setup_test_db().await;

        let action = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Comment,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        // Fail MAX_RETRIES times
        for i in 0..SyncAction::MAX_RETRIES {
            mark_failed(&pool, action.id, &format!("Error {}", i)).await.unwrap();
        }

        // Should now be permanently failed
        let pending = get_pending_actions(&pool).await.unwrap();
        assert_eq!(pending.len(), 0);

        let failed = get_retryable_actions(&pool).await.unwrap();
        assert_eq!(failed.len(), 0); // Not retryable anymore
    }

    #[tokio::test]
    async fn test_action_counts() {
        let pool = setup_test_db().await;

        // Enqueue some actions
        let action1 = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Approve,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Comment,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        // Mark one as failed (permanently)
        for _ in 0..SyncAction::MAX_RETRIES {
            mark_failed(&pool, action1.id, "Error").await.unwrap();
        }

        let (pending, failed) = get_action_counts(&pool).await.unwrap();
        assert_eq!(pending, 1);
        assert_eq!(failed, 1);
    }

    #[tokio::test]
    async fn test_delete_action() {
        let pool = setup_test_db().await;

        let action = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Resolve,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        delete_action(&pool, action.id).await.unwrap();

        let pending = get_pending_actions(&pool).await.unwrap();
        assert_eq!(pending.len(), 0);
    }

    #[tokio::test]
    async fn test_retry_action() {
        let pool = setup_test_db().await;

        let action = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Comment,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        // Fail it permanently
        for _ in 0..SyncAction::MAX_RETRIES {
            mark_failed(&pool, action.id, "Error").await.unwrap();
        }

        // Retry it
        retry_action(&pool, action.id).await.unwrap();

        let pending = get_pending_actions(&pool).await.unwrap();
        assert_eq!(pending.len(), 1);
    }

    #[tokio::test]
    async fn test_mark_discarded() {
        let pool = setup_test_db().await;

        let action = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Approve,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        // Discard the action
        mark_discarded(&pool, action.id, "MR was merged").await.unwrap();

        // Should not appear in pending actions
        let pending = get_pending_actions(&pool).await.unwrap();
        assert_eq!(pending.len(), 0);

        // Should not appear in retryable actions
        let retryable = get_retryable_actions(&pool).await.unwrap();
        assert_eq!(retryable.len(), 0);

        // Should have the correct status and error message in the database
        let row = sqlx::query("SELECT status, last_error FROM sync_queue WHERE id = ?")
            .bind(action.id)
            .fetch_one(&pool)
            .await
            .unwrap();

        let status: String = row.get("status");
        let last_error: String = row.get("last_error");

        assert_eq!(status, "discarded");
        assert_eq!(last_error, "MR was merged");
    }

    #[tokio::test]
    async fn test_action_counts_excludes_discarded() {
        let pool = setup_test_db().await;

        // Create one pending and one discarded action
        let action1 = enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Comment,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        enqueue_action(
            &pool,
            EnqueueInput {
                mr_id: 1,
                action_type: ActionType::Approve,
                payload: "{}".to_string(),
                local_reference_id: None,
            },
        )
        .await
        .unwrap();

        // Discard the first action
        mark_discarded(&pool, action1.id, "MR was closed").await.unwrap();

        // Only the pending action should be counted
        let (pending, failed) = get_action_counts(&pool).await.unwrap();
        assert_eq!(pending, 1);
        assert_eq!(failed, 0);
    }
}
