//! Merge request commands for reading cached MR data.
//!
//! These commands read from local SQLite storage for instant access.
//! No network requests are made - all data comes from the sync cache.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::{Diff, DiffFile, GitLabInstance, MergeRequest};
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Filter options for get_merge_requests command.
#[derive(Debug, Deserialize, Default)]
pub struct MergeRequestFilter {
    /// Filter by state: opened, merged, closed, or all.
    pub state: Option<String>,

    /// Filter by scope: authored, reviewing, or all.
    pub scope: Option<String>,

    /// Search in title and description.
    pub search: Option<String>,
}

/// Response item for get_merge_requests command.
///
/// This is a simplified view of MergeRequest with parsed JSON fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequestListItem {
    pub id: i64,
    pub instance_id: i64,
    pub iid: i64,
    pub project_id: i64,
    pub project_name: String,
    pub title: String,
    pub description: Option<String>,
    pub author_username: String,
    pub source_branch: String,
    pub target_branch: String,
    pub state: String,
    pub web_url: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub approval_status: Option<String>,
    pub approvals_count: Option<i64>,
    pub approvals_required: Option<i64>,
    pub labels: Vec<String>,
    pub reviewers: Vec<String>,
    pub cached_at: i64,
    pub user_has_approved: bool,
    pub head_pipeline_status: Option<String>,
}

impl From<MergeRequest> for MergeRequestListItem {
    fn from(mr: MergeRequest) -> Self {
        // Parse JSON fields first before consuming mr
        let labels = mr.labels_vec();
        let reviewers = mr.reviewers_vec();

        Self {
            id: mr.id,
            instance_id: mr.instance_id,
            iid: mr.iid,
            project_id: mr.project_id,
            project_name: mr.project_name,
            title: mr.title,
            description: mr.description,
            author_username: mr.author_username,
            source_branch: mr.source_branch,
            target_branch: mr.target_branch,
            state: mr.state,
            web_url: mr.web_url,
            created_at: mr.created_at,
            updated_at: mr.updated_at,
            approval_status: mr.approval_status,
            approvals_count: mr.approvals_count,
            approvals_required: mr.approvals_required,
            labels,
            reviewers,
            cached_at: mr.cached_at,
            user_has_approved: mr.user_has_approved,
            head_pipeline_status: mr.head_pipeline_status,
        }
    }
}

/// Query all opened MRs for an instance from the local SQLite cache.
///
/// This is a shared function used by both the `get_merge_requests` command
/// and the sync engine (for emitting `mrs-synced` events).
///
/// Returns all opened MRs without filtering by author or search.
pub async fn query_all_open_mrs(
    pool: &DbPool,
    instance_id: i64,
) -> Result<Vec<MergeRequestListItem>, AppError> {
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
        WHERE mr.instance_id = $1 AND mr.state = 'opened'
        ORDER BY mr.updated_at DESC
        "#,
    )
    .bind(instance_id)
    .fetch_all(pool)
    .await?;

    Ok(mrs.into_iter().map(MergeRequestListItem::from).collect())
}

/// Get cached merge requests from local storage.
///
/// Returns instantly from the local SQLite cache.
/// No network requests are made.
///
/// # Arguments
/// * `instance_id` - GitLab instance to query
/// * `filter` - Optional filter for state, scope, and search
///
/// # Returns
/// Array of merge requests, empty if not yet synced.
#[tauri::command]
pub async fn get_merge_requests(
    pool: State<'_, DbPool>,
    instance_id: i64,
    filter: Option<MergeRequestFilter>,
) -> Result<Vec<MergeRequestListItem>, AppError> {
    let filter = filter.unwrap_or_default();

    // Build the query dynamically based on filters
    // LEFT JOIN with projects table for human-readable project names,
    // falling back to the URL-derived project_name on merge_requests
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

    // Add state filter if specified and not 'all'
    let state_filter = filter.state.as_deref();
    if let Some(state) = state_filter {
        if state != "all" {
            query.push_str(" AND mr.state = $2");
        }
    }

    // Add search filter if specified
    let has_search = filter.search.is_some();
    let search_pattern = filter.search.map(|s| format!("%{}%", s));

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

    // Order by updated_at descending for most recent first
    query.push_str(" ORDER BY mr.updated_at DESC");

    // Execute the query with appropriate bindings
    let mrs: Vec<MergeRequest> = match (state_filter, search_pattern.as_ref()) {
        (Some(state), Some(search)) if state != "all" => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(state)
                .bind(search)
                .fetch_all(pool.inner())
                .await?
        }
        (Some(state), None) if state != "all" => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(state)
                .fetch_all(pool.inner())
                .await?
        }
        (_, Some(search)) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(search)
                .fetch_all(pool.inner())
                .await?
        }
        _ => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .fetch_all(pool.inner())
                .await?
        }
    };

    // Convert to response items with parsed JSON fields
    let items = mrs.into_iter().map(MergeRequestListItem::from).collect();

    Ok(items)
}

