//! REST API routes for the companion server.
//!
//! These routes expose MR read operations over HTTP, mirroring the Tauri commands
//! so the mobile web frontend can access the same data via fetch() instead of invoke().

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::sync_action::ActionType;
use crate::models::{Comment, Diff, DiffFile, GitLabInstance, MergeRequest, MrReviewer};
use crate::services::companion_server::CompanionState;
use crate::services::sync_queue::{self, ApprovalPayload, EnqueueInput};
use axum::extract::{Path, Query, State};
use sqlx::Row;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

// ── Error handling ───────────────────────────────────────────────────────────

/// JSON error response matching AppError shape for the frontend.
#[derive(Serialize)]
struct ApiError {
    code: String,
    message: String,
}

/// Wrapper to make AppError usable as an axum error response.
struct ApiErr(AppError);

impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        let (status, code) = match &self.0 {
            AppError::NotFound { .. } => (StatusCode::NOT_FOUND, "NOT_FOUND"),
            AppError::InvalidInput { .. } => (StatusCode::BAD_REQUEST, "INVALID_INPUT"),
            AppError::Authentication { .. } | AppError::AuthenticationExpired { .. } => {
                (StatusCode::UNAUTHORIZED, "UNAUTHORIZED")
            }
            _ => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
        };
        (
            status,
            Json(ApiError {
                code: code.to_string(),
                message: self.0.to_string(),
            }),
        )
            .into_response()
    }
}

impl From<AppError> for ApiErr {
    fn from(err: AppError) -> Self {
        Self(err)
    }
}

impl From<sqlx::Error> for ApiErr {
    fn from(err: sqlx::Error) -> Self {
        Self(AppError::from(err))
    }
}

// ── Re-use DTOs from command modules ─────────────────────────────────────────

use crate::commands::approval::ApprovalStatus;
use crate::commands::comments::CommentResponse;
use crate::commands::mr::{
    DiffFileSummary, DiffHunk, DiffHunksResponse, DiffRefsResponse, DiffSummary,
    MergeRequestDetail, MergeRequestListItem,
};
use crate::commands::settings::AppSettings;
use crate::services::sync_engine::{SyncEngine, SyncLogEntry};

// ── Query parameter types ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct MrListQuery {
    instance_id: i64,
    state: Option<String>,
    search: Option<String>,
}

#[derive(Deserialize)]
struct HunksQuery {
    start: Option<usize>,
    count: Option<usize>,
}

#[derive(Deserialize)]
struct FileContentQuery {
    sha: String,
}

#[derive(Deserialize)]
struct FileContentDirectQuery {
    #[serde(rename = "instanceId")]
    instance_id: i64,
    #[serde(rename = "projectId")]
    project_id: i64,
    #[serde(rename = "filePath")]
    file_path: String,
    sha: String,
}


// ── Instance response (safe — omits token) ───────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceResponse {
    id: i64,
    url: String,
    name: Option<String>,
    has_token: bool,
    created_at: i64,
    authenticated_username: Option<String>,
}

impl From<GitLabInstance> for InstanceResponse {
    fn from(inst: GitLabInstance) -> Self {
        Self {
            id: inst.id,
            url: inst.url,
            name: inst.name,
            has_token: inst.token.is_some(),
            created_at: inst.created_at,
            authenticated_username: inst.authenticated_username,
        }
    }
}

// ── Route builder ────────────────────────────────────────────────────────────

