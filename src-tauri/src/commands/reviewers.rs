//! Reviewer commands for fetching per-reviewer approval status.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::MrReviewer;
use tauri::State;

/// Get per-reviewer approval statuses for a merge request.
///
/// # Arguments
/// * `mr_id` - The MR ID
///
/// # Returns
/// List of reviewers with their individual approval status.
#[tauri::command]
pub async fn get_mr_reviewers(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<Vec<MrReviewer>, AppError> {
    let reviewers: Vec<MrReviewer> = sqlx::query_as(
        r#"
        SELECT mr_id, username, status, cached_at
        FROM mr_reviewers
        WHERE mr_id = ?
        ORDER BY username
        "#,
    )
    .bind(mr_id)
    .fetch_all(pool.inner())
    .await?;

    Ok(reviewers)
}