/// Get merge requests authored by the authenticated user.
///
/// Queries open MRs where author_username matches the instance's authenticated_username.
/// Returns the same MergeRequestListItem DTO as get_merge_requests.
///
/// # Arguments
/// * `instance_id` - GitLab instance to query
///
/// # Returns
/// Array of authored merge requests.
#[tauri::command]
pub async fn list_my_merge_requests(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Vec<MergeRequestListItem>, AppError> {
    // Get the authenticated username for this instance
    let username: Option<String> =
        sqlx::query_scalar("SELECT authenticated_username FROM gitlab_instances WHERE id = ?")
            .bind(instance_id)
            .fetch_optional(pool.inner())
            .await?
            .flatten();

    let username = username.ok_or_else(|| {
        AppError::not_found("No authenticated username found. Please re-authenticate.")
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
        WHERE mr.instance_id = ? AND mr.state = 'opened' AND mr.author_username = ?
        ORDER BY mr.updated_at DESC
        "#,
    )
    .bind(instance_id)
    .bind(&username)
    .fetch_all(pool.inner())
    .await?;

    let items = mrs.into_iter().map(MergeRequestListItem::from).collect();
    Ok(items)
}

/// Diff summary information for an MR.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub file_count: i64,
    pub additions: i64,
    pub deletions: i64,
    pub files: Vec<DiffFileSummary>,
}

/// Summary of a single file in a diff.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileSummary {
    pub new_path: String,
    pub old_path: Option<String>,
    pub change_type: String,
    pub additions: i64,
    pub deletions: i64,
}

impl From<DiffFile> for DiffFileSummary {
    fn from(f: DiffFile) -> Self {
        Self {
            new_path: f.new_path,
            old_path: f.old_path,
            change_type: f.change_type,
            additions: f.additions,
            deletions: f.deletions,
        }
    }
}

/// Response for get_merge_request_detail command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequestDetail {
    pub mr: MergeRequestListItem,
    pub diff_summary: Option<DiffSummary>,
    pub pending_actions: i64,
}

/// Get detailed MR information including diff summary.
///
/// # Arguments
/// * `mr_id` - The MR ID to retrieve
///
/// # Returns
/// MR details with diff summary and pending action count.
#[tauri::command]
pub async fn get_merge_request_detail(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<MergeRequestDetail, AppError> {
    // Fetch the MR with project name from projects table
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
    .fetch_optional(pool.inner())
    .await?;

    let mr = mr.ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;

    // Fetch the diff summary
    let diff: Option<Diff> = sqlx::query_as(
        r#"
        SELECT mr_id, content, base_sha, head_sha, start_sha,
               file_count, additions, deletions, cached_at
        FROM diffs
        WHERE mr_id = $1
        "#,
    )
    .bind(mr_id)
    .fetch_optional(pool.inner())
    .await?;

    // Fetch diff files for the summary
    let diff_files: Vec<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files
        WHERE mr_id = $1
        ORDER BY file_position
        "#,
    )
    .bind(mr_id)
    .fetch_all(pool.inner())
    .await?;

    // Build diff summary
    let diff_summary = diff.map(|d| DiffSummary {
        file_count: d.file_count,
        additions: d.additions,
        deletions: d.deletions,
        files: diff_files.into_iter().map(DiffFileSummary::from).collect(),
    });

    // Count pending sync actions for this MR
    let pending_actions: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) as count
        FROM sync_queue
        WHERE mr_id = $1 AND status IN ('pending', 'syncing')
        "#,
    )
    .bind(mr_id)
    .fetch_one(pool.inner())
    .await?;

    Ok(MergeRequestDetail {
        mr: MergeRequestListItem::from(mr),
        diff_summary,
        pending_actions: pending_actions.0,
    })
}

