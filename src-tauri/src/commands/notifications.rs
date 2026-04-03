//! Native notification commands using user-notify.

use crate::error::AppError;
use crate::NotificationManagerState;
use std::collections::HashMap;
use user_notify::NotificationBuilder;

/// Send a native OS notification with an optional in-app route for click navigation.
#[tauri::command]
pub async fn send_native_notification(
    manager: tauri::State<'_, NotificationManagerState>,
    title: String,
    body: String,
    route: Option<String>,
) -> Result<(), AppError> {
    log::info!("[notifications] Sending native notification: title={:?}, route={:?}", title, route);

    let mut builder = NotificationBuilder::new()
        .title(&title)
        .body(&body);

    if let Some(ref route) = route {
        let mut info = HashMap::new();
        info.insert("route".to_string(), route.clone());
        builder = builder.set_user_info(info);
    }

    match manager.0.send_notification(builder).await {
        Ok(handle) => {
            log::info!("[notifications] Notification sent successfully, id={}", handle.get_id());
            Ok(())
        }
        Err(e) => {
            log::error!("[notifications] Failed to send notification: {}", e);
            Err(AppError::internal(format!("Failed to send notification: {}", e)))
        }
    }
}
