//! Sync processor for pushing local actions to GitLab.
//!
//! Takes actions from the sync queue and executes them against the GitLab API.
//! Handles retries, error logging, and status updates.
//!
//! # Conflict Handling
//!
//! When an MR is merged, closed, or deleted on GitLab while local actions are pending,
//! the sync processor detects these conflicts and discards the stale actions instead
//! of retrying them indefinitely.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::sync_action::{ActionType, SyncAction};
use crate::services::gitlab_client::GitLabClient;
use crate::services::sync_queue::{self, ReplyPayload, ResolvePayload};
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
    /// Whether the action was discarded due to MR conflict.
    pub discarded: bool,
}

/// Reason for discarding an action.
#[derive(Debug, Clone)]
pub enum DiscardReason {
    /// MR was not found (deleted)
    MrNotFound,
    /// MR is merged/closed and action is not allowed
    MrNotActionable,
    /// Comment position no longer exists (line deleted)
    PositionInvalid,
}

impl DiscardReason {
    /// Get a human-readable description of the discard reason.
    pub fn message(&self) -> &'static str {
        match self {
            Self::MrNotFound => "MR was deleted or not accessible",
            Self::MrNotActionable => "MR was merged or closed",
            Self::PositionInvalid => "Comment position no longer exists (line was deleted)",
        }
    }
}

/// Check if an error indicates the MR is stale/not actionable.
///
/// Returns Some(DiscardReason) if the action should be discarded, None if it should be retried.
fn check_stale_mr_error(error: &AppError) -> Option<DiscardReason> {
    match error {
        AppError::GitLabApi { status_code: Some(status), message, .. } => {
            match *status {
                // 404 Not Found - MR was deleted
                404 => Some(DiscardReason::MrNotFound),
                // 405 Method Not Allowed - MR is in a state that doesn't allow the action
                // GitLab returns 405 when trying to approve a merged/closed MR
                405 => Some(DiscardReason::MrNotActionable),
                // 403 Forbidden with specific messages can indicate stale state
                403 => {
                    let msg_lower = message.to_lowercase();
                    if msg_lower.contains("merged") || msg_lower.contains("closed") {
                        Some(DiscardReason::MrNotActionable)
                    } else {
                        None // Could be a permissions issue, should retry
                    }
                }
                // 400 Bad Request for inline comments can indicate position is invalid
                400 => {
                    let msg_lower = message.to_lowercase();
                    if msg_lower.contains("position") || msg_lower.contains("line") || msg_lower.contains("outdated") {
                        Some(DiscardReason::PositionInvalid)
                    } else {
                        None
                    }
                }
                _ => None,
            }
        }
        AppError::NotFound { .. } => Some(DiscardReason::MrNotFound),
        _ => None,
    }
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
/// ProcessResult with success status, error details, and discard status
///
/// # Conflict Handling
///
/// When the GitLab API returns errors indicating the MR is stale (merged, closed,
/// deleted, or comment position no longer exists), the action is discarded instead
/// of being marked for retry. This prevents endless retry loops for actions that
/// can never succeed.
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
            discarded: false,
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
                    discarded: false,
                };
            }
            ProcessResult {
                action: action.clone(),
                success: true,
                error: None,
                duration_ms,
                discarded: false,
            }
        }
        Err(e) => {
            // Check if this error indicates a stale MR that should be discarded
            if let Some(discard_reason) = check_stale_mr_error(&e) {
                let reason_msg = discard_reason.message();
                log::info!(
                    "Discarding action {} (type: {}) for MR {}: {}",
                    action.id,
                    action.action_type,
                    action.mr_id,
                    reason_msg
                );

                // Mark as discarded instead of failed
                if let Err(mark_err) = sync_queue::mark_discarded(pool, action.id, reason_msg).await {
                    return ProcessResult {
                        action: action.clone(),
                        success: false,
                        error: Some(format!(
                            "Action should be discarded ({}) but failed to update status: {}",
                            reason_msg, mark_err
                        )),
                        duration_ms,
                        discarded: false,
                    };
                }

                return ProcessResult {
                    action: action.clone(),
                    success: false,
                    error: Some(reason_msg.to_string()),
                    duration_ms,
                    discarded: true,
                };
            }

            // Regular failure - mark as failed for retry
            let error_msg = e.to_string();
            if let Err(mark_err) = sync_queue::mark_failed(pool, action.id, &error_msg).await {
                return ProcessResult {
                    action: action.clone(),
                    success: false,
                    error: Some(format!(
                        "Action failed ({}) and failed to update status: {}",
                        error_msg, mark_err
                    )),
                    duration_ms,
                    discarded: false,
                };
            }
            ProcessResult {
                action: action.clone(),
                success: false,
                error: Some(error_msg),
                duration_ms,
                discarded: false,
            }
        }
    }
}