/// Response for get_diff_content command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffContentResponse {
    pub base_sha: String,
    pub head_sha: String,
    pub content: String,
}

/// Response for get_diff_refs command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRefsResponse {
    pub base_sha: String,
    pub head_sha: String,
    pub start_sha: String,
}

/// Get the full diff content for an MR.
///
/// # Arguments
/// * `mr_id` - The MR ID
/// * `file_path` - Optional: specific file only
///
/// # Returns
/// The unified diff content.
#[tauri::command]
pub async fn get_diff_content(
    pool: State<'_, DbPool>,
    mr_id: i64,
    file_path: Option<String>,
) -> Result<DiffContentResponse, AppError> {
    if let Some(path) = file_path {
        // Get diff for a specific file
        let file: Option<DiffFile> = sqlx::query_as(
            r#"
            SELECT id, mr_id, old_path, new_path, change_type,
                   additions, deletions, file_position, diff_content
            FROM diff_files
            WHERE mr_id = $1 AND new_path = $2
            "#,
        )
        .bind(mr_id)
        .bind(&path)
        .fetch_optional(pool.inner())
        .await?;

        let file =
            file.ok_or_else(|| AppError::not_found(format!("DiffFile for path: {}", path)))?;

        // Get the diff metadata for SHA info
        let diff: Option<Diff> = sqlx::query_as(
            r#"
            SELECT mr_id, content, base_sha, head_sha, start_sha,
                   file_count, additions, deletions, cached_at
            FROM diffs
            WHERE mr_id = $1
            "#,
        )
        .bind(mr_id)
        .fetch_optional(pool.inner())
        .await?;

        let diff = diff.ok_or_else(|| AppError::not_found_with_id("Diff", mr_id.to_string()))?;

        Ok(DiffContentResponse {
            base_sha: diff.base_sha,
            head_sha: diff.head_sha,
            content: file.diff_content.unwrap_or_default(),
        })
    } else {
        // Get the full diff
        let diff: Option<Diff> = sqlx::query_as(
            r#"
            SELECT mr_id, content, base_sha, head_sha, start_sha,
                   file_count, additions, deletions, cached_at
            FROM diffs
            WHERE mr_id = $1
            "#,
        )
        .bind(mr_id)
        .fetch_optional(pool.inner())
        .await?;

        let diff = diff.ok_or_else(|| AppError::not_found_with_id("Diff", mr_id.to_string()))?;

        Ok(DiffContentResponse {
            base_sha: diff.base_sha,
            head_sha: diff.head_sha,
            content: diff.content,
        })
    }
}

/// Get diff refs (SHA values) for a merge request.
///
/// # Arguments
/// * `mr_id` - The MR ID
///
/// # Returns
/// The base, head, and start SHA values for the diff.
#[tauri::command]
pub async fn get_diff_refs(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<DiffRefsResponse, AppError> {
    let diff: Option<Diff> = sqlx::query_as(
        r#"
        SELECT mr_id, content, base_sha, head_sha, start_sha,
               file_count, additions, deletions, cached_at
        FROM diffs
        WHERE mr_id = $1
        "#,
    )
    .bind(mr_id)
    .fetch_optional(pool.inner())
    .await?;

    let diff = diff.ok_or_else(|| AppError::not_found_with_id("Diff", mr_id.to_string()))?;

    Ok(DiffRefsResponse {
        base_sha: diff.base_sha,
        head_sha: diff.head_sha,
        start_sha: diff.start_sha,
    })
}

/// A line in a diff hunk.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub line_type: String,
    pub content: String,
    pub old_line_number: Option<i64>,
    pub new_line_number: Option<i64>,
}

/// A hunk in a diff.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: i64,
    pub old_count: i64,
    pub new_start: i64,
    pub new_count: i64,
    pub lines: Vec<DiffLine>,
}

/// Response for get_diff_file command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileResponse {
    pub file_path: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    pub diff_hunks: Vec<DiffHunk>,
}

/// Metadata about a diff file for progressive loading.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileMetadata {
    pub file_path: String,
    pub hunk_count: usize,
    pub total_lines: usize,
    pub additions: i64,
    pub deletions: i64,
    pub is_large: bool,
}

/// Threshold for considering a diff "large" (lines).
const LARGE_DIFF_THRESHOLD: usize = 10_000;

