//! Comment commands for reading and creating comments.
//!
//! These commands handle both cached comments and local (pending sync) comments.
//! New comments are inserted optimistically into the local database and queued for sync.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::sync_action::ActionType;
use crate::models::Comment;
use crate::services::sync_engine::SyncHandle;
use crate::services::sync_queue::{self, DeleteCommentPayload, EnqueueInput, ReplyPayload, ResolvePayload};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::atomic::{AtomicI64, Ordering};
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

/// Atomic counter to guarantee uniqueness even within the same millisecond.
static LOCAL_ID_COUNTER: AtomicI64 = AtomicI64::new(0);

/// Generate a unique negative ID for local comments (to avoid conflicts with GitLab IDs).
///
/// Uses millisecond-precision timestamp combined with an atomic counter to prevent
/// collisions when multiple comments are created rapidly within the same millisecond.
fn generate_local_id() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let seq = LOCAL_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    // Combine: shift millis left by 16 bits to leave room for the counter.
    // This gives ~65k unique IDs per millisecond before any risk of overlap,
    // and the result stays well within i64 range for decades.
    -(millis * 65536 + (seq & 0xFFFF))
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

/// Resolve context line numbers from a unified diff.
///
/// Given a line number on one side, find the corresponding line on the other side
/// by parsing the unified diff hunk headers and counting lines.
///
/// Returns (old_line, new_line).
fn resolve_context_lines(
    diff_content: &str,
    known_line: i64,
    is_old_side: bool,
) -> Option<(i64, i64)> {
    // Parse unified diff hunk headers: @@ -old_start,old_count +new_start,new_count @@
    let mut old_line: i64 = 0;
    let mut new_line: i64 = 0;

    for line in diff_content.lines() {
        if line.starts_with("@@") {
            // Parse hunk header
            let parts: Vec<&str> = line.splitn(4, ' ').collect();
            if parts.len() >= 3 {
                if let Some(old_start) = parts[1].strip_prefix('-') {
                    old_line = old_start
                        .split(',')
                        .next()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0)
                        - 1; // will be incremented on first context/deletion line
                }
                if let Some(new_start) = parts[2].strip_prefix('+') {
                    new_line = new_start
                        .split(',')
                        .next()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0)
                        - 1;
                }
            }
            continue;
        }

        if line.starts_with("---") || line.starts_with("+++") || line.starts_with("diff ") || line.starts_with("index ") {
            continue;
        }

        if line.starts_with('-') {
            old_line += 1;
        } else if line.starts_with('+') {
            new_line += 1;
        } else {
            // Context line — both sides advance
            old_line += 1;
            new_line += 1;

            let target_matches = if is_old_side {
                old_line == known_line
            } else {
                new_line == known_line
            };

            if target_matches {
                return Some((old_line, new_line));
            }
        }
    }

    None
}

