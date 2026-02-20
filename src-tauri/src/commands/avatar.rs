//! Avatar-related Tauri commands.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::gitlab_instance::GitLabInstance;
use crate::services::avatar;
use std::collections::HashMap;
use tauri::State;

/// Get a single user's cached avatar as a data URI.
#[tauri::command]
pub async fn get_avatar(
    pool: State<'_, DbPool>,
    instance_id: i64,
    username: String,
) -> Result<Option<String>, AppError> {
    avatar::get_avatar_data_uri(pool.inner(), instance_id, &username).await
}

/// Get cached avatars for multiple users as data URIs.
#[tauri::command]
pub async fn get_avatars(
    pool: State<'_, DbPool>,
    instance_id: i64,
    usernames: Vec<String>,
) -> Result<HashMap<String, String>, AppError> {
    avatar::get_avatar_data_uris_batch(pool.inner(), instance_id, &usernames).await
}

/// Store or clear the session cookie for an instance.
#[tauri::command]
pub async fn update_session_cookie(
    pool: State<'_, DbPool>,
    instance_id: i64,
    session_cookie: Option<String>,
) -> Result<(), AppError> {
    // Trim empty strings to None
    let cookie = session_cookie.filter(|s| !s.trim().is_empty());

    sqlx::query("UPDATE gitlab_instances SET session_cookie = ? WHERE id = ?")
        .bind(&cookie)
        .bind(instance_id)
        .execute(pool.inner())
        .await?;

    Ok(())
}

/// Manually refresh all avatars for an instance (ignores TTL).
/// Returns the number of avatars downloaded.
#[tauri::command]
pub async fn refresh_avatars(pool: State<'_, DbPool>, instance_id: i64) -> Result<u32, AppError> {
    let instance: GitLabInstance = sqlx::query_as(
        "SELECT id, url, name, token, created_at, authenticated_username, session_cookie FROM gitlab_instances WHERE id = ?",
    )
    .bind(instance_id)
    .fetch_optional(pool.inner())
    .await?
    .ok_or_else(|| AppError::not_found("GitLab instance not found"))?;

    let cookie = instance
        .session_cookie
        .ok_or_else(|| AppError::invalid_input("No session cookie configured for this instance"))?;

    avatar::refresh_all_avatars(pool.inner(), instance_id, &instance.url, &cookie).await
}
