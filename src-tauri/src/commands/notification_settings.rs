//! Notification settings commands.

use crate::db::notification_settings as db;
use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::NotificationSettings;
use tauri::State;

/// Get the current notification settings.
#[tauri::command]
pub async fn get_notification_settings(
    pool: State<'_, DbPool>,
) -> Result<NotificationSettings, AppError> {
    let settings = db::get_notification_settings(pool.inner()).await?;
    Ok(settings)
}

/// Update notification settings.
#[tauri::command]
pub async fn update_notification_settings(
    pool: State<'_, DbPool>,
    settings: NotificationSettings,
) -> Result<(), AppError> {
    db::update_notification_settings(pool.inner(), &settings).await?;
    Ok(())
}
