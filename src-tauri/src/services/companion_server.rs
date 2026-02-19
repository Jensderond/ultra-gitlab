//! Companion HTTP server for mobile web access.
//!
//! Embeds an axum HTTP server that serves the frontend static files and
//! exposes REST API endpoints for MR data. The server binds to 0.0.0.0
//! so mobile devices on the same LAN can connect.

use crate::db::pool::DbPool;
use crate::services::companion_api::{action_api_routes, mr_api_routes};
use crate::services::companion_auth::{auth_middleware, auth_routes, AuthState};
use crate::services::sync_engine::SyncHandle;
use axum::body::Body;
use axum::http::{Request, StatusCode, Uri};
use axum::middleware;
use axum::response::{Html, IntoResponse, Response};
use axum::Router;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;
use tower_http::services::ServeDir;

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

    // Read index.html once at startup for the SPA fallback.
    let index_html: Arc<str> = std::fs::read_to_string(frontend_dist.join("index.html"))
        .map_err(|e| format!("Failed to read index.html: {}", e))?
        .into();

    // Build the full router:
    // 1. Auth routes (unprotected) — /api/auth/*
    // 2. Protected API routes — /api/*
    // 3. Single fallback handler that:
    //    - Returns 404 for unmatched /api/* paths (prevents HTML-as-JSON loops)
    //    - Tries to serve a static file from the dist directory
    //    - Falls back to index.html for SPA client-side routes
    let dist = frontend_dist.clone();
    let app = Router::new()
        .merge(auth_routes(auth_state))
        .merge(api_routes)
        .fallback(move |uri: Uri| {
            let html = index_html.clone();
            let dist = dist.clone();
            async move { spa_fallback(uri, &dist, &html).await }
        });

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

/// SPA-aware fallback handler.
///
/// 1. API paths that didn't match a route get a plain 404
///    (prevents returning HTML that the frontend would misparse as JSON).
/// 2. Try to serve a static file from the dist directory.
/// 3. If no file matches, return `index.html` so React Router can handle
///    client-side routes like `/auth`, `/mrs/123`, etc.
async fn spa_fallback(uri: Uri, dist: &PathBuf, index_html: &str) -> Response {
    // Never serve HTML for API routes — the frontend expects JSON.
    if uri.path().starts_with("/api/") {
        return StatusCode::NOT_FOUND.into_response();
    }

    // Try to serve a static file (JS, CSS, images, etc.).
    let req = Request::builder()
        .uri(&uri)
        .body(Body::empty())
        .unwrap();

    match ServeDir::new(dist).oneshot(req).await {
        Ok(res) if res.status() != StatusCode::NOT_FOUND => res.into_response(),
        // No matching static file → serve index.html for client-side routing.
        _ => Html(index_html.to_owned()).into_response(),
    }
}
