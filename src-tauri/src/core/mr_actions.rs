//! Mutating MR operations shared between Tauri commands and the CLI.
//!
//! merge/rebase/undraft call the GitLab API directly (not the sync queue) and
//! write an optimistic local update, matching the desktop command handlers.

use crate::core::create_client;
use crate::db::pool::DbPool;
use crate::error::AppError;

/// Look up (instance_id, project_id, iid) for a local MR id.
pub async fn mr_api_ids(pool: &DbPool, mr_id: i64) -> Result<(i64, i64, i64), AppError> {
    sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT instance_id, project_id, iid FROM merge_requests WHERE id = ?",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))
}

/// Strip a leading `Draft:` or `WIP:` prefix from an MR title.
pub fn strip_draft_prefix(title: &str) -> String {
    for prefix in ["Draft:", "WIP:"] {
        if let Some(rest) = title.strip_prefix(prefix) {
            return rest.trim_start().to_string();
        }
    }
    title.to_string()
}

/// Merge an MR via the GitLab API, then mark it merged locally.
pub async fn merge(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.merge_merge_request(project_id, iid).await?;
    // state_changed_at is required so the sync engine's hard-purge (which treats
    // NULL as "legacy, eligible for delete") doesn't sweep the row on the next cycle.
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "UPDATE merge_requests SET state = 'merged', merged_at = ?, state_changed_at = ? WHERE id = ?",
    )
    .bind(now)
    .bind(now)
    .bind(mr_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Rebase an MR's source branch via the GitLab API (async on GitLab's side).
pub async fn rebase(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.rebase_merge_request(project_id, iid).await
}

/// Mark a draft MR ready by stripping its title prefix. Returns the new title.
/// No-op (no network call) if the title has no draft prefix.
pub async fn undraft(pool: &DbPool, mr_id: i64) -> Result<String, AppError> {
    let title: String = sqlx::query_scalar("SELECT title FROM merge_requests WHERE id = ?")
        .bind(mr_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;
    let new_title = strip_draft_prefix(&title);
    if new_title == title {
        return Ok(title);
    }
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.mark_merge_request_ready(project_id, iid, &new_title).await?;
    sqlx::query("UPDATE merge_requests SET title = ? WHERE id = ?")
        .bind(&new_title)
        .bind(mr_id)
        .execute(pool)
        .await?;
    Ok(new_title)
}

/// Apply the optimistic local approval-count update used by both the desktop
/// (queue path) and the CLI (direct path). `approved=true` increments and sets
/// `user_has_approved=1`; `false` decrements (floored at 0) and clears it.
pub async fn apply_local_approval(
    pool: &DbPool,
    mr_id: i64,
    approved: bool,
) -> Result<(), AppError> {
    let sql = if approved {
        r#"
        UPDATE merge_requests
        SET approvals_count = COALESCE(approvals_count, 0) + 1,
            approval_status = CASE
                WHEN COALESCE(approvals_count, 0) + 1 >= COALESCE(approvals_required, 1)
                THEN 'approved' ELSE 'pending' END,
            user_has_approved = 1
        WHERE id = ?
        "#
    } else {
        r#"
        UPDATE merge_requests
        SET approvals_count = MAX(COALESCE(approvals_count, 0) - 1, 0),
            approval_status = CASE
                WHEN MAX(COALESCE(approvals_count, 0) - 1, 0) >= COALESCE(approvals_required, 1)
                THEN 'approved' ELSE 'pending' END,
            user_has_approved = 0
        WHERE id = ?
        "#
    };
    sqlx::query(sql).bind(mr_id).execute(pool).await?;
    Ok(())
}

/// Approve an MR via the GitLab API + optimistic local update (CLI path).
pub async fn approve(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.approve_merge_request(project_id, iid).await?;
    apply_local_approval(pool, mr_id, true).await
}

/// Unapprove an MR via the GitLab API + optimistic local update (CLI path).
pub async fn unapprove(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.unapprove_merge_request(project_id, iid).await?;
    apply_local_approval(pool, mr_id, false).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_prefix_variants() {
        assert_eq!(strip_draft_prefix("Draft: x"), "x");
        assert_eq!(strip_draft_prefix("WIP: x"), "x");
        assert_eq!(strip_draft_prefix("Draft:x"), "x");
        assert_eq!(strip_draft_prefix("plain"), "plain");
        assert_eq!(strip_draft_prefix("a Draft: b"), "a Draft: b");
    }

    #[tokio::test]
    async fn local_approval_increments_and_decrements() {
        use crate::db;
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (id, url, name, created_at) VALUES (1, 'https://gitlab.com', 'GitLab', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO merge_requests
             (id, instance_id, iid, project_id, project_name, title, author_username,
              source_branch, target_branch, state, web_url, created_at, updated_at,
              labels, reviewers, cached_at, approvals_required, approvals_count)
             VALUES (1, 1, 1, 1, 'g/p', 't', 'a', 's', 'm', 'opened', 'x', 0, 0, '[]', '[]', 0, 1, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        apply_local_approval(&pool, 1, true).await.unwrap();
        let (count, approved): (i64, i64) =
            sqlx::query_as("SELECT approvals_count, user_has_approved FROM merge_requests WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((count, approved), (1, 1));
        // approvals_count (1) >= approvals_required (1) → status flips to approved.
        let status: Option<String> =
            sqlx::query_scalar("SELECT approval_status FROM merge_requests WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status.as_deref(), Some("approved"));

        apply_local_approval(&pool, 1, false).await.unwrap();
        let (count, approved): (i64, i64) =
            sqlx::query_as("SELECT approvals_count, user_has_approved FROM merge_requests WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((count, approved), (0, 0));
        // approvals_count (0) < approvals_required (1) → status back to pending.
        let status: Option<String> =
            sqlx::query_scalar("SELECT approval_status FROM merge_requests WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(status.as_deref(), Some("pending"));
    }
}
