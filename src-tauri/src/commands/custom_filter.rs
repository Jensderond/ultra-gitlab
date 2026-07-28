//! Custom MR filter commands (issue #28).

use crate::db::custom_filter as db;
use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::CustomMrFilter;
use crate::services::gitlab_client::MergeRequestsQuery;
use tauri::State;

/// Get the custom MR filter for an instance (None when never configured).
#[tauri::command]
pub async fn get_custom_mr_filter(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Option<CustomMrFilter>, AppError> {
    Ok(db::get_custom_filter(pool.inner(), instance_id).await?)
}

/// Save (insert or update) the custom MR filter. `updated_at` is stamped
/// server-side; the value sent by the frontend is ignored.
#[tauri::command]
pub async fn set_custom_mr_filter(
    pool: State<'_, DbPool>,
    filter: CustomMrFilter,
) -> Result<(), AppError> {
    let mut filter = filter;
    filter.updated_at = chrono::Utc::now().timestamp();
    db::upsert_custom_filter(pool.inner(), &filter).await?;
    Ok(())
}

/// Count MRs matching a (possibly unsaved) filter without syncing them.
/// Runs the query with per_page=1 and returns GitLab's x-total header, so the
/// Settings UI can warn before a filter floods the sync. GitLab errors (e.g.
/// 400 for a bad param) propagate to the UI.
#[tauri::command]
pub async fn test_custom_mr_filter(
    pool: State<'_, DbPool>,
    filter: CustomMrFilter,
) -> Result<u32, AppError> {
    let client = crate::commands::mr::create_gitlab_client(&pool, filter.instance_id).await?;
    let mut query = MergeRequestsQuery::from_custom_filter(&filter);
    query.per_page = Some(1);
    let response = client.list_merge_requests(&query).await?;
    Ok(response.pagination.total)
}
