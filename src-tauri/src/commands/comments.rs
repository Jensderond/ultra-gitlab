//! Comment commands for reading and creating comments.
//!
//! These commands handle both cached comments and local (pending sync) comments.
//! New comments are inserted optimistically into the local database and queued for sync.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::sync_action::ActionType;
use crate::models::Comment;
use crate::services::sync_queue::{self, EnqueueInput, ReplyPayload, ResolvePayload};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// Response for get_comments command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentResponse {
    pub id: i64,
    pub mr_id: i64,
    pub discussion_id: Option<String>,
    pub parent_id: Option<i64>,
    pub author_username: String,
    pub body: String,
    pub file_path: Option<String>,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
    pub line_type: Option<String>,
    pub resolved: bool,
    pub resolvable: bool,
    pub system: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_local: bool,
    /// Sync status: 'synced', 'pending', or 'failed'
    pub sync_status: String,
}

/// Get the current Unix timestamp.
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Convert a list of Comments to CommentResponses, resolving sync status for local comments.
async fn to_comment_responses(
    pool: &DbPool,
    comments: Vec<Comment>,
) -> Result<Vec<CommentResponse>, AppError> {
    let mut responses = Vec::with_capacity(comments.len());
    for comment in comments {
        let sync_status = if comment.is_local {
            get_comment_sync_status(pool, comment.id).await?
        } else {
            "synced".to_string()
        };

        responses.push(CommentResponse {
            id: comment.id,
            mr_id: comment.mr_id,
            discussion_id: comment.discussion_id,
            parent_id: comment.parent_id,
            author_username: comment.author_username,
            body: comment.body,
            file_path: comment.file_path,
            old_line: comment.old_line,
            new_line: comment.new_line,
            line_type: comment.line_type,
            resolved: comment.resolved,
            resolvable: comment.resolvable,
            system: comment.system,
            created_at: comment.created_at,
            updated_at: comment.updated_at,
            is_local: comment.is_local,
            sync_status,
        });
    }
    Ok(responses)
}

/// Generate a negative ID for local comments (to avoid conflicts with GitLab IDs).
fn generate_local_id() -> i64 {
    -now()
}