/// Look up the other side's line number for a context line comment.
async fn resolve_context_line_numbers(
    pool: &DbPool,
    mr_id: i64,
    file_path: &str,
    known_line: i64,
    is_old_side: bool,
) -> Result<(i64, i64), AppError> {
    let row = sqlx::query(
        "SELECT diff_content FROM diff_files WHERE mr_id = ? AND new_path = ?",
    )
    .bind(mr_id)
    .bind(file_path)
    .fetch_optional(pool)
    .await?;

    if let Some(row) = row {
        let diff_content: Option<String> = row.get("diff_content");
        if let Some(diff) = diff_content {
            if let Some(pair) = resolve_context_lines(&diff, known_line, is_old_side) {
                return Ok(pair);
            }
        }
    }

    // Fallback: use the same line for both (may fail for files with many changes)
    Ok((known_line, known_line))
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
    /// When true, this is an unchanged (context) line — resolve the other side's
    /// line number from the stored diff.
    #[serde(default)]
    pub is_context_line: bool,
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
    sync_handle: State<'_, SyncHandle>,
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

    // For context lines, resolve both old and new line numbers from the diff
    let (old_line, new_line) = if input.is_context_line {
        if let Some(file_path) = &input.file_path {
            let known_line = input.new_line.or(input.old_line).unwrap_or(1);
            let is_old_side = input.old_line.is_some() && input.new_line.is_none();
            let (old, new) = resolve_context_line_numbers(
                pool.inner(),
                input.mr_id,
                file_path,
                known_line,
                is_old_side,
            )
            .await?;
            (Some(old), Some(new))
        } else {
            (input.old_line, input.new_line)
        }
    } else {
        (input.old_line, input.new_line)
    };

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
    .bind(old_line)
    .bind(new_line)
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
        "old_line": old_line,
        "new_line": new_line,
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

    // Fire-and-forget: flush comment actions immediately
    if let Err(e) = sync_handle.flush_comments().await {
        eprintln!("[comment] Failed to send flush signal: {}", e);
    }

    Ok(CommentResponse {
        id: local_id,
        mr_id: input.mr_id,
        discussion_id: None,
        parent_id: None,
        author_username,
        body: input.body,
        file_path: input.file_path,
        old_line,
        new_line,
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
    sync_handle: State<'_, SyncHandle>,
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

    // Fire-and-forget: flush comment actions immediately
    if let Err(e) = sync_handle.flush_comments().await {
        eprintln!("[comment] Failed to send flush signal: {}", e);
    }

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
    sync_handle: State<'_, SyncHandle>,
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

    // Fire-and-forget: flush comment actions immediately
    if let Err(e) = sync_handle.flush_comments().await {
        eprintln!("[comment] Failed to send flush signal: {}", e);
    }

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

/// Input for delete_comment command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCommentInput {
    /// Merge request ID (local database ID).
    pub mr_id: i64,
    /// Comment ID to delete.
    pub comment_id: i64,
}

/// Delete a comment from a merge request.
///
/// For local-only comments (negative ID): deletes from DB directly and removes any pending sync action.
/// For synced comments (positive ID): deletes from local DB optimistically and enqueues a DeleteComment action.
///
/// # Arguments
/// * `input` - Delete details (mr_id, comment_id)
#[tauri::command]
pub async fn delete_comment(
    pool: State<'_, DbPool>,
    sync_handle: State<'_, SyncHandle>,
    input: DeleteCommentInput,
) -> Result<(), AppError> {
    if input.comment_id < 0 {
        // Local-only comment: delete from DB and remove pending sync action
        sqlx::query("DELETE FROM comments WHERE id = ? AND mr_id = ?")
            .bind(input.comment_id)
            .bind(input.mr_id)
            .execute(pool.inner())
            .await?;

        // Remove any pending sync queue entry referencing this local comment
        sqlx::query("DELETE FROM sync_queue WHERE local_reference_id = ? AND status = 'pending'")
            .bind(input.comment_id)
            .execute(pool.inner())
            .await?;
    } else {
        // Synced comment: look up MR info for the API call
        let mr_info = get_mr_info(pool.inner(), input.mr_id).await?;

        // Delete from local DB optimistically
        sqlx::query("DELETE FROM comments WHERE id = ? AND mr_id = ?")
            .bind(input.comment_id)
            .bind(input.mr_id)
            .execute(pool.inner())
            .await?;

        // Enqueue DeleteComment action for GitLab API
        let payload = serde_json::to_string(&DeleteCommentPayload {
            project_id: mr_info.project_id,
            mr_iid: mr_info.iid,
            note_id: input.comment_id,
        })?;

        sync_queue::enqueue_action(
            pool.inner(),
            EnqueueInput {
                mr_id: input.mr_id,
                action_type: ActionType::DeleteComment,
                payload,
                local_reference_id: None,
            },
        )
        .await?;

        // Fire-and-forget: flush comment actions immediately
        if let Err(e) = sync_handle.flush_comments().await {
            eprintln!("[comment] Failed to send flush signal: {}", e);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_generate_local_id_is_negative() {
        let id = generate_local_id();
        assert!(id < 0, "Local ID should be negative");
    }

    #[test]
    fn test_generate_local_id_unique_in_tight_loop() {
        let mut ids = HashSet::new();
        for _ in 0..100 {
            let id = generate_local_id();
            assert!(id < 0, "Local ID should be negative, got {}", id);
            assert!(ids.insert(id), "Duplicate local ID detected: {}", id);
        }
        assert_eq!(ids.len(), 100);
    }

    #[test]
    fn test_generate_local_id_unique_across_threads() {
        use std::thread;

        let mut handles = vec![];

        for _ in 0..2 {
            handles.push(thread::spawn(move || {
                let mut local_ids = Vec::with_capacity(10);
                for _ in 0..10 {
                    local_ids.push(generate_local_id());
                }
                local_ids
            }));
        }

        let mut all_ids = HashSet::new();
        for handle in handles {
            let thread_ids = handle.join().unwrap();
            for id in thread_ids {
                assert!(id < 0, "Local ID should be negative, got {}", id);
                assert!(all_ids.insert(id), "Duplicate local ID across threads: {}", id);
            }
        }
        assert_eq!(all_ids.len(), 20);
    }
}
