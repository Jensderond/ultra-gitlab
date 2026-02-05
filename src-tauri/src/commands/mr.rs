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
#[derive(Debug, Serialize)]
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
        }
    }
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
            mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.instance_id = $1
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
            mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved
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

        let diff =
            diff.ok_or_else(|| AppError::not_found_with_id("Diff", mr_id.to_string()))?;

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

        let diff =
            diff.ok_or_else(|| AppError::not_found_with_id("Diff", mr_id.to_string()))?;

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

/// A syntax highlight token.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightToken {
    pub start: usize,
    pub end: usize,
    pub class: String,
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
    pub tokens: Vec<HighlightToken>,
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
    let hunks: Vec<DiffHunk> = all_hunks.into_iter().skip(start).take(end - start).collect();
    let has_more = end < total_hunks;

    Ok(DiffHunksResponse {
        file_path: file.new_path,
        hunks,
        start_index: start,
        total_hunks,
        has_more,
    })
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
            let (line_type, content, old_ln, new_ln) = if let Some(stripped) = line.strip_prefix('+') {
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
                tokens: Vec::new(), // Syntax highlighting added later
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
        SELECT id, url, name, token, created_at
        FROM gitlab_instances
        WHERE id = $1
        "#,
    )
    .bind(instance_id)
    .fetch_optional(pool.inner())
    .await?;

    let instance = instance.ok_or_else(|| {
        AppError::not_found_with_id("GitLabInstance", instance_id.to_string())
    })?;

    let token = instance.token.ok_or_else(|| {
        AppError::authentication("No token configured for GitLab instance")
    })?;

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
    let bytes = client.get_file_content_bytes(project_id, &file_path, &sha).await?;

    Ok(STANDARD.encode(&bytes))
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