/// Build the MR read API routes.
///
/// All routes require authentication (the auth middleware is applied
/// in companion_server.rs at the router level).
pub fn mr_api_routes() -> Router<CompanionState> {
    Router::new()
        .route("/api/instances", get(get_instances))
        .route("/api/merge-requests", get(get_merge_requests))
        .route("/api/merge-requests/{id}", get(get_merge_request_detail))
        .route("/api/merge-requests/{id}/files", get(get_diff_files))
        .route(
            "/api/merge-requests/{mr_id}/files/{file_path}/hunks",
            get(get_diff_hunks),
        )
        .route(
            "/api/merge-requests/{mr_id}/files/{file_path}/content",
            get(get_file_content),
        )
        .route(
            "/api/merge-requests/{id}/comments",
            get(get_comments),
        )
        .route(
            "/api/merge-requests/{id}/reviewers",
            get(get_reviewers),
        )
        .route(
            "/api/merge-requests/{id}/diff-refs",
            get(get_diff_refs),
        )
        .route(
            "/api/merge-requests/{id}/file-comments",
            get(get_file_comments),
        )
        .route("/api/file-content", get(get_file_content_direct))
        .route("/api/my-merge-requests", get(get_my_merge_requests))
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// GET /api/instances — list GitLab instances (token omitted).
async fn get_instances(
    State(state): State<CompanionState>,
) -> Result<Json<Vec<InstanceResponse>>, ApiErr> {
    let instances: Vec<GitLabInstance> = sqlx::query_as(
        "SELECT id, url, name, token, created_at, authenticated_username FROM gitlab_instances ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        instances.into_iter().map(InstanceResponse::from).collect(),
    ))
}

/// GET /api/merge-requests?instance_id=X — list merge requests.
async fn get_merge_requests(
    State(app_state): State<CompanionState>,
    Query(params): Query<MrListQuery>,
) -> Result<Json<Vec<MergeRequestListItem>>, ApiErr> {
    let instance_id = params.instance_id;
    let db = &app_state.db;

    let mut query = String::from(
        r#"
        SELECT
            mr.id, mr.instance_id, mr.iid, mr.project_id,
            COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
            mr.title, mr.description,
            mr.author_username, mr.source_branch, mr.target_branch, mr.state,
            mr.web_url, mr.created_at, mr.updated_at, mr.merged_at,
            mr.approval_status, mr.approvals_required, mr.approvals_count,
            mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved,
            mr.head_pipeline_status
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.instance_id = $1
          AND mr.author_username != COALESCE(
              (SELECT authenticated_username FROM gitlab_instances WHERE id = mr.instance_id),
              ''
          )
        "#,
    );

    let state_filter = params.state.as_deref();
    if let Some(s) = state_filter {
        if s != "all" {
            query.push_str(" AND mr.state = $2");
        }
    }

    let has_search = params.search.is_some();
    let search_pattern = params.search.map(|s| format!("%{}%", s));

    if has_search {
        let search_param = if state_filter.is_none_or(|s| s == "all") {
            "$2"
        } else {
            "$3"
        };
        query.push_str(&format!(
            " AND (mr.title LIKE {} OR mr.description LIKE {})",
            search_param, search_param
        ));
    }

    query.push_str(" ORDER BY mr.updated_at DESC");

    let mrs: Vec<MergeRequest> = match (state_filter, search_pattern.as_ref()) {
        (Some(state), Some(search)) if state != "all" => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(state)
                .bind(search)
                .fetch_all(db)
                .await?
        }
        (Some(state), None) if state != "all" => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(state)
                .fetch_all(db)
                .await?
        }
        (_, Some(search)) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(search)
                .fetch_all(db)
                .await?
        }
        _ => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .fetch_all(db)
                .await?
        }
    };

    let items = mrs.into_iter().map(MergeRequestListItem::from).collect();
    Ok(Json(items))
}

/// GET /api/my-merge-requests?instance_id=X — list MRs authored by the authenticated user.
async fn get_my_merge_requests(
    State(app_state): State<CompanionState>,
    Query(params): Query<MrListQuery>,
) -> Result<Json<Vec<MergeRequestListItem>>, ApiErr> {
    let instance_id = params.instance_id;
    let db = &app_state.db;

    // Get the authenticated username for this instance
    let username: Option<String> = sqlx::query_scalar(
        "SELECT authenticated_username FROM gitlab_instances WHERE id = $1",
    )
    .bind(instance_id)
    .fetch_optional(db)
    .await?
    .flatten();

    let username = username.ok_or_else(|| {
        ApiErr::from(AppError::not_found(
            "No authenticated username found. Please re-authenticate.",
        ))
    })?;

    let mrs: Vec<MergeRequest> = sqlx::query_as(
        r#"
        SELECT
            mr.id, mr.instance_id, mr.iid, mr.project_id,
            COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
            mr.title, mr.description,
            mr.author_username, mr.source_branch, mr.target_branch, mr.state,
            mr.web_url, mr.created_at, mr.updated_at, mr.merged_at,
            mr.approval_status, mr.approvals_required, mr.approvals_count,
            mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved,
            mr.head_pipeline_status
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.instance_id = $1 AND mr.state = 'opened' AND mr.author_username = $2
        ORDER BY mr.updated_at DESC
        "#,
    )
    .bind(instance_id)
    .bind(&username)
    .fetch_all(db)
    .await?;

    let items = mrs.into_iter().map(MergeRequestListItem::from).collect();
    Ok(Json(items))
}

