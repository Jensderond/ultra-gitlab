//! Companion HTTP server for mobile web access.
//!
//! Embeds an axum HTTP server that serves the frontend static files and
//! exposes REST API endpoints for MR data. The server binds to 0.0.0.0
//! so mobile devices on the same LAN can connect.

use crate::db::pool::DbPool;
use crate::services::companion_api::{action_api_routes, mr_api_routes};
use crate::services::companion_auth::{auth_middleware, auth_routes, AuthState};
use crate::services::sync_engine::SyncHandle;
use axum::middleware;
use axum::Router;
use std::path::PathBuf;
use std::sync::OnceLock;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tower_http::services::{ServeDir, ServeFile};

/// Shared state for the companion server's axum routes.
#[derive(Clone)]
pub struct CompanionState {
    pub db: DbPool,
    pub sync_handle: SyncHandle,
    pub app_handle: tauri::AppHandle,
}

/// Handle to control the running companion server.
///
/// Stores the cancellation token so we can gracefully shut down the server,
/// and the resolved frontend dist path for serving static files.
pub struct CompanionServerHandle {
    cancel_token: CancellationToken,
    port: u16,
}

/// Global handle to the running companion server (None if stopped).
fn server_handle() -> &'static Mutex<Option<CompanionServerHandle>> {
    static SERVER_HANDLE: OnceLock<Mutex<Option<CompanionServerHandle>>> = OnceLock::new();
    SERVER_HANDLE.get_or_init(|| Mutex::new(None))
}

/// Start the companion HTTP server on the given port.
///
/// Serves frontend static files from `frontend_dist` and shares `db`/`sync_handle`
/// via axum state for API routes. Auth routes and middleware are wired up automatically.
///
/// Returns an error if the server is already running or the port is unavailable.
pub async fn start_companion_server(
    port: u16,
    frontend_dist: PathBuf,
    db: DbPool,
    sync_handle: SyncHandle,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut handle_guard = server_handle().lock().await;

    if handle_guard.is_some() {
        return Err("Companion server is already running".into());
    }

    let cancel_token = CancellationToken::new();
    let cancel_clone = cancel_token.clone();

    let companion_state = CompanionState { db, sync_handle, app_handle: app_handle.clone() };
    let auth_state = AuthState { app_handle };

    // Protected API routes (require valid session token).
    let api_routes = mr_api_routes()
        .merge(action_api_routes())
        .with_state(companion_state)
        .layer(middleware::from_fn(auth_middleware));

    // Build the full router:
    // 1. Auth routes (unprotected) — /api/auth/*
    // 2. Protected API routes — /api/*
    // 3. Static file fallback for SPA
    let index_path = frontend_dist.join("index.html");
    let app = Router::new()
        .merge(auth_routes(auth_state))
        .merge(api_routes)
        .fallback_service(
            ServeDir::new(&frontend_dist).not_found_service(ServeFile::new(&index_path)),
        );

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("Failed to bind to port {}: {}", port, e))?;

    log::info!("[companion] Server starting on http://0.0.0.0:{}", port);

    // axum::serve needs ConnectInfo for extracting client IP in handlers
    let make_service = app.into_make_service_with_connect_info::<std::net::SocketAddr>();

    // Spawn the server task with graceful shutdown
    tokio::spawn(async move {
        let server = axum::serve(listener, make_service)
            .with_graceful_shutdown(async move {
                cancel_clone.cancelled().await;
            });

        if let Err(e) = server.await {
            log::error!("[companion] Server error: {}", e);
        }

        log::info!("[companion] Server stopped");
    });

    *handle_guard = Some(CompanionServerHandle { cancel_token, port });
    Ok(())
}

/// Stop the running companion server gracefully.
///
/// No-op if the server is not running.
pub async fn stop_companion_server() {
    let mut handle_guard = server_handle().lock().await;

    if let Some(handle) = handle_guard.take() {
        log::info!("[companion] Stopping server on port {}", handle.port);
        handle.cancel_token.cancel();
    }
}

/// Check if the companion server is currently running.
pub async fn is_companion_server_running() -> bool {
    server_handle().lock().await.is_some()
}