/// Response for get_diff_hunks command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunksResponse {
    pub file_path: String,
    pub hunks: Vec<DiffHunk>,
    pub start_index: usize,
    pub total_hunks: usize,
    pub has_more: bool,
}

/// Get diff files for a merge request.
///
/// # Arguments
/// * `mr_id` - The MR ID
///
/// # Returns
/// List of diff files.
#[tauri::command]
pub async fn get_diff_files(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<Vec<DiffFile>, AppError> {
    let diff_files: Vec<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files
        WHERE mr_id = $1
        ORDER BY file_position
        "#,
    )
    .bind(mr_id)
    .fetch_all(pool.inner())
    .await?;

    Ok(diff_files)
}

/// Get diff content for a specific file with syntax highlighting.
///
/// # Arguments
/// * `mr_id` - The MR ID
/// * `file_path` - The file path to get diff for
///
/// # Returns
/// Parsed diff with hunks and syntax-highlighted lines.
#[tauri::command]
pub async fn get_diff_file(
    pool: State<'_, DbPool>,
    mr_id: i64,
    file_path: String,
) -> Result<DiffFileResponse, AppError> {
    // Get the diff file
    let file: Option<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files
        WHERE mr_id = $1 AND new_path = $2
        "#,
    )
    .bind(mr_id)
    .bind(&file_path)
    .fetch_optional(pool.inner())
    .await?;

    let file =
        file.ok_or_else(|| AppError::not_found(format!("DiffFile for path: {}", file_path)))?;

    // Parse the diff content into hunks
    let diff_content = file.diff_content.unwrap_or_default();
    let hunks = parse_unified_diff(&diff_content);

    // Note: Syntax highlighting will be added in T037-T039.
    // For now, we return the parsed hunks without highlighting tokens.

    Ok(DiffFileResponse {
        file_path: file.new_path,
        old_content: None, // Would require fetching from git or storing separately
        new_content: None,
        diff_hunks: hunks,
    })
}

/// Get metadata about a diff file without parsing all content.
///
/// Used for progressive loading to determine if a diff is large
/// and how many hunks need to be loaded.
///
/// # Arguments
/// * `mr_id` - The MR ID
/// * `file_path` - The file path to get metadata for
///
/// # Returns
/// Metadata including hunk count, total lines, and whether it's a large diff.
#[tauri::command]
pub async fn get_diff_file_metadata(
    pool: State<'_, DbPool>,
    mr_id: i64,
    file_path: String,
) -> Result<DiffFileMetadata, AppError> {
    // Get the diff file
    let file: Option<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files
        WHERE mr_id = $1 AND new_path = $2
        "#,
    )
    .bind(mr_id)
    .bind(&file_path)
    .fetch_optional(pool.inner())
    .await?;

    let file =
        file.ok_or_else(|| AppError::not_found(format!("DiffFile for path: {}", file_path)))?;

    // Parse just to count hunks and lines
    let diff_content = file.diff_content.unwrap_or_default();
    let hunks = parse_unified_diff(&diff_content);

    let total_lines: usize = hunks.iter().map(|h| h.lines.len()).sum();
    let hunk_count = hunks.len();
    let is_large = total_lines > LARGE_DIFF_THRESHOLD;

    Ok(DiffFileMetadata {
        file_path: file.new_path,
        hunk_count,
        total_lines,
        additions: file.additions,
        deletions: file.deletions,
        is_large,
    })
}

