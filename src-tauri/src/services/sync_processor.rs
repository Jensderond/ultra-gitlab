//! Sync processor for pushing local actions to GitLab.
//!
//! Takes actions from the sync queue and executes them against the GitLab API.
//! Handles retries, error logging, and status updates.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::sync_action::{ActionType, SyncAction};
use crate::services::gitlab_client::GitLabClient;
use crate::services::sync_queue::{self, ApprovalPayload, ReplyPayload, ResolvePayload};
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};

/// Extended comment payload with SHA information for inline comments.
#[derive(Debug, Clone, Deserialize)]
pub struct CommentPayloadWithSha {
    pub project_id: i64,
    pub mr_iid: i64,
    pub body: String,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub old_line: Option<i64>,
    #[serde(default)]
    pub new_line: Option<i64>,
    /// Base SHA for inline comments
    #[serde(default)]
    pub base_sha: Option<String>,
    /// Head SHA for inline comments
    #[serde(default)]
    pub head_sha: Option<String>,
    /// Start SHA for inline comments
    #[serde(default)]
    pub start_sha: Option<String>,
}

/// Result of processing a single action.
#[derive(Debug)]
pub struct ProcessResult {
    /// The action that was processed.
    pub action: SyncAction,
    /// Whether the action was successfully synced.
    pub success: bool,
    /// Error message if failed.
    pub error: Option<String>,
    /// Duration of the operation in milliseconds.
    pub duration_ms: i64,
}

/// Get the current Unix timestamp.
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Process a single sync action.
///
/// # Arguments
/// * `client` - GitLab API client
/// * `pool` - Database connection pool
/// * `action` - The action to process
///
/// # Returns
/// ProcessResult with success status and any error
pub async fn process_action(
    client: &GitLabClient,
    pool: &DbPool,
    action: &SyncAction,
) -> ProcessResult {
    let start = now();

    // Mark as syncing
    if let Err(e) = sync_queue::mark_syncing(pool, action.id).await {
        return ProcessResult {
            action: action.clone(),
            success: false,
            error: Some(format!("Failed to mark as syncing: {}", e)),
            duration_ms: now() - start,
        };
    }

    // Execute the action
    let result = match action.action_type_enum() {
        ActionType::Approve => process_approval(client, action).await,
        ActionType::Comment => process_comment(client, action).await,
        ActionType::Reply => process_reply(client, action).await,
        ActionType::Resolve => process_resolve(client, action, true).await,
        ActionType::Unresolve => process_resolve(client, action, false).await,
    };

    let duration_ms = now() - start;

    match result {
        Ok(()) => {
            // Mark as synced
            if let Err(e) = sync_queue::mark_synced(pool, action.id).await {
                return ProcessResult {
                    action: action.clone(),
                    success: false,
                    error: Some(format!("Action succeeded but failed to mark as synced: {}", e)),
                    duration_ms,
                };
            }
            ProcessResult {
                action: action.clone(),
                success: true,
                error: None,
                duration_ms,
            }
        }
        Err(e) => {
            let error_msg = e.to_string();
            // Mark as failed (increments retry count)
            if let Err(mark_err) = sync_queue::mark_failed(pool, action.id, &error_msg).await {
                return ProcessResult {
                    action: action.clone(),
                    success: false,
                    error: Some(format!(
                        "Action failed ({}) and failed to update status: {}",
                        error_msg, mark_err
                    )),
                    duration_ms,
                };
            }
            ProcessResult {
                action: action.clone(),
                success: false,
                error: Some(error_msg),
                duration_ms,
            }
        }
    }
}

/// Process an approval action.
async fn process_approval(client: &GitLabClient, action: &SyncAction) -> Result<(), AppError> {
    let payload: ApprovalPayload = serde_json::from_str(&action.payload)?;

    client
        .approve_merge_request(payload.project_id, payload.mr_iid)
        .await
}

/// Process a comment action (general or inline).
async fn process_comment(client: &GitLabClient, action: &SyncAction) -> Result<(), AppError> {
    // Try parsing as extended payload first (with SHA info for inline comments)
    let payload: CommentPayloadWithSha = serde_json::from_str(&action.payload)?;

    if let Some(file_path) = &payload.file_path {
        // Inline comment - requires SHA info
        let base_sha = payload
            .base_sha
            .as_ref()
            .ok_or_else(|| AppError::invalid_input("Inline comment requires base_sha"))?;
        let head_sha = payload
            .head_sha
            .as_ref()
            .ok_or_else(|| AppError::invalid_input("Inline comment requires head_sha"))?;
        let start_sha = payload
            .start_sha
            .as_ref()
            .ok_or_else(|| AppError::invalid_input("Inline comment requires start_sha"))?;

        client
            .add_inline_comment(
                payload.project_id,
                payload.mr_iid,
                &payload.body,
                file_path,
                payload.old_line,
                payload.new_line,
                base_sha,
                head_sha,
                start_sha,
            )
            .await?;
    } else {
        // General comment
        client
            .add_comment(payload.project_id, payload.mr_iid, &payload.body)
            .await?;
    }

    Ok(())
}