/// GET /api/merge-requests/:id — MR detail with diff summary.
async fn get_merge_request_detail(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<MergeRequestDetail>, ApiErr> {
    let mr: Option<MergeRequest> = sqlx::query_as(
        r#"
        SELECT
            mr.id, mr.instance_id, mr.iid, mr.project_id,
            COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
            mr.title, mr.description,
            mr.author_username, mr.source_branch, mr.target_branch, mr.state,
            mr.web_url, mr.created_at, mr.updated_at, mr.merged_at,
            mr.approval_status, mr.approvals_required, mr.approvals_count,
            mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved,
            mr.head_pipeline_status
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.id = $1
        "#,
    )
    .bind(mr_id)
    .fetch_optional(&state.db)
    .await?;

    let mr = mr.ok_or_else(|| {
        ApiErr::from(AppError::not_found_with_id(
            "MergeRequest",
            mr_id.to_string(),
        ))
    })?;

    let diff: Option<Diff> = sqlx::query_as(
        r#"
        SELECT mr_id, content, base_sha, head_sha, start_sha,
               file_count, additions, deletions, cached_at
        FROM diffs WHERE mr_id = $1
        "#,
    )
    .bind(mr_id)
    .fetch_optional(&state.db)
    .await?;

    let diff_files: Vec<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files WHERE mr_id = $1 ORDER BY file_position
        "#,
    )
    .bind(mr_id)
    .fetch_all(&state.db)
    .await?;

    let diff_summary = diff.map(|d| DiffSummary {
        file_count: d.file_count,
        additions: d.additions,
        deletions: d.deletions,
        files: diff_files.into_iter().map(DiffFileSummary::from).collect(),
    });

    let pending_actions: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) as count FROM sync_queue WHERE mr_id = $1 AND status IN ('pending', 'syncing')",
    )
    .bind(mr_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(MergeRequestDetail {
        mr: MergeRequestListItem::from(mr),
        diff_summary,
        pending_actions: pending_actions.0,
    }))
}

/// GET /api/merge-requests/:id/files — diff file list.
async fn get_diff_files(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<Vec<DiffFile>>, ApiErr> {
    let diff_files: Vec<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files WHERE mr_id = $1 ORDER BY file_position
        "#,
    )
    .bind(mr_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(diff_files))
}

/// GET /api/merge-requests/:mr_id/files/:file_path/hunks?start=0&count=10 — paginated diff hunks.
async fn get_diff_hunks(
    State(state): State<CompanionState>,
    Path((mr_id, file_path)): Path<(i64, String)>,
    Query(params): Query<HunksQuery>,
) -> Result<Json<DiffHunksResponse>, ApiErr> {
    let file: Option<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files WHERE mr_id = $1 AND new_path = $2
        "#,
    )
    .bind(mr_id)
    .bind(&file_path)
    .fetch_optional(&state.db)
    .await?;

    let file = file.ok_or_else(|| {
        ApiErr::from(AppError::not_found(format!(
            "DiffFile for path: {}",
            file_path
        )))
    })?;

    let diff_content = file.diff_content.unwrap_or_default();
    let all_hunks = crate::commands::mr::parse_unified_diff_public(&diff_content);
    let total_hunks = all_hunks.len();

    let start = params.start.unwrap_or(0);
    let count = params.count.unwrap_or(total_hunks);
    let end = (start + count).min(total_hunks);
    let hunks: Vec<DiffHunk> = all_hunks.into_iter().skip(start).take(end - start).collect();
    let has_more = end < total_hunks;

    Ok(Json(DiffHunksResponse {
        file_path: file.new_path,
        hunks,
        start_index: start,
        total_hunks,
        has_more,
    }))
}