/// Extended approval payload that can include action type.
#[derive(Debug, Clone, Deserialize)]
struct ApprovalPayloadExt {
    pub project_id: i64,
    pub mr_iid: i64,
    #[serde(default)]
    pub action: Option<String>,
}

/// Process an approval action (approve or unapprove).
async fn process_approval(client: &GitLabClient, action: &SyncAction) -> Result<(), AppError> {
    let payload: ApprovalPayloadExt = serde_json::from_str(&action.payload)?;

    if payload.action.as_deref() == Some("unapprove") {
        client
            .unapprove_merge_request(payload.project_id, payload.mr_iid)
            .await
    } else {
        client
            .approve_merge_request(payload.project_id, payload.mr_iid)
            .await
    }
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
    use crate::services::sync_queue::{ApprovalPayload, CommentPayload};

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

    // Tests for conflict detection

    #[test]
    fn test_check_stale_mr_error_404_not_found() {
        let error = AppError::gitlab_api_full("Resource not found", 404, "/api/v4/merge_requests/1");
        let result = check_stale_mr_error(&error);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), DiscardReason::MrNotFound));
    }

    #[test]
    fn test_check_stale_mr_error_405_method_not_allowed() {
        let error = AppError::gitlab_api_full("Method not allowed", 405, "/api/v4/merge_requests/1/approve");
        let result = check_stale_mr_error(&error);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), DiscardReason::MrNotActionable));
    }

    #[test]
    fn test_check_stale_mr_error_403_merged() {
        let error = AppError::gitlab_api_full("Cannot approve: MR is already merged", 403, "/api/v4/merge_requests/1/approve");
        let result = check_stale_mr_error(&error);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), DiscardReason::MrNotActionable));
    }

    #[test]
    fn test_check_stale_mr_error_403_closed() {
        let error = AppError::gitlab_api_full("Cannot approve: MR is closed", 403, "/api/v4/merge_requests/1/approve");
        let result = check_stale_mr_error(&error);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), DiscardReason::MrNotActionable));
    }

    #[test]
    fn test_check_stale_mr_error_403_permission_denied() {
        // Regular permission denied should not be discarded - could be a temporary issue
        let error = AppError::gitlab_api_full("Access denied", 403, "/api/v4/merge_requests/1");
        let result = check_stale_mr_error(&error);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_stale_mr_error_400_position_invalid() {
        let error = AppError::gitlab_api_full("Position is outdated", 400, "/api/v4/merge_requests/1/discussions");
        let result = check_stale_mr_error(&error);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), DiscardReason::PositionInvalid));
    }

    #[test]
    fn test_check_stale_mr_error_400_line_deleted() {
        let error = AppError::gitlab_api_full("Line no longer exists", 400, "/api/v4/merge_requests/1/discussions");
        let result = check_stale_mr_error(&error);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), DiscardReason::PositionInvalid));
    }

    #[test]
    fn test_check_stale_mr_error_400_other() {
        // Regular 400 error without position/line keywords should be retried
        let error = AppError::gitlab_api_full("Invalid request", 400, "/api/v4/merge_requests/1");
        let result = check_stale_mr_error(&error);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_stale_mr_error_network_error() {
        // Network errors should be retried
        let error = AppError::network("Connection refused");
        let result = check_stale_mr_error(&error);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_stale_mr_error_500() {
        // Server errors should be retried
        let error = AppError::gitlab_api_full("Internal server error", 500, "/api/v4/merge_requests/1");
        let result = check_stale_mr_error(&error);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_stale_mr_error_not_found_variant() {
        let error = AppError::not_found("MergeRequest");
        let result = check_stale_mr_error(&error);
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), DiscardReason::MrNotFound));
    }

    #[test]
    fn test_discard_reason_messages() {
        assert!(!DiscardReason::MrNotFound.message().is_empty());
        assert!(!DiscardReason::MrNotActionable.message().is_empty());
        assert!(!DiscardReason::PositionInvalid.message().is_empty());
    }
}