/// Get a range of diff hunks for progressive loading.
///
/// Used for large diffs to load hunks on demand as the user scrolls.
///
/// # Arguments
/// * `mr_id` - The MR ID
/// * `file_path` - The file path
/// * `start` - Starting hunk index (0-based)
/// * `count` - Number of hunks to fetch
///
/// # Returns
/// The requested hunks with pagination info.
#[tauri::command]
pub async fn get_diff_hunks(
    pool: State<'_, DbPool>,
    mr_id: i64,
    file_path: String,
    start: usize,
    count: usize,
) -> Result<DiffHunksResponse, AppError> {
    // Get the diff file
    let file: Option<DiffFile> = sqlx::query_as(
        r#"
        SELECT id, mr_id, old_path, new_path, change_type,
               additions, deletions, file_position, diff_content
        FROM diff_files
        WHERE mr_id = $1 AND new_path = $2
        "#,
    )
    .bind(mr_id)
    .bind(&file_path)
    .fetch_optional(pool.inner())
    .await?;

    let file =
        file.ok_or_else(|| AppError::not_found(format!("DiffFile for path: {}", file_path)))?;

    // Parse all hunks (we need to parse the full diff to extract a range)
    let diff_content = file.diff_content.unwrap_or_default();
    let all_hunks = parse_unified_diff(&diff_content);
    let total_hunks = all_hunks.len();

    // Extract the requested range
    let end = (start + count).min(total_hunks);
    let hunks: Vec<DiffHunk> = all_hunks
        .into_iter()
        .skip(start)
        .take(end - start)
        .collect();
    let has_more = end < total_hunks;

    Ok(DiffHunksResponse {
        file_path: file.new_path,
        hunks,
        start_index: start,
        total_hunks,
        has_more,
    })
}

/// Parse a unified diff into hunks (public alias for companion API).
pub fn parse_unified_diff_public(diff: &str) -> Vec<DiffHunk> {
    parse_unified_diff(diff)
}

/// Parse a unified diff into hunks.
///
/// This parses the standard unified diff format:
/// ```text
/// @@ -start,count +start,count @@
///  context line
/// -removed line
/// +added line
/// ```
fn parse_unified_diff(diff: &str) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<DiffHunk> = None;
    let mut old_line = 0i64;
    let mut new_line = 0i64;

    for line in diff.lines() {
        if line.starts_with("@@") {
            // Parse hunk header: @@ -old_start,old_count +new_start,new_count @@
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }

            if let Some((old_start, old_count, new_start, new_count)) = parse_hunk_header(line) {
                old_line = old_start;
                new_line = new_start;
                current_hunk = Some(DiffHunk {
                    old_start,
                    old_count,
                    new_start,
                    new_count,
                    lines: Vec::new(),
                });
            }
        } else if let Some(ref mut hunk) = current_hunk {
            let (line_type, content, old_ln, new_ln) =
                if let Some(stripped) = line.strip_prefix('+') {
                    let ln = new_line;
                    new_line += 1;
                    ("add", stripped.to_string(), None, Some(ln))
                } else if let Some(stripped) = line.strip_prefix('-') {
                    let ln = old_line;
                    old_line += 1;
                    ("remove", stripped.to_string(), Some(ln), None)
                } else if let Some(stripped) = line.strip_prefix(' ') {
                    let oln = old_line;
                    let nln = new_line;
                    old_line += 1;
                    new_line += 1;
                    ("context", stripped.to_string(), Some(oln), Some(nln))
                } else {
                    // Handle lines without prefix (shouldn't happen in valid diff)
                    continue;
                };

            hunk.lines.push(DiffLine {
                line_type: line_type.to_string(),
                content,
                old_line_number: old_ln,
                new_line_number: new_ln,
            });
        }
    }

    // Don't forget the last hunk
    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    hunks
}

/// Parse a hunk header line.
///
/// Format: `@@ -old_start,old_count +new_start,new_count @@`
/// or: `@@ -old_start +new_start @@` (count defaults to 1)
fn parse_hunk_header(line: &str) -> Option<(i64, i64, i64, i64)> {
    // Remove @@ from both ends
    let content = line.trim_start_matches("@@").trim_end_matches("@@").trim();

    // Split by space to get "-old,count" and "+new,count"
    let parts: Vec<&str> = content.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    let old_part = parts[0].trim_start_matches('-');
    let new_part = parts[1].trim_start_matches('+');

    let (old_start, old_count) = parse_range(old_part)?;
    let (new_start, new_count) = parse_range(new_part)?;

    Some((old_start, old_count, new_start, new_count))
}

/// Parse a range like "10,5" or "10" into (start, count).
fn parse_range(s: &str) -> Option<(i64, i64)> {
    if let Some((start, count)) = s.split_once(',') {
        Some((start.parse().ok()?, count.parse().ok()?))
    } else {
        Some((s.parse().ok()?, 1))
    }
}