/// Get all comments for a merge request.
///
/// Returns both cached GitLab comments and local (pending sync) comments.
/// Comments are ordered by creation time.
///
/// # Arguments
/// * `mr_id` - Merge request ID
///
/// # Returns
/// Array of comments with sync status
#[tauri::command]
pub async fn get_comments(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<Vec<CommentResponse>, AppError> {
    let comments = sqlx::query_as::<_, Comment>(
        r#"
        SELECT id, mr_id, discussion_id, parent_id, author_username, body,
               file_path, old_line, new_line, line_type, resolved, resolvable,
               system, created_at, updated_at, cached_at, is_local
        FROM comments
        WHERE mr_id = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(mr_id)
    .fetch_all(pool.inner())
    .await?;

    to_comment_responses(pool.inner(), comments).await
}

/// Get sync status for a local comment from the sync queue.
async fn get_comment_sync_status(pool: &DbPool, comment_id: i64) -> Result<String, AppError> {
    let row = sqlx::query(
        "SELECT status FROM sync_queue WHERE local_reference_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(comment_id)
    .fetch_optional(pool)
    .await?;

    Ok(row
        .map(|r| {
            let status: String = r.get("status");
            status
        })
        .unwrap_or_else(|| "pending".to_string()))
}

/// MR info needed for comment operations, looked up from DB.
struct MrInfo {
    project_id: i64,
    iid: i64,
    instance_id: i64,
}

/// Look up project_id, iid, and instance_id for a merge request.
async fn get_mr_info(pool: &DbPool, mr_id: i64) -> Result<MrInfo, AppError> {
    let row = sqlx::query("SELECT project_id, iid, instance_id FROM merge_requests WHERE id = ?")
        .bind(mr_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;

    Ok(MrInfo {
        project_id: row.get("project_id"),
        iid: row.get("iid"),
        instance_id: row.get("instance_id"),
    })
}

/// Look up diff refs (base_sha, head_sha, start_sha) for a merge request.
async fn get_diff_shas(pool: &DbPool, mr_id: i64) -> Result<(String, String, String), AppError> {
    let row = sqlx::query("SELECT base_sha, head_sha, start_sha FROM diffs WHERE mr_id = ?")
        .bind(mr_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found_with_id("Diff", mr_id.to_string()))?;

    Ok((
        row.get("base_sha"),
        row.get("head_sha"),
        row.get("start_sha"),
    ))
}

/// Get the authenticated username for the instance associated with an MR.
async fn get_authenticated_username(pool: &DbPool, instance_id: i64) -> Result<String, AppError> {
    let row = sqlx::query("SELECT authenticated_username FROM gitlab_instances WHERE id = ?")
        .bind(instance_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found_with_id("GitLabInstance", instance_id.to_string()))?;

    let username: Option<String> = row.get("authenticated_username");
    Ok(username.unwrap_or_else(|| "You".to_string()))
}

/// Input for add_comment command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddCommentInput {
    /// Merge request ID (local database ID).
    pub mr_id: i64,
    /// Comment body.
    pub body: String,
    /// File path for inline comments.
    pub file_path: Option<String>,
    /// Line in old version.
    pub old_line: Option<i64>,
    /// Line in new version.
    pub new_line: Option<i64>,
}

/// Add a new comment to a merge request.
///
/// The comment is inserted immediately into the local database (optimistic update)
/// and queued for synchronization to GitLab. MR details (project_id, iid, SHAs)
/// are looked up from the database automatically.
///
/// # Arguments
/// * `input` - Comment details (mr_id, body, optional position)
///
/// # Returns
/// The created comment with pending sync status
#[tauri::command]
pub async fn add_comment(
    pool: State<'_, DbPool>,
    input: AddCommentInput,
) -> Result<CommentResponse, AppError> {
    // Look up MR info from database
    let mr_info = get_mr_info(pool.inner(), input.mr_id).await?;

    // Look up diff SHAs for inline comments
    let (base_sha, head_sha, start_sha) = if input.file_path.is_some() {
        let shas = get_diff_shas(pool.inner(), input.mr_id).await?;
        (Some(shas.0), Some(shas.1), Some(shas.2))
    } else {
        (None, None, None)
    };

    // Get the authenticated username for optimistic display
    let author_username = get_authenticated_username(pool.inner(), mr_info.instance_id).await?;

    let timestamp = now();
    let local_id = generate_local_id();

    // Insert comment optimistically
    sqlx::query(
        r#"
        INSERT INTO comments (id, mr_id, discussion_id, parent_id, author_username, body,
                              file_path, old_line, new_line, line_type, resolved, resolvable,
                              system, created_at, updated_at, cached_at, is_local)
        VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, 0, 1, 0, ?, ?, ?, 1)
        "#,
    )
    .bind(local_id)
    .bind(input.mr_id)
    .bind(&author_username)
    .bind(&input.body)
    .bind(&input.file_path)
    .bind(input.old_line)
    .bind(input.new_line)
    .bind(timestamp)
    .bind(timestamp)
    .bind(timestamp)
    .execute(pool.inner())
    .await?;

    // Build payload for sync queue (includes SHA info for inline comments)
    let payload = serde_json::to_string(&serde_json::json!({
        "project_id": mr_info.project_id,
        "mr_iid": mr_info.iid,
        "body": input.body,
        "file_path": input.file_path,
        "old_line": input.old_line,
        "new_line": input.new_line,
        "base_sha": base_sha,
        "head_sha": head_sha,
        "start_sha": start_sha,
    }))?;

    // Queue for sync
    sync_queue::enqueue_action(
        pool.inner(),
        EnqueueInput {
            mr_id: input.mr_id,
            action_type: ActionType::Comment,
            payload,
            local_reference_id: Some(local_id),
        },
    )
    .await?;

    Ok(CommentResponse {
        id: local_id,
        mr_id: input.mr_id,
        discussion_id: None,
        parent_id: None,
        author_username,
        body: input.body,
        file_path: input.file_path,
        old_line: input.old_line,
        new_line: input.new_line,
        line_type: None,
        resolved: false,
        resolvable: true,
        system: false,
        created_at: timestamp,
        updated_at: timestamp,
        is_local: true,
        sync_status: "pending".to_string(),
    })
}

/// Input for reply_to_comment command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyInput {
    /// Merge request ID (local database ID).
    pub mr_id: i64,
    /// Discussion ID to reply to.
    pub discussion_id: String,
    /// Parent comment ID.
    pub parent_id: i64,
    /// Reply body.
    pub body: String,
}

/// Reply to an existing discussion thread.
///
/// The reply is inserted immediately into the local database (optimistic update)
/// and queued for synchronization to GitLab. MR details are looked up from the database.
///
/// # Arguments
/// * `input` - Reply details
///
/// # Returns
/// The created reply with pending sync status
#[tauri::command]
pub async fn reply_to_comment(
    pool: State<'_, DbPool>,
    input: ReplyInput,
) -> Result<CommentResponse, AppError> {
    let mr_info = get_mr_info(pool.inner(), input.mr_id).await?;
    let author_username = get_authenticated_username(pool.inner(), mr_info.instance_id).await?;

    let timestamp = now();
    let local_id = generate_local_id();

    // Get the parent comment to inherit file_path and line info
    let parent = sqlx::query_as::<_, Comment>(
        r#"
        SELECT id, mr_id, discussion_id, parent_id, author_username, body,
               file_path, old_line, new_line, line_type, resolved, resolvable,
               system, created_at, updated_at, cached_at, is_local
        FROM comments
        WHERE id = ?
        "#,
    )
    .bind(input.parent_id)
    .fetch_optional(pool.inner())
    .await?
    .ok_or_else(|| AppError::not_found_with_id("Comment", input.parent_id.to_string()))?;

    // Insert reply optimistically
    sqlx::query(
        r#"
        INSERT INTO comments (id, mr_id, discussion_id, parent_id, author_username, body,
                              file_path, old_line, new_line, line_type, resolved, resolvable,
                              system, created_at, updated_at, cached_at, is_local)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, 1)
        "#,
    )
    .bind(local_id)
    .bind(input.mr_id)
    .bind(&input.discussion_id)
    .bind(input.parent_id)
    .bind(&author_username)
    .bind(&input.body)
    .bind(&parent.file_path)
    .bind(parent.old_line)
    .bind(parent.new_line)
    .bind(&parent.line_type)
    .bind(timestamp)
    .bind(timestamp)
    .bind(timestamp)
    .execute(pool.inner())
    .await?;

    // Build payload for sync queue
    let payload = serde_json::to_string(&ReplyPayload {
        project_id: mr_info.project_id,
        mr_iid: mr_info.iid,
        discussion_id: input.discussion_id.clone(),
        body: input.body.clone(),
    })?;

    // Queue for sync
    sync_queue::enqueue_action(
        pool.inner(),
        EnqueueInput {
            mr_id: input.mr_id,
            action_type: ActionType::Reply,
            payload,
            local_reference_id: Some(local_id),
        },
    )
    .await?;

    Ok(CommentResponse {
        id: local_id,
        mr_id: input.mr_id,
        discussion_id: Some(input.discussion_id),
        parent_id: Some(input.parent_id),
        author_username,
        body: input.body,
        file_path: parent.file_path,
        old_line: parent.old_line,
        new_line: parent.new_line,
        line_type: parent.line_type,
        resolved: false,
        resolvable: false,
        system: false,
        created_at: timestamp,
        updated_at: timestamp,
        is_local: true,
        sync_status: "pending".to_string(),
    })
}

