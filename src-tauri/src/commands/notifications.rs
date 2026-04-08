//! Native notification commands using user-notify.

use crate::error::AppError;
use crate::NotificationManagerState;
use std::collections::HashMap;
use user_notify::NotificationBuilder;

/// Check whether macOS notification permission is currently granted.
#[tauri::command]
pub async fn check_notification_permission(
    manager: tauri::State<'_, NotificationManagerState>,
) -> Result<bool, AppError> {
    match manager.0.get_notification_permission_state().await {
        Ok(granted) => Ok(granted),
        Err(e) => {
            log::error!("[notifications] Failed to check permission: {}", e);
            Err(AppError::internal(format!("Failed to check notification permission: {}", e)))
        }
    }
}

/// Request notification permission from the OS. Returns whether permission was granted.
#[tauri::command]
pub async fn request_notification_permission(
    manager: tauri::State<'_, NotificationManagerState>,
) -> Result<bool, AppError> {
    log::info!("[notifications] Requesting notification permission from user");
    match manager.0.first_time_ask_for_notification_permission().await {
        Ok(granted) => {
            log::info!("[notifications] Permission request result: granted={}", granted);
            Ok(granted)
        }
        Err(e) => {
            log::error!("[notifications] Failed to request permission: {}", e);
            Err(AppError::internal(format!("Failed to request notification permission: {}", e)))
        }
    }
}

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