/// Create a GitLab client for the given instance.
///
/// Helper function to avoid duplication between file content commands.
async fn create_gitlab_client(
    pool: &State<'_, DbPool>,
    instance_id: i64,
) -> Result<GitLabClient, AppError> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        r#"
        SELECT id, url, name, token, created_at, authenticated_username, session_cookie
        FROM gitlab_instances
        WHERE id = $1
        "#,
    )
    .bind(instance_id)
    .fetch_optional(pool.inner())
    .await?;

    let instance = instance
        .ok_or_else(|| AppError::not_found_with_id("GitLabInstance", instance_id.to_string()))?;

    let token = instance
        .token
        .ok_or_else(|| AppError::authentication("No token configured for GitLab instance"))?;

    GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token,
        timeout_secs: 30,
    })
}

/// Get raw file content from GitLab at a specific SHA.
///
/// This fetches the raw file content from the repository at a specific commit.
/// Used by Monaco editor to display the original and modified file content.
///
/// # Arguments
/// * `instance_id` - The GitLab instance ID
/// * `project_id` - The GitLab project ID
/// * `file_path` - The path to the file in the repository
/// * `sha` - The commit SHA to fetch the file at
///
/// # Returns
/// The raw file content as a string. Returns empty string for deleted/new files (404).
#[tauri::command]
pub async fn get_file_content(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    file_path: String,
    sha: String,
) -> Result<String, AppError> {
    let client = create_gitlab_client(&pool, instance_id).await?;
    client.get_file_content(project_id, &file_path, &sha).await
}

/// Get binary file content from GitLab as base64.
///
/// This fetches binary file content (images, etc.) and returns it as base64-encoded string.
/// Used by the image diff viewer to display original and modified images.
///
/// # Arguments
/// * `instance_id` - The GitLab instance ID
/// * `project_id` - The GitLab project ID
/// * `file_path` - The path to the file in the repository
/// * `sha` - The commit SHA to fetch the file at
///
/// # Returns
/// The file content as a base64-encoded string. Returns empty string for deleted/new files (404).
#[tauri::command]
pub async fn get_file_content_base64(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    file_path: String,
    sha: String,
) -> Result<String, AppError> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let client = create_gitlab_client(&pool, instance_id).await?;
    let bytes = client
        .get_file_content_bytes(project_id, &file_path, &sha)
        .await?;

    Ok(STANDARD.encode(&bytes))
}

/// Response struct for cached file pair content.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedFilePair {
    pub base_content: Option<String>,
    pub head_content: Option<String>,
}

/// Get cached file content pair (base + head) from local cache.
///
/// Returns cached file content for instant diff viewing. If no cached content
/// exists, the corresponding field is null (signaling a cache miss).
#[tauri::command]
pub async fn get_cached_file_pair(
    pool: State<'_, DbPool>,
    mr_id: i64,
    file_path: String,
) -> Result<CachedFilePair, AppError> {
    let (base_content, head_content) =
        crate::db::file_cache::get_cached_file_pair(&pool, mr_id, &file_path).await?;

    Ok(CachedFilePair {
        base_content,
        head_content,
    })
}

/// Response for resolve_mr_by_web_url command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMr {
    pub local_id: i64,
    pub state: String,
}

/// Resolve a merge request by its GitLab web URL.
///
/// Looks up a merge request in the local database by its web_url field.
/// Returns the local DB ID and state if found, or null if not synced.
///
/// # Arguments
/// * `web_url` - The full GitLab web URL of the merge request
///
/// # Returns
/// The local ID and state if found, or null if not synced.
#[tauri::command]
pub async fn resolve_mr_by_web_url(
    pool: State<'_, DbPool>,
    web_url: String,
) -> Result<Option<ResolvedMr>, AppError> {
    // Normalize: strip trailing slash
    let normalized = web_url.trim_end_matches('/');

    let result: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, state FROM merge_requests WHERE web_url = $1",
    )
    .bind(normalized)
    .fetch_optional(pool.inner())
    .await?;

    Ok(result.map(|(local_id, state)| ResolvedMr { local_id, state }))
}

