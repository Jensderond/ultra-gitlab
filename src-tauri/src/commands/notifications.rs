//! Native notification commands using user-notify with notify-rust fallback.
//!
//! `user-notify` uses macOS `UNUserNotificationCenter` which requires proper code signing.
//! When the app is ad-hoc signed (e.g. CI builds without a Developer ID certificate),
//! UNUserNotificationCenter rejects requests with `UNErrorDomain error 1`.
//! In that case we fall back to `notify-rust` which uses the older notification API
//! that works without signing (but doesn't support click callbacks).

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

/// Return the detailed notification permission status: "granted", "denied", or "not_determined".
#[tauri::command]
pub async fn get_notification_permission_status() -> Result<String, AppError> {
    #[cfg(target_os = "macos")]
    {
        use std::cell::RefCell;
        use std::ptr::NonNull;
        use objc2_user_notifications::{
            UNAuthorizationStatus, UNNotificationSettings, UNUserNotificationCenter,
        };

        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        // Scope the block so it's dropped before the .await
        {
            let cb = RefCell::new(Some(tx));
            let block = block2::RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                if let Some(tx) = cb.take() {
                    let status = unsafe { settings.as_ref().authorizationStatus() };
                    let label = match status {
                        UNAuthorizationStatus::Authorized
                        | UNAuthorizationStatus::Provisional
                        | UNAuthorizationStatus::Ephemeral => "granted",
                        UNAuthorizationStatus::Denied => "denied",
                        UNAuthorizationStatus::NotDetermined => "not_determined",
                        _ => "not_determined",
                    };
                    let _ = tx.send(label.to_string());
                }
            });
            UNUserNotificationCenter::currentNotificationCenter()
                .getNotificationSettingsWithCompletionHandler(&block);
        }
        Ok(rx.await.map_err(|e| AppError::internal(format!("Failed to receive permission status: {}", e)))?)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("granted".to_string())
    }
}

/// Request notification permission from the OS. Returns whether permission was granted.
///
/// On macOS, the system only shows the permission dialog once per app. If the user
/// already denied, this returns an error indicating they must enable it via System Settings.
#[tauri::command]
pub async fn request_notification_permission(
    manager: tauri::State<'_, NotificationManagerState>,
) -> Result<bool, AppError> {
    // Check current status first — if already denied, don't attempt (macOS won't re-prompt).
    let status = get_notification_permission_status().await?;
    if status == "denied" {
        log::warn!("[notifications] Permission already denied — user must enable via System Settings");
        return Err(AppError::internal(
            "Notification permission was denied. Please enable it in System Settings → Notifications → Ultra Gitlab".to_string(),
        ));
    }
    if status == "granted" {
        log::info!("[notifications] Permission already granted");
        return Ok(true);
    }

    log::info!("[notifications] Requesting notification permission from user (status={})", status);
    match manager.0.first_time_ask_for_notification_permission().await {
        Ok(granted) => {
            log::info!("[notifications] Permission request result: granted={}", granted);
            Ok(granted)
        }
        Err(e) => {
            // UNErrorDomain error 1 = ad-hoc signed app can't use UNUserNotificationCenter.
            // Return Ok(true) so the UI enables notifications — the fallback sender will handle delivery.
            let err_str = format!("{}", e);
            if err_str.contains("UNErrorDomain error 1") {
                log::warn!("[notifications] App is ad-hoc signed — UNUserNotificationCenter unavailable, using notify-rust fallback");
                return Ok(true);
            }
            log::error!("[notifications] Failed to request permission: {}", e);
            Err(AppError::internal(format!("Failed to request notification permission: {}", e)))
        }
    }
}

/// Send a native OS notification with an optional in-app route for click navigation.
///
/// Tries `user-notify` (UNUserNotificationCenter) first for click callback support.
/// Falls back to `notify-rust` if that fails (ad-hoc signed builds).
#[tauri::command]
pub async fn send_native_notification(
    manager: tauri::State<'_, NotificationManagerState>,
    app_handle: tauri::AppHandle,
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
            log::warn!("[notifications] user-notify failed ({}), falling back to notify-rust", e);
            send_notification_fallback(&app_handle, &title, &body)
        }
    }
}

/// Fallback notification sender using `notify-rust` (works with ad-hoc signed builds).
/// No click callback support, but notifications are delivered.
#[cfg(target_os = "macos")]
fn send_notification_fallback(
    app_handle: &tauri::AppHandle,
    title: &str,
    body: &str,
) -> Result<(), AppError> {
    let identifier = &app_handle.config().identifier;
    let _ = notify_rust::set_application(if tauri::is_dev() {
        "com.apple.Terminal"
    } else {
        identifier
    });
    notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .show()
        .map_err(|e| AppError::internal(format!("Fallback notification failed: {}", e)))?;
    log::info!("[notifications] Fallback notification sent via notify-rust");
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn send_notification_fallback(
    _app_handle: &tauri::AppHandle,
    title: &str,
    body: &str,
) -> Result<(), AppError> {
    notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .show()
        .map_err(|e| AppError::internal(format!("Fallback notification failed: {}", e)))?;
    log::info!("[notifications] Fallback notification sent via notify-rust");
    Ok(())
}