/// GET /api/merge-requests/:mr_id/files/:file_path/content?sha=X — file content.
async fn get_file_content(
    State(state): State<CompanionState>,
    Path((mr_id, file_path)): Path<(i64, String)>,
    Query(params): Query<FileContentQuery>,
) -> Result<Json<String>, ApiErr> {
    // Look up instance_id and project_id from the MR
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT instance_id, project_id FROM merge_requests WHERE id = $1",
    )
    .bind(mr_id)
    .fetch_optional(&state.db)
    .await?;

    let (instance_id, project_id) = row.ok_or_else(|| {
        ApiErr::from(AppError::not_found_with_id(
            "MergeRequest",
            mr_id.to_string(),
        ))
    })?;

    // Fetch from GitLab
    let instance: Option<GitLabInstance> = sqlx::query_as(
        "SELECT id, url, name, token, created_at, authenticated_username FROM gitlab_instances WHERE id = $1",
    )
    .bind(instance_id)
    .fetch_optional(&state.db)
    .await?;

    let instance = instance.ok_or_else(|| {
        ApiErr::from(AppError::not_found_with_id(
            "GitLabInstance",
            instance_id.to_string(),
        ))
    })?;

    let token = instance.token.ok_or_else(|| {
        ApiErr::from(AppError::authentication(
            "No token configured for GitLab instance",
        ))
    })?;

    use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
    let client = GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token,
        timeout_secs: 30,
    })
    .map_err(ApiErr::from)?;

    let content = client
        .get_file_content(project_id, &file_path, &params.sha)
        .await
        .map_err(ApiErr::from)?;

    Ok(Json(content))
}

/// GET /api/merge-requests/:id/comments — comments for an MR.
async fn get_comments(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<Vec<CommentResponse>>, ApiErr> {
    let comments: Vec<Comment> = sqlx::query_as(
        r#"
        SELECT id, mr_id, discussion_id, parent_id, author_username, body,
               file_path, old_line, new_line, line_type, resolved, resolvable,
               system, created_at, updated_at, cached_at, is_local
        FROM comments WHERE mr_id = ? ORDER BY created_at ASC
        "#,
    )
    .bind(mr_id)
    .fetch_all(&state.db)
    .await?;

    let responses = to_comment_responses(&state.db, comments)
        .await
        .map_err(ApiErr::from)?;

    Ok(Json(responses))
}

/// GET /api/merge-requests/:id/reviewers — reviewers for an MR.
async fn get_reviewers(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<Vec<MrReviewer>>, ApiErr> {
    let reviewers: Vec<MrReviewer> = sqlx::query_as(
        r#"
        SELECT mr_id, username, status, avatar_url, cached_at
        FROM mr_reviewers WHERE mr_id = ? ORDER BY username
        "#,
    )
    .bind(mr_id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(reviewers))
}

/// GET /api/merge-requests/:id/diff-refs — diff SHA values for an MR.
async fn get_diff_refs(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<DiffRefsResponse>, ApiErr> {
    let diff: Option<crate::models::Diff> = sqlx::query_as(
        r#"
        SELECT mr_id, content, base_sha, head_sha, start_sha,
               file_count, additions, deletions, cached_at
        FROM diffs WHERE mr_id = $1
        "#,
    )
    .bind(mr_id)
    .fetch_optional(&state.db)
    .await?;

    let diff = diff.ok_or_else(|| ApiErr::from(AppError::not_found_with_id("Diff", mr_id.to_string())))?;

    Ok(Json(DiffRefsResponse {
        base_sha: diff.base_sha,
        head_sha: diff.head_sha,
        start_sha: diff.start_sha,
    }))
}

/// GET /api/merge-requests/:id/file-comments?filePath=X — comments for a specific file.
async fn get_file_comments(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<Json<Vec<CommentResponse>>, ApiErr> {
    let file_path = params.get("filePath").ok_or_else(|| {
        ApiErr::from(AppError::invalid_input("filePath query parameter is required"))
    })?;

    let comments: Vec<Comment> = sqlx::query_as(
        r#"
        SELECT id, mr_id, discussion_id, parent_id, author_username, body,
               file_path, old_line, new_line, line_type, resolved, resolvable,
               system, created_at, updated_at, cached_at, is_local
        FROM comments WHERE mr_id = ? AND file_path = ? ORDER BY created_at ASC
        "#,
    )
    .bind(mr_id)
    .bind(file_path)
    .fetch_all(&state.db)
    .await?;

    let responses = to_comment_responses(&state.db, comments)
        .await
        .map_err(ApiErr::from)?;

    Ok(Json(responses))
}

/// GET /api/file-content?instanceId=X&projectId=X&filePath=X&sha=X — file content by SHA.
///
/// Direct file content fetch matching the Tauri command signature.
/// Unlike the MR-scoped endpoint, this uses instanceId + projectId directly.
async fn get_file_content_direct(
    State(state): State<CompanionState>,
    Query(params): Query<FileContentDirectQuery>,
) -> Result<Json<String>, ApiErr> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        "SELECT id, url, name, token, created_at, authenticated_username FROM gitlab_instances WHERE id = $1",
    )
    .bind(params.instance_id)
    .fetch_optional(&state.db)
    .await?;

    let instance = instance.ok_or_else(|| {
        ApiErr::from(AppError::not_found_with_id(
            "GitLabInstance",
            params.instance_id.to_string(),
        ))
    })?;

    let token = instance.token.ok_or_else(|| {
        ApiErr::from(AppError::authentication(
            "No token configured for GitLab instance",
        ))
    })?;

    use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
    let client = GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token,
        timeout_secs: 30,
    })
    .map_err(ApiErr::from)?;

    let content = client
        .get_file_content(params.project_id, &params.file_path, &params.sha)
        .await
        .map_err(ApiErr::from)?;

    Ok(Json(content))
}

