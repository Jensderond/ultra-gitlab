//! Approval commands for approving/unapproving merge requests.
//!
//! These commands provide optimistic updates for MR approval status
//! and queue actions for synchronization to GitLab.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::sync_action::ActionType;
use crate::services::sync_engine::SyncHandle;
use crate::services::sync_queue::{self, ApprovalPayload, EnqueueInput};
use sqlx::Row;
use tauri::State;

/// Look up project_id and iid for a merge request.
async fn get_mr_ids(pool: &DbPool, mr_id: i64) -> Result<(i64, i64), AppError> {
    let row = sqlx::query("SELECT project_id, iid FROM merge_requests WHERE id = ?")
        .bind(mr_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;

    Ok((row.get("project_id"), row.get("iid")))
}

/// Approve a merge request.
///
/// The approval is applied optimistically to the local database
/// and queued for synchronization to GitLab.
///
/// # Arguments
/// * `mr_id` - Merge request ID (local database ID)
///
/// # Returns
/// Success or error
#[tauri::command]
pub async fn approve_mr(
    pool: State<'_, DbPool>,
    sync_handle: State<'_, SyncHandle>,
    mr_id: i64,
) -> Result<(), AppError> {
    let (project_id, mr_iid) = get_mr_ids(pool.inner(), mr_id).await?;

    // Update approval status optimistically
    // Increment approvals_count, update approval_status, and mark user as having approved
    sqlx::query(
        r#"
        UPDATE merge_requests
        SET approvals_count = COALESCE(approvals_count, 0) + 1,
            approval_status = CASE
                WHEN COALESCE(approvals_count, 0) + 1 >= COALESCE(approvals_required, 1)
                THEN 'approved'
                ELSE 'pending'
            END,
            user_has_approved = 1
        WHERE id = ?
        "#,
    )
    .bind(mr_id)
    .execute(pool.inner())
    .await?;

    // Build payload for sync queue
    let payload = serde_json::to_string(&ApprovalPayload {
        project_id,
        mr_iid,
    })?;

    // Queue for sync
    sync_queue::enqueue_action(
        pool.inner(),
        EnqueueInput {
            mr_id,
            action_type: ActionType::Approve,
            payload,
            local_reference_id: None,
        },
    )
    .await?;

    // Fire-and-forget: flush approval actions immediately
    if let Err(e) = sync_handle.flush_approvals().await {
        eprintln!("[approval] Failed to send flush signal: {}", e);
    }

    Ok(())
}

/// Unapprove a merge request (remove your approval).
///
/// The unapproval is applied optimistically to the local database
/// and queued for synchronization to GitLab.
///
/// Note: GitLab API for unapprove uses POST to /unapprove endpoint.
/// We'll need to add this to the GitLab client.
///
/// # Arguments
/// * `mr_id` - Merge request ID (local database ID)
///
/// # Returns
/// Success or error
#[tauri::command]
pub async fn unapprove_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<(), AppError> {
    let (project_id, mr_iid) = get_mr_ids(pool.inner(), mr_id).await?;

    // Update approval status optimistically
    // Decrement approvals_count (but not below 0), update approval_status, and mark user as not having approved
    sqlx::query(
        r#"
        UPDATE merge_requests
        SET approvals_count = MAX(COALESCE(approvals_count, 0) - 1, 0),
            approval_status = CASE
                WHEN MAX(COALESCE(approvals_count, 0) - 1, 0) >= COALESCE(approvals_required, 1)
                THEN 'approved'
                ELSE 'pending'
            END,
            user_has_approved = 0
        WHERE id = ?
        "#,
    )
    .bind(mr_id)
    .execute(pool.inner())
    .await?;

    // Build payload for sync queue
    // For unapprove, we'll use a special action type marker in the payload
    let payload = serde_json::to_string(&serde_json::json!({
        "project_id": project_id,
        "mr_iid": mr_iid,
        "action": "unapprove"
    }))?;

    // Note: We don't have an Unapprove action type, so we'll handle this in sync_processor
    // by checking the payload. For now, queue as Approve but the processor will check.
    // Actually, let's add a proper distinction - we should extend ActionType or use payload.
    // For simplicity, we'll put "unapprove" in the payload and handle it there.
    sync_queue::enqueue_action(
        pool.inner(),
        EnqueueInput {
            mr_id,
            action_type: ActionType::Approve, // Will check payload.action in processor
            payload,
            local_reference_id: None,
        },
    )
    .await?;

    Ok(())
}

/// Get the current approval status for an MR.
///
/// # Arguments
/// * `mr_id` - Merge request ID
///
/// # Returns
/// Approval status details
#[tauri::command]
pub async fn get_approval_status(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<ApprovalStatus, AppError> {
    let row = sqlx::query(
        r#"
        SELECT approval_status, approvals_count, approvals_required
        FROM merge_requests
        WHERE id = ?
        "#,
    )
    .bind(mr_id)
    .fetch_optional(pool.inner())
    .await?
    .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;

    Ok(ApprovalStatus {
        status: row.get::<Option<String>, _>("approval_status"),
        approvals_count: row.get::<Option<i64>, _>("approvals_count").unwrap_or(0),
        approvals_required: row.get::<Option<i64>, _>("approvals_required").unwrap_or(0),
    })
}

/// Approval status response.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalStatus {
    /// Current status: approved, pending, or changes_requested.
    pub status: Option<String>,
    /// Current number of approvals.
    pub approvals_count: i64,
    /// Number of approvals required.
    pub approvals_required: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_approval_status_serialize() {
        let status = ApprovalStatus {
            status: Some("approved".to_string()),
            approvals_count: 2,
            approvals_required: 1,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"approvalsCount\":2"));
        assert!(json.contains("\"approvalsRequired\":1"));
    }
}
