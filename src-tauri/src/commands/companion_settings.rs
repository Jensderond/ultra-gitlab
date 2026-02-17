//! Companion server settings commands.
//!
//! These commands manage the companion server configuration: enable/disable,
//! port, PIN, and authorized device management. Settings are persisted via
//! the existing tauri-plugin-store system alongside other AppSettings.

use crate::error::AppError;
use crate::services::companion_auth;
use crate::services::companion_server;
use chrono::{DateTime, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::settings::{load_settings, save_settings, settings_cache};

/// An authorized mobile device that has verified via PIN.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedDevice {
    /// Unique device identifier.
    pub id: String,
    /// Human-readable device name (from User-Agent or manual entry).
    pub name: String,
    /// Session token for this device.
    pub token: String,
    /// Last time this device was active.
    pub last_active: DateTime<Utc>,
    /// When this device was first authorized.
    pub created_at: DateTime<Utc>,
}

/// Companion server configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionServerSettings {
    /// Whether the companion server is enabled.
    pub enabled: bool,
    /// Port to bind the HTTP server on.
    pub port: u16,
    /// 6-digit PIN for device authentication.
    pub pin: String,
    /// List of authorized devices.
    pub authorized_devices: Vec<AuthorizedDevice>,
}

impl Default for CompanionServerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 6767,
            pin: generate_pin(),
            authorized_devices: Vec::new(),
        }
    }
}

/// Generate a random 6-digit PIN string.
fn generate_pin() -> String {
    let mut rng = rand::thread_rng();
    let pin: u32 = rng.gen_range(0..1_000_000);
    format!("{:06}", pin)
}

/// Validate that a port number is in the allowed range.
fn validate_port(port: u16) -> Result<(), AppError> {
    if port < 1024 {
        return Err(AppError::invalid_input_field(
            "Port must be between 1024 and 65535",
            "port",
        ));
    }
    Ok(())
}

/// Get the current companion server settings.
#[tauri::command]
pub async fn get_companion_settings(
    app: AppHandle,
) -> Result<CompanionServerSettings, AppError> {
    let settings = load_settings(&app).await?;
    Ok(settings.companion_server)
}

/// Update the companion server settings.
///
/// Validates port range before saving.
#[tauri::command]
pub async fn update_companion_settings(
    app: AppHandle,
    companion: CompanionServerSettings,
) -> Result<(), AppError> {
    validate_port(companion.port)?;

    let mut settings = load_settings(&app).await?;
    settings.companion_server = companion;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}

/// Regenerate the companion server PIN.
///
/// Clears all authorized devices since the old PIN is no longer valid.
#[tauri::command]
pub async fn regenerate_companion_pin(
    app: AppHandle,
) -> Result<String, AppError> {
    let mut settings = load_settings(&app).await?;
    let new_pin = generate_pin();
    settings.companion_server.pin = new_pin.clone();
    // Changing PIN invalidates all device sessions
    settings.companion_server.authorized_devices.clear();
    companion_auth::clear_all_sessions().await;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(new_pin)
}

/// Status of the companion server for the toolbar indicator.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionStatus {
    /// Whether the companion server is currently running.
    pub enabled: bool,
    /// Number of devices with active sessions.
    pub connected_devices: usize,
}

/// Get the companion server status (running state + connected device count).
#[tauri::command]
pub async fn get_companion_status() -> Result<CompanionStatus, AppError> {
    let enabled = companion_server::is_companion_server_running().await;
    let connected_devices = if enabled {
        companion_auth::get_active_session_count().await
    } else {
        0
    };
    Ok(CompanionStatus {
        enabled,
        connected_devices,
    })
}

/// Generate a QR code SVG for the companion server.
///
/// Encodes `http://{local_ip}:{port}/auth?pin={pin}` so mobile users
/// can scan it to auto-authenticate. Available as a Tauri command so
/// the desktop settings UI can display the QR without the companion
/// HTTP server needing to be running.
#[tauri::command]
pub async fn get_companion_qr_svg(
    app: AppHandle,
) -> Result<String, AppError> {
    let settings = load_settings(&app).await?;
    let pin = &settings.companion_server.pin;
    let port = settings.companion_server.port;

    let local_ip = match local_ip_address::local_ip() {
        Ok(ip) => ip.to_string(),
        Err(_) => "127.0.0.1".to_string(),
    };

    let url = format!("http://{}:{}/auth?pin={}", local_ip, port, pin);

    let qr = qrcode::QrCode::new(url.as_bytes()).map_err(|e| {
        AppError::internal(format!("Failed to generate QR code: {}", e))
    })?;

    let svg = qr
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();

    Ok(svg)
}

/// Revoke an authorized device by its ID.
#[tauri::command]
pub async fn revoke_companion_device(
    app: AppHandle,
    device_id: String,
) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    let before = settings.companion_server.authorized_devices.len();
    settings
        .companion_server
        .authorized_devices
        .retain(|d| d.id != device_id);

    if settings.companion_server.authorized_devices.len() == before {
        return Err(AppError::not_found_with_id("AuthorizedDevice", &device_id));
    }

    // Immediately invalidate the in-memory session for this device
    companion_auth::revoke_device_session(&device_id).await;

    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}