/// Process a reply action.
async fn process_reply(client: &GitLabClient, action: &SyncAction) -> Result<(), AppError> {
    let payload: ReplyPayload = serde_json::from_str(&action.payload)?;

    client
        .reply_to_discussion(
            payload.project_id,
            payload.mr_iid,
            &payload.discussion_id,
            &payload.body,
        )
        .await?;

    Ok(())
}

/// Process a resolve/unresolve action.
async fn process_resolve(
    client: &GitLabClient,
    action: &SyncAction,
    resolved: bool,
) -> Result<(), AppError> {
    let payload: ResolvePayload = serde_json::from_str(&action.payload)?;

    client
        .resolve_discussion(
            payload.project_id,
            payload.mr_iid,
            &payload.discussion_id,
            resolved,
        )
        .await
}

/// Process all pending actions from the queue.
///
/// # Arguments
/// * `client` - GitLab API client
/// * `pool` - Database connection pool
///
/// # Returns
/// Vector of results for each processed action
pub async fn process_pending_actions(
    client: &GitLabClient,
    pool: &DbPool,
) -> Result<Vec<ProcessResult>, AppError> {
    let pending = sync_queue::get_pending_actions(pool).await?;
    let mut results = Vec::with_capacity(pending.len());

    for action in &pending {
        let result = process_action(client, pool, action).await;
        results.push(result);
    }

    Ok(results)
}

/// Process all retryable failed actions.
///
/// # Arguments
/// * `client` - GitLab API client
/// * `pool` - Database connection pool
///
/// # Returns
/// Vector of results for each retried action
pub async fn retry_failed_actions(
    client: &GitLabClient,
    pool: &DbPool,
) -> Result<Vec<ProcessResult>, AppError> {
    let retryable = sync_queue::get_retryable_actions(pool).await?;
    let mut results = Vec::with_capacity(retryable.len());

    for action in &retryable {
        // Reset to pending first
        sync_queue::retry_action(pool, action.id).await?;

        // Then process
        let result = process_action(client, pool, action).await;
        results.push(result);
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::sync_queue::CommentPayload;

    #[test]
    fn test_parse_approval_payload() {
        let json = r#"{"project_id": 1, "mr_iid": 42}"#;
        let payload: ApprovalPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.project_id, 1);
        assert_eq!(payload.mr_iid, 42);
    }

    #[test]
    fn test_parse_comment_payload() {
        let json = r#"{"project_id": 1, "mr_iid": 42, "body": "LGTM"}"#;
        let payload: CommentPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.project_id, 1);
        assert_eq!(payload.mr_iid, 42);
        assert_eq!(payload.body, "LGTM");
        assert!(payload.file_path.is_none());
    }

    #[test]
    fn test_parse_inline_comment_payload() {
        let json = r#"{
            "project_id": 1,
            "mr_iid": 42,
            "body": "Consider refactoring this",
            "file_path": "src/main.rs",
            "new_line": 10,
            "base_sha": "abc123",
            "head_sha": "def456",
            "start_sha": "ghi789"
        }"#;
        let payload: CommentPayloadWithSha = serde_json::from_str(json).unwrap();
        assert_eq!(payload.project_id, 1);
        assert_eq!(payload.file_path, Some("src/main.rs".to_string()));
        assert_eq!(payload.new_line, Some(10));
        assert_eq!(payload.base_sha, Some("abc123".to_string()));
    }

    #[test]
    fn test_parse_reply_payload() {
        let json = r#"{
            "project_id": 1,
            "mr_iid": 42,
            "discussion_id": "abc123",
            "body": "Thanks for the feedback"
        }"#;
        let payload: ReplyPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.discussion_id, "abc123");
        assert_eq!(payload.body, "Thanks for the feedback");
    }

    #[test]
    fn test_parse_resolve_payload() {
        let json = r#"{
            "project_id": 1,
            "mr_iid": 42,
            "discussion_id": "abc123"
        }"#;
        let payload: ResolvePayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.discussion_id, "abc123");
    }
}
