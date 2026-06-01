//! Read queries shared between Tauri commands and the CLI.
//!
//! These return domain models (`MergeRequest`, `Diff`, `DiffFile`). The Tauri
//! command layer maps them to camelCase DTOs; the CLI uses them directly.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::{Diff, DiffFile, MergeRequest};

/// Filter for the "review" list (MRs not authored by me).
#[derive(Debug, Default, Clone)]
pub struct ReviewFilter {
    /// `opened` (default), `merged`, `closed`, or `all`.
    pub state: Option<String>,
    /// Substring matched against title and description.
    pub search: Option<String>,
}

const MR_COLUMNS: &str = r#"
    mr.id, mr.instance_id, mr.iid, mr.project_id,
    COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
    mr.title, mr.description,
    mr.author_username, mr.source_branch, mr.target_branch, mr.state,
    mr.web_url, mr.created_at, mr.updated_at, mr.merged_at,
    mr.approval_status, mr.approvals_required, mr.approvals_count,
    mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved,
    mr.head_pipeline_status, mr.state_changed_at
"#;

/// MRs for review: excludes the authenticated user's own authored MRs and
/// MRs assigned to the user. Mirrors `commands::mr::get_merge_requests`.
pub async fn list_review_mrs(
    pool: &DbPool,
    instance_id: i64,
    filter: ReviewFilter,
) -> Result<Vec<MergeRequest>, AppError> {
    let mut query = format!(
        r#"
        SELECT {MR_COLUMNS}
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.instance_id = $1
          AND mr.author_username != COALESCE(
              (SELECT authenticated_username FROM gitlab_instances WHERE id = mr.instance_id),
              ''
          )
          AND mr.assigned_to_me = 0
        "#
    );

    let state = filter.state.unwrap_or_else(|| "opened".to_string());
    let filter_state = state != "all";
    if filter_state {
        query.push_str(" AND mr.state = $2");
    }

    let has_search = filter.search.is_some();
    let search_pattern = filter.search.map(|s| format!("%{}%", s));
    if has_search {
        let param = if filter_state { "$3" } else { "$2" };
        query.push_str(&format!(
            " AND (mr.title LIKE {param} OR mr.description LIKE {param})"
        ));
    }
    query.push_str(" ORDER BY mr.updated_at DESC");

    let rows: Vec<MergeRequest> = match (filter_state, search_pattern.as_ref()) {
        (true, Some(search)) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(&state)
                .bind(search)
                .fetch_all(pool)
                .await?
        }
        (true, None) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(&state)
                .fetch_all(pool)
                .await?
        }
        (false, Some(search)) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(search)
                .fetch_all(pool)
                .await?
        }
        (false, None) => sqlx::query_as(&query).bind(instance_id).fetch_all(pool).await?,
    };
    Ok(rows)
}

/// MRs authored by, or assigned to, the authenticated user. Mirrors
/// `commands::mr::list_my_merge_requests`.
pub async fn list_my_mrs(
    pool: &DbPool,
    instance_id: i64,
    include_recently_merged: bool,
    include_drafts: bool,
) -> Result<Vec<MergeRequest>, AppError> {
    let username: Option<String> =
        sqlx::query_scalar("SELECT authenticated_username FROM gitlab_instances WHERE id = ?")
            .bind(instance_id)
            .fetch_optional(pool)
            .await?
            .flatten();
    let username = username.ok_or_else(|| {
        AppError::not_found("No authenticated username found. Please re-authenticate.")
    })?;

    let draft_clause = if include_drafts {
        ""
    } else {
        " AND mr.title NOT LIKE 'Draft:%' AND mr.title NOT LIKE 'WIP:%'"
    };

    let rows: Vec<MergeRequest> = if include_recently_merged {
        let cutoff = chrono::Utc::now().timestamp() - 86_400;
        sqlx::query_as(&format!(
            r#"
            SELECT {MR_COLUMNS}
            FROM merge_requests mr
            LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
            WHERE mr.instance_id = ?
              AND (mr.author_username = ? OR mr.assigned_to_me = 1)
              AND (
                  mr.state = 'opened'
                  OR (mr.state = 'merged' AND mr.merged_at IS NOT NULL AND mr.merged_at >= ?)
              ){draft_clause}
            ORDER BY (mr.state = 'opened') DESC, mr.updated_at DESC
            "#
        ))
        .bind(instance_id)
        .bind(&username)
        .bind(cutoff)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(&format!(
            r#"
            SELECT {MR_COLUMNS}
            FROM merge_requests mr
            LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
            WHERE mr.instance_id = ? AND mr.state = 'opened'
              AND (mr.author_username = ? OR mr.assigned_to_me = 1){draft_clause}
            ORDER BY mr.updated_at DESC
            "#
        ))
        .bind(instance_id)
        .bind(&username)
        .fetch_all(pool)
        .await?
    };
    Ok(rows)
}