/// Fetch a single MR from GitLab by web URL and persist it to the local DB.
///
/// Parses the web URL to extract project path and MR IID, finds the matching
/// configured instance, fetches the MR from the GitLab API, upserts it into
/// the local database, and returns the local ID and state.
///
/// # Arguments
/// * `web_url` - Full GitLab MR web URL (e.g., `https://gitlab.com/group/project/-/merge_requests/42`)
///
/// # Returns
/// The local MR ID and state after fetching and storing.
#[tauri::command]
pub async fn fetch_mr_by_web_url(
    pool: State<'_, DbPool>,
    web_url: String,
) -> Result<ResolvedMr, AppError> {
    let normalized = web_url.trim_end_matches('/');

    // Parse project path and MR IID from the web URL
    let (host, project_path, mr_iid) = parse_mr_web_url(normalized)?;

    // Find the matching configured instance by host
    let instances: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, url FROM gitlab_instances",
    )
    .fetch_all(pool.inner())
    .await?;

    let instance_id = instances
        .iter()
        .find(|(_, url)| {
            url.trim_end_matches('/')
                .split("://")
                .nth(1)
                .map(|h| h.trim_end_matches('/'))
                .map(|h| h.eq_ignore_ascii_case(&host))
                .unwrap_or(false)
        })
        .map(|(id, _)| *id)
        .ok_or_else(|| {
            AppError::invalid_input_field(
                "web_url",
                format!("No configured instance matches host '{}'", host),
            )
        })?;

    // Create client and fetch the MR from GitLab API
    let client = create_gitlab_client(&pool, instance_id).await?;
    let gitlab_mr = client.get_merge_request_by_path(&project_path, mr_iid).await?;

    // Upsert into local DB using the same pattern as sync_engine
    let created_at = chrono::DateTime::parse_from_rfc3339(&gitlab_mr.created_at)
        .map(|dt| dt.timestamp())
        .unwrap_or(0);
    let updated_at = chrono::DateTime::parse_from_rfc3339(&gitlab_mr.updated_at)
        .map(|dt| dt.timestamp())
        .unwrap_or(0);
    let merged_at = gitlab_mr
        .merged_at
        .as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp());
    let labels_json =
        serde_json::to_string(&gitlab_mr.labels).unwrap_or_else(|_| "[]".to_string());
    let reviewers_json = gitlab_mr
        .reviewers
        .as_ref()
        .map(|r| {
            serde_json::to_string(&r.iter().map(|u| &u.username).collect::<Vec<_>>())
                .unwrap_or_else(|_| "[]".to_string())
        })
        .unwrap_or_else(|| "[]".to_string());
    let head_pipeline_status = gitlab_mr.head_pipeline.as_ref().map(|p| p.status.clone());
    let now = chrono::Utc::now().timestamp();

    sqlx::query(
        r#"
        INSERT INTO merge_requests (
            id, instance_id, iid, project_id, title, description,
            author_username, source_branch, target_branch, state, web_url,
            created_at, updated_at, merged_at, labels, reviewers, cached_at,
            project_name, head_pipeline_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            state = excluded.state,
            updated_at = excluded.updated_at,
            merged_at = excluded.merged_at,
            labels = excluded.labels,
            reviewers = excluded.reviewers,
            cached_at = excluded.cached_at,
            project_name = excluded.project_name,
            head_pipeline_status = excluded.head_pipeline_status
        "#,
    )
    .bind(gitlab_mr.id)
    .bind(instance_id)
    .bind(gitlab_mr.iid)
    .bind(gitlab_mr.project_id)
    .bind(&gitlab_mr.title)
    .bind(&gitlab_mr.description)
    .bind(&gitlab_mr.author.username)
    .bind(&gitlab_mr.source_branch)
    .bind(&gitlab_mr.target_branch)
    .bind(&gitlab_mr.state)
    .bind(&gitlab_mr.web_url)
    .bind(created_at)
    .bind(updated_at)
    .bind(merged_at)
    .bind(&labels_json)
    .bind(&reviewers_json)
    .bind(now)
    .bind(&project_path)
    .bind(&head_pipeline_status)
    .execute(pool.inner())
    .await?;

    Ok(ResolvedMr {
        local_id: gitlab_mr.id,
        state: gitlab_mr.state,
    })
}

/// Parse a GitLab MR web URL into (host, project_path, mr_iid).
fn parse_mr_web_url(url: &str) -> Result<(String, String, i64), AppError> {
    let after_scheme = url
        .find("://")
        .map(|i| &url[i + 3..])
        .ok_or_else(|| AppError::invalid_input_field("web_url", "Missing scheme"))?;

    let slash_idx = after_scheme.find('/').ok_or_else(|| {
        AppError::invalid_input_field("web_url", "Missing path")
    })?;

    let host = after_scheme[..slash_idx].to_string();
    let path = &after_scheme[slash_idx + 1..];

    let delimiter = "/-/merge_requests/";
    let mr_idx = path.find(delimiter).ok_or_else(|| {
        AppError::invalid_input_field("web_url", "Not a merge request URL")
    })?;

    let project_path = path[..mr_idx].to_string();
    let iid_str = &path[mr_idx + delimiter.len()..];
    let mr_iid: i64 = iid_str.parse().map_err(|_| {
        AppError::invalid_input_field("web_url", "Invalid MR IID")
    })?;

    Ok((host, project_path, mr_iid))
}

