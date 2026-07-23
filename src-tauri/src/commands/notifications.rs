//! Native notification commands using notify-rust.

use crate::error::AppError;

/// Send a native OS notification.
///
/// Uses `notify-rust` which relies on the older NSUserNotification API on macOS —
/// no app signing or permission prompts required.
#[tauri::command]
pub async fn send_native_notification(
    app_handle: tauri::AppHandle,
    title: String,
    body: String,
    route: Option<String>,
) -> Result<(), AppError> {
    log::info!(
        "[notifications] Sending native notification: title={:?}, route={:?}",
        title,
        route
    );

    #[cfg(target_os = "macos")]
    {
        let identifier = &app_handle.config().identifier;
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            identifier
        });

        notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .show()
            .map_err(|e| AppError::internal(format!("Notification failed: {}", e)))?;

        log::info!("[notifications] Notification sent via notify-rust");
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app_handle, &title, &body, &route);
        log::warn!("[notifications] Native notifications not supported on this platform");
    }

    Ok(())
}