// ── Comment helpers (mirrored from commands::comments) ───────────────────────

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

async fn get_comment_sync_status(pool: &DbPool, comment_id: i64) -> Result<String, AppError> {
    use sqlx::Row;
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

// ── Approval, sync & settings routes ─────────────────────────────────────────

/// Build the approval, sync, and settings API routes.
pub fn action_api_routes() -> Router<CompanionState> {
    Router::new()
        // Approval
        .route(
            "/api/merge-requests/{id}/approve",
            post(approve_mr_handler),
        )
        .route(
            "/api/merge-requests/{id}/unapprove",
            post(unapprove_mr_handler),
        )
        .route(
            "/api/merge-requests/{id}/approval-status",
            get(get_approval_status_handler),
        )
        // Sync
        .route("/api/sync/status", get(get_sync_status_handler))
        .route("/api/sync/trigger", post(trigger_sync_handler))
        // Settings (read-only)
        .route("/api/settings", get(get_settings_handler))
}

// ── Approval handlers ────────────────────────────────────────────────────────

/// POST /api/merge-requests/:id/approve — approve an MR.
async fn approve_mr_handler(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<()>, ApiErr> {
    let (project_id, mr_iid) = get_mr_ids(&state.db, mr_id).await?;

    // Optimistic local update
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
    .execute(&state.db)
    .await?;

    // Queue for sync
    let payload = serde_json::to_string(&ApprovalPayload {
        project_id,
        mr_iid,
    })
    .map_err(|e| ApiErr(AppError::internal(e.to_string())))?;

    sync_queue::enqueue_action(
        &state.db,
        EnqueueInput {
            mr_id,
            action_type: ActionType::Approve,
            payload,
            local_reference_id: None,
        },
    )
    .await
    .map_err(ApiErr::from)?;

    // Fire-and-forget: flush approval actions immediately
    let _ = state.sync_handle.flush_approvals().await;

    Ok(Json(()))
}

/// POST /api/merge-requests/:id/unapprove — remove approval from an MR.
async fn unapprove_mr_handler(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<()>, ApiErr> {
    let (project_id, mr_iid) = get_mr_ids(&state.db, mr_id).await?;

    // Optimistic local update
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
    .execute(&state.db)
    .await?;

    // Queue for sync (payload includes "action": "unapprove" for processor)
    let payload = serde_json::to_string(&serde_json::json!({
        "project_id": project_id,
        "mr_iid": mr_iid,
        "action": "unapprove"
    }))
    .map_err(|e| ApiErr(AppError::internal(e.to_string())))?;

    sync_queue::enqueue_action(
        &state.db,
        EnqueueInput {
            mr_id,
            action_type: ActionType::Approve,
            payload,
            local_reference_id: None,
        },
    )
    .await
    .map_err(ApiErr::from)?;

    let _ = state.sync_handle.flush_approvals().await;

    Ok(Json(()))
}

/// GET /api/merge-requests/:id/approval-status — get approval status.
async fn get_approval_status_handler(
    State(state): State<CompanionState>,
    Path(mr_id): Path<i64>,
) -> Result<Json<ApprovalStatus>, ApiErr> {
    let row = sqlx::query(
        r#"
        SELECT approval_status, approvals_count, approvals_required
        FROM merge_requests
        WHERE id = ?
        "#,
    )
    .bind(mr_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiErr::from(AppError::not_found_with_id("MergeRequest", mr_id.to_string())))?;

    Ok(Json(ApprovalStatus {
        status: row.get::<Option<String>, _>("approval_status"),
        approvals_count: row.get::<Option<i64>, _>("approvals_count").unwrap_or(0),
        approvals_required: row.get::<Option<i64>, _>("approvals_required").unwrap_or(0),
    }))
}

/// Helper: look up project_id and iid for a merge request.
async fn get_mr_ids(pool: &DbPool, mr_id: i64) -> Result<(i64, i64), ApiErr> {
    let row = sqlx::query("SELECT project_id, iid FROM merge_requests WHERE id = ?")
        .bind(mr_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiErr::from(AppError::not_found_with_id("MergeRequest", mr_id.to_string())))?;

    Ok((row.get("project_id"), row.get("iid")))
}

// ── Sync handlers ────────────────────────────────────────────────────────────

/// Sync status response (matches GetSyncStatusResponse from commands::sync).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatusResponse {
    is_syncing: bool,
    last_sync_time: Option<i64>,
    last_error: Option<String>,
    pending_actions: i64,
    failed_actions: i64,
    last_sync_mr_count: i64,
    recent_logs: Vec<SyncLogEntry>,
}

/// GET /api/sync/status — get sync engine status.
async fn get_sync_status_handler(
    State(state): State<CompanionState>,
) -> Result<Json<SyncStatusResponse>, ApiErr> {
    let (pending, failed) = sync_queue::get_action_counts(&state.db)
        .await
        .map_err(ApiErr::from)?;

    let engine = SyncEngine::new(state.db.clone(), state.app_handle.clone());
    let recent_logs = engine.get_sync_log(50).await.map_err(ApiErr::from)?;

    let last_sync_time = recent_logs
        .iter()
        .find(|log| log.operation == "sync_complete" && log.status == "success")
        .map(|log| log.timestamp);

    let last_error = recent_logs
        .iter()
        .find(|log| log.status == "error")
        .and_then(|log| log.message.clone());

    let last_sync_mr_count = recent_logs
        .iter()
        .find(|log| log.operation == "sync_complete" && log.status == "success")
        .and_then(|log| {
            log.message.as_ref().and_then(|msg| {
                msg.split_whitespace()
                    .nth(1)
                    .and_then(|s| s.parse::<i64>().ok())
            })
        })
        .unwrap_or(0);

    Ok(Json(SyncStatusResponse {
        is_syncing: false,
        last_sync_time,
        last_error,
        pending_actions: pending,
        failed_actions: failed,
        last_sync_mr_count,
        recent_logs,
    }))
}

/// POST /api/sync/trigger — trigger a manual sync.
async fn trigger_sync_handler(
    State(state): State<CompanionState>,
) -> Result<Json<()>, ApiErr> {
    state.sync_handle.trigger_sync().await.map_err(ApiErr::from)?;
    Ok(Json(()))
}

// ── Settings handler ─────────────────────────────────────────────────────────

/// GET /api/settings — get app settings (read-only).
async fn get_settings_handler(
    State(state): State<CompanionState>,
) -> Result<Json<AppSettings>, ApiErr> {
    let settings = crate::commands::settings::load_settings(&state.app_handle)
        .await
        .map_err(ApiErr::from)?;
    Ok(Json(settings))
}