/// Merge a merge request via the GitLab API.
///
/// This calls the GitLab merge endpoint directly (not via sync queue)
/// because merging is irreversible and needs immediate feedback.
///
/// On success, updates the local DB to reflect the merged state.
///
/// # Arguments
/// * `mr_id` - The local MR database ID
///
/// # Returns
/// Success or error (e.g., conflicts, pipeline failures, permissions).
#[tauri::command]
pub async fn merge_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, mr_iid) = get_mr_api_ids(pool.inner(), mr_id).await?;
    let client = create_gitlab_client(&pool, instance_id).await?;

    // Call GitLab merge API
    client.merge_merge_request(project_id, mr_iid).await?;

    // Update local DB on success
    let now = chrono::Utc::now().timestamp();
    sqlx::query("UPDATE merge_requests SET state = 'merged', merged_at = ? WHERE id = ?")
        .bind(now)
        .bind(mr_id)
        .execute(pool.inner())
        .await?;

    Ok(())
}

/// Helper to look up instance_id, project_id, iid for a merge request.
async fn get_mr_api_ids(pool: &DbPool, mr_id: i64) -> Result<(i64, i64, i64), AppError> {
    sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT instance_id, project_id, iid FROM merge_requests WHERE id = ?",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))
}

/// Check the merge status of an MR by fetching it from GitLab.
///
/// Returns the `detailed_merge_status` string from GitLab, e.g.:
/// - `"mergeable"` — ready to merge
/// - `"need_rebase"` — source branch must be rebased
/// - `"conflict"` — merge conflicts exist
/// - `"ci_must_pass"` — pipeline must succeed first
/// - `"discussions_not_resolved"` — open discussions
/// - `"draft_status"` — MR is a draft
/// - `"checking"` — GitLab is checking mergeability
///
/// # Arguments
/// * `mr_id` - The local MR database ID
#[tauri::command]
pub async fn check_merge_status(pool: State<'_, DbPool>, mr_id: i64) -> Result<String, AppError> {
    let (instance_id, project_id, mr_iid) = get_mr_api_ids(pool.inner(), mr_id).await?;
    let client = create_gitlab_client(&pool, instance_id).await?;
    let gitlab_mr = client.get_merge_request(project_id, mr_iid).await?;

    Ok(gitlab_mr
        .detailed_merge_status
        .unwrap_or_else(|| "unknown".into()))
}

/// Rebase a merge request's source branch via the GitLab API.
///
/// # Arguments
/// * `mr_id` - The local MR database ID
#[tauri::command]
pub async fn rebase_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, mr_iid) = get_mr_api_ids(pool.inner(), mr_id).await?;
    let client = create_gitlab_client(&pool, instance_id).await?;
    client.rebase_merge_request(project_id, mr_iid).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hunk_header() {
        let result = parse_hunk_header("@@ -1,5 +1,7 @@");
        assert_eq!(result, Some((1, 5, 1, 7)));

        let result = parse_hunk_header("@@ -10 +15,3 @@");
        assert_eq!(result, Some((10, 1, 15, 3)));
    }

    #[test]
    fn test_parse_range() {
        assert_eq!(parse_range("10,5"), Some((10, 5)));
        assert_eq!(parse_range("10"), Some((10, 1)));
    }

    #[test]
    fn test_parse_unified_diff() {
        let diff = r#"@@ -1,3 +1,4 @@
 context line
-removed line
+added line
+another added
 more context"#;

        let hunks = parse_unified_diff(diff);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_count, 3);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_count, 4);
        assert_eq!(hunks[0].lines.len(), 5);
        assert_eq!(hunks[0].lines[0].line_type, "context");
        assert_eq!(hunks[0].lines[1].line_type, "remove");
        assert_eq!(hunks[0].lines[2].line_type, "add");
    }
}
