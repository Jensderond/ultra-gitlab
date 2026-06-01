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
}