/// Input for resolve_discussion command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveInput {
    /// Merge request ID (local database ID).
    pub mr_id: i64,
    /// Discussion ID to resolve.
    pub discussion_id: String,
    /// Whether to resolve (true) or unresolve (false).
    pub resolved: bool,
}

/// Resolve or unresolve a discussion thread.
///
/// Updates the resolved status optimistically and queues for sync.
/// MR details are looked up from the database.
///
/// # Arguments
/// * `input` - Resolve details
///
/// # Returns
/// Success or error
#[tauri::command]
pub async fn resolve_discussion(
    pool: State<'_, DbPool>,
    input: ResolveInput,
) -> Result<(), AppError> {
    let mr_info = get_mr_info(pool.inner(), input.mr_id).await?;

    // Update all comments in the discussion optimistically
    sqlx::query("UPDATE comments SET resolved = ? WHERE discussion_id = ?")
        .bind(input.resolved)
        .bind(&input.discussion_id)
        .execute(pool.inner())
        .await?;

    // Build payload for sync queue
    let payload = serde_json::to_string(&ResolvePayload {
        project_id: mr_info.project_id,
        mr_iid: mr_info.iid,
        discussion_id: input.discussion_id,
    })?;

    // Queue for sync
    let action_type = if input.resolved {
        ActionType::Resolve
    } else {
        ActionType::Unresolve
    };

    sync_queue::enqueue_action(
        pool.inner(),
        EnqueueInput {
            mr_id: input.mr_id,
            action_type,
            payload,
            local_reference_id: None,
        },
    )
    .await?;

    Ok(())
}

/// Get comments for a specific file and line.
///
/// Useful for showing inline comments in the diff viewer.
///
/// # Arguments
/// * `mr_id` - Merge request ID
/// * `file_path` - Path of the file
///
/// # Returns
/// Array of inline comments for the file
#[tauri::command]
pub async fn get_file_comments(
    pool: State<'_, DbPool>,
    mr_id: i64,
    file_path: String,
) -> Result<Vec<CommentResponse>, AppError> {
    let comments = sqlx::query_as::<_, Comment>(
        r#"
        SELECT id, mr_id, discussion_id, parent_id, author_username, body,
               file_path, old_line, new_line, line_type, resolved, resolvable,
               system, created_at, updated_at, cached_at, is_local
        FROM comments
        WHERE mr_id = ? AND file_path = ?
        ORDER BY COALESCE(new_line, old_line), created_at ASC
        "#,
    )
    .bind(mr_id)
    .bind(&file_path)
    .fetch_all(pool.inner())
    .await?;

    to_comment_responses(pool.inner(), comments).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_local_id_is_negative() {
        let id = generate_local_id();
        assert!(id < 0, "Local ID should be negative");
    }
}
