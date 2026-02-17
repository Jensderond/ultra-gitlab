//! Companion server start/stop commands.
//!
//! These commands allow the frontend to start and stop the embedded HTTP
//! server that serves the MR review UI to mobile browsers on the LAN.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::services::companion_server;
use crate::services::sync_engine::SyncHandle;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use super::settings::load_settings;

/// Resolve the path to the frontend dist directory.
///
/// In production builds this is the Tauri `frontendDist` resource directory.
/// In dev mode we fall back to `../dist` relative to the executable.
fn resolve_frontend_dist(app: &AppHandle) -> Result<PathBuf, AppError> {
    // In production, Tauri bundles the frontend into the resource directory.
    // The resource resolver returns the path to the app's resource dir.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| AppError::internal(format!("Failed to resolve resource dir: {}", e)))?;

    // Tauri v2 places frontendDist files directly in the resource directory
    let dist_path = resource_dir.clone();
    if dist_path.join("index.html").exists() {
        return Ok(dist_path);
    }

    // Dev fallback: try ../dist relative to the manifest dir
    let dev_dist = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if dev_dist.join("index.html").exists() {
        return Ok(dev_dist);
    }

    Err(AppError::internal(format!(
        "Frontend dist not found. Checked: {:?} and {:?}",
        resource_dir, dev_dist
    )))
}

/// Start the companion HTTP server.
///
/// Reads the companion server port from settings and starts serving.
#[tauri::command]
pub async fn start_companion_server_cmd(
    app: AppHandle,
    pool: State<'_, DbPool>,
    sync_handle: State<'_, SyncHandle>,
) -> Result<(), AppError> {
    let settings = load_settings(&app).await?;
    let port = settings.companion_server.port;
    let frontend_dist = resolve_frontend_dist(&app)?;

    log::info!(
        "[companion] Starting server on port {} serving {:?}",
        port,
        frontend_dist
    );

    companion_server::start_companion_server(
        port,
        frontend_dist,
        pool.inner().clone(),
        sync_handle.inner().clone(),
        app.clone(),
    )
    .await
    .map_err(AppError::internal)
}

/// Stop the companion HTTP server.
#[tauri::command]
pub async fn stop_companion_server_cmd() -> Result<(), AppError> {
    companion_server::stop_companion_server().await;
    Ok(())
}
