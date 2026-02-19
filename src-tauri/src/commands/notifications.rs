//! Native notification commands.

use crate::error::AppError;
use tauri_plugin_notification::NotificationExt;

/// Send a native OS notification.
#[tauri::command]
pub async fn send_native_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), AppError> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .sound("default")
        .show()
        .map_err(|e| AppError::internal(format!("Failed to send notification: {}", e)))?;
    Ok(())
}