/// Detail bundle for one MR: the row, its diff metadata, changed files, and a
/// count of pending sync-queue actions.
#[derive(Debug)]
pub struct MrDetail {
    pub mr: MergeRequest,
    pub diff: Option<Diff>,
    pub diff_files: Vec<DiffFile>,
    pub pending_actions: i64,
}

/// Load full detail for one MR from cache. Mirrors
/// `commands::mr::get_merge_request_detail`.
pub async fn get_detail(pool: &DbPool, mr_id: i64) -> Result<MrDetail, AppError> {
    let mr: Option<MergeRequest> = sqlx::query_as(&format!(
        r#"
        SELECT {MR_COLUMNS}
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.id = $1
        "#
    ))
    .bind(mr_id)
    .fetch_optional(pool)
    .await?;
    let mr = mr.ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;

    let diff: Option<Diff> = sqlx::query_as(
        "SELECT mr_id, content, base_sha, head_sha, start_sha, file_count, additions, deletions, cached_at
         FROM diffs WHERE mr_id = $1",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await?;

    let diff_files = get_diff_files(pool, mr_id).await?;

    let pending_actions: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sync_queue WHERE mr_id = $1 AND status IN ('pending', 'syncing')",
    )
    .bind(mr_id)
    .fetch_one(pool)
    .await?;

    Ok(MrDetail {
        mr,
        diff,
        diff_files,
        pending_actions: pending_actions.0,
    })
}

/// Changed files for an MR, ordered by position. Mirrors
/// `commands::mr::get_diff_files`.
pub async fn get_diff_files(pool: &DbPool, mr_id: i64) -> Result<Vec<DiffFile>, AppError> {
    let files: Vec<DiffFile> = sqlx::query_as(
        "SELECT id, mr_id, old_path, new_path, change_type, additions, deletions, file_position, diff_content
         FROM diff_files WHERE mr_id = $1 ORDER BY file_position",
    )
    .bind(mr_id)
    .fetch_all(pool)
    .await?;
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::{tempdir, TempDir};

    /// Build a temp DB with one instance (authenticated user "me") and a single
    /// MR (id=1). Returns the TempDir (kept alive by the caller), the pool, and
    /// the instance id.
    async fn pool_with_mr(
        author: &str,
        assigned: i64,
        state: &str,
        title: &str,
    ) -> (TempDir, DbPool, i64) {
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (url, token, created_at, authenticated_username, is_default)
             VALUES ('u', 't', 0, 'me', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let inst: i64 = sqlx::query_scalar("SELECT id FROM gitlab_instances LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO merge_requests
             (id, instance_id, iid, project_id, project_name, title, author_username,
              source_branch, target_branch, state, web_url, created_at, updated_at,
              labels, reviewers, cached_at, assigned_to_me)
             VALUES (1, ?, 1, 10, 'g/p', ?, ?, 's', 'main', ?, 'http://x', 0, 0, '[]', '[]', 0, ?)",
        )
        .bind(inst)
        .bind(title)
        .bind(author)
        .bind(state)
        .bind(assigned)
        .execute(&pool)
        .await
        .unwrap();
        (dir, pool, inst)
    }

    #[tokio::test]
    async fn review_excludes_my_own_mrs() {
        let (_dir, pool, inst) = pool_with_mr("me", 0, "opened", "mine").await;
        let rows = list_review_mrs(&pool, inst, ReviewFilter::default()).await.unwrap();
        assert!(rows.is_empty(), "own MR must not appear in review list");
    }

    #[tokio::test]
    async fn review_includes_others_mrs() {
        let (_dir, pool, inst) = pool_with_mr("alice", 0, "opened", "hers").await;
        let rows = list_review_mrs(&pool, inst, ReviewFilter::default()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].author_username, "alice");
    }

    #[tokio::test]
    async fn mine_includes_my_open_mr() {
        let (_dir, pool, inst) = pool_with_mr("me", 0, "opened", "minework").await;
        let rows = list_my_mrs(&pool, inst, false, true).await.unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn detail_returns_mr_and_empty_diff() {
        let (_dir, pool, _inst) = pool_with_mr("alice", 0, "opened", "detailwork").await;
        let detail = get_detail(&pool, 1).await.unwrap();
        assert_eq!(detail.mr.id, 1);
        assert!(detail.diff.is_none());
        assert!(detail.diff_files.is_empty());
        assert_eq!(detail.pending_actions, 0);
    }
}
