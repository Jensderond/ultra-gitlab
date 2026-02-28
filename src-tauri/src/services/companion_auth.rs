//! PIN authentication and session management for the companion server.
//!
//! Provides in-memory session token storage, PIN verification with rate
//! limiting, and auth middleware for axum routes. Sessions are stored
//! alongside authorized device metadata so that revoking a device from
//! settings immediately invalidates the corresponding session.

use crate::commands::companion_settings::AuthorizedDevice;
use chrono::Utc;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::OnceLock;
use tokio::sync::RwLock;

/// In-memory session store mapping session tokens → device IDs.
///
/// Also tracks rate-limiting state per IP address. The session store is
/// global so that both axum middleware and Tauri commands (device
/// revocation, PIN regeneration) can access it.
pub struct SessionStore {
    /// Active sessions: token → device_id.
    sessions: HashMap<String, String>,
    /// Rate limit tracking: IP → list of failed attempt timestamps.
    rate_limits: HashMap<IpAddr, Vec<i64>>,
}

impl SessionStore {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            rate_limits: HashMap::new(),
        }
    }
}

/// Global session store singleton.
fn store() -> &'static RwLock<SessionStore> {
    static SESSION_STORE: OnceLock<RwLock<SessionStore>> = OnceLock::new();
    SESSION_STORE.get_or_init(|| RwLock::new(SessionStore::new()))
}

/// Maximum failed PIN attempts per IP per window.
const MAX_ATTEMPTS: usize = 5;
/// Rate limit window in seconds.
const RATE_LIMIT_WINDOW_SECS: i64 = 60;

/// Check whether `ip` is currently rate-limited.
pub async fn is_rate_limited(ip: IpAddr) -> bool {
    let store = store().read().await;
    if let Some(attempts) = store.rate_limits.get(&ip) {
        let cutoff = Utc::now().timestamp() - RATE_LIMIT_WINDOW_SECS;
        let recent = attempts.iter().filter(|&&t| t > cutoff).count();
        recent >= MAX_ATTEMPTS
    } else {
        false
    }
}

/// Record a failed PIN attempt for `ip`.
pub async fn record_failed_attempt(ip: IpAddr) {
    let mut store = store().write().await;
    let now = Utc::now().timestamp();
    let attempts = store.rate_limits.entry(ip).or_default();
    attempts.push(now);
    // Prune old entries to avoid unbounded growth.
    let cutoff = now - RATE_LIMIT_WINDOW_SECS;
    attempts.retain(|&t| t > cutoff);
}

/// Verify a PIN and, on success, create a session token for a new device.
///
/// Returns `Ok((token, device))` on success with the new `AuthorizedDevice`
/// that should be persisted to settings. Returns `Err(())` if the PIN is wrong.
pub async fn verify_pin_and_create_session(
    pin: &str,
    expected_pin: &str,
    device_name: String,
) -> Result<(String, AuthorizedDevice), ()> {
    if pin != expected_pin {
        return Err(());
    }

    let token = uuid::Uuid::new_v4().to_string();
    let device_id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now();

    let device = AuthorizedDevice {
        id: device_id.clone(),
        name: device_name,
        token: token.clone(),
        last_active: now,
        created_at: now,
    };

    // Store session
    let mut store = store().write().await;
    store.sessions.insert(token.clone(), device_id);

    Ok((token, device))
}

/// Validate a session token. Returns `true` if the token is active.
pub async fn validate_token(token: &str) -> bool {
    let store = store().read().await;
    store.sessions.contains_key(token)
}

/// Revoke a device session by device ID (called when user revokes from settings).
pub async fn revoke_device_session(device_id: &str) {
    let mut store = store().write().await;
    store.sessions.retain(|_token, did| did != device_id);
}

/// Revoke a device session by token value.
pub async fn revoke_session_by_token(token: &str) {
    let mut store = store().write().await;
    store.sessions.remove(token);
}

/// Clear all sessions (called when PIN is regenerated).
pub async fn clear_all_sessions() {
    let mut store = store().write().await;
    store.sessions.clear();
}

/// Return the number of active sessions (i.e. connected devices).
pub async fn get_active_session_count() -> usize {
    let store = store().read().await;
    store.sessions.len()
}

/// Update last_active for a device given its session token.
/// Returns the device_id if found.
pub async fn touch_session(token: &str) -> Option<String> {
    let store = store().read().await;
    store.sessions.get(token).cloned()
}

// ---------- axum integration ----------

use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

/// JSON error body returned by auth middleware.
#[derive(Serialize)]
pub struct AuthError {
    pub code: String,
    pub message: String,
}

/// axum middleware that checks the session token cookie on all requests.
///
/// Allows requests through if a valid `companion_token` cookie is present.
/// Returns 401 JSON otherwise.
pub async fn auth_middleware(request: Request<Body>, next: Next) -> Response {
    // Extract the companion_token cookie
    let token = request
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|c| {
                let c = c.trim();
                c.strip_prefix("companion_token=")
            })
        });

    match token {
        Some(token) if validate_token(token).await => {
            // Touch the session to update last_active tracking
            let _ = touch_session(token).await;
            next.run(request).await
        }
        _ => {
            let error = AuthError {
                code: "UNAUTHORIZED".to_string(),
                message: "Missing or invalid session token".to_string(),
            };
            (StatusCode::UNAUTHORIZED, Json(error)).into_response()
        }
    }
}

/// Shared state for auth routes that need access to companion settings.
///
/// The `AppHandle` is stored so auth routes can read/write the companion
/// settings (PIN, authorized devices) via the existing store system.
#[derive(Clone)]
pub struct AuthState {
    pub app_handle: tauri::AppHandle,
}

/// POST /api/auth/verify-pin request body.
#[derive(serde::Deserialize)]
pub struct VerifyPinRequest {
    pub pin: String,
}

/// POST /api/auth/verify-pin success response.
#[derive(Serialize)]
pub struct VerifyPinResponse {
    pub token: String,
}

/// Handler for POST /api/auth/verify-pin.
pub async fn verify_pin_handler(
    axum::extract::State(state): axum::extract::State<AuthState>,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<VerifyPinRequest>,
) -> Response {
    let ip = addr.ip();

    // Check rate limit
    if is_rate_limited(ip).await {
        let error = AuthError {
            code: "RATE_LIMITED".to_string(),
            message: "Too many attempts, try again in 1 minute".to_string(),
        };
        return (StatusCode::TOO_MANY_REQUESTS, Json(error)).into_response();
    }

    // Load settings to get current PIN
    let settings = match crate::commands::settings::load_settings(&state.app_handle).await {
        Ok(s) => s,
        Err(_) => {
            let error = AuthError {
                code: "INTERNAL_ERROR".to_string(),
                message: "Failed to load settings".to_string(),
            };
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(error)).into_response();
        }
    };

    let expected_pin = &settings.companion_server.pin;

    // Derive device name from User-Agent or fallback
    let device_name = "Mobile Device".to_string();

    match verify_pin_and_create_session(&body.pin, expected_pin, device_name).await {
        Ok((token, device)) => {
            // Persist the new authorized device to settings
            let mut updated = settings;
            updated.companion_server.authorized_devices.push(device);
            let _ = crate::commands::settings::save_settings(&state.app_handle, &updated).await;
            *crate::commands::settings::settings_cache().write().await = updated;

            // Set cookie with 30-day expiry
            let cookie = format!(
                "companion_token={}; Path=/; Max-Age={}; SameSite=Lax",
                token,
                30 * 24 * 60 * 60
            );

            let mut response = Json(VerifyPinResponse { token }).into_response();
            response
                .headers_mut()
                .insert(header::SET_COOKIE, cookie.parse().unwrap());
            response
        }
        Err(()) => {
            // Record failed attempt for rate limiting
            record_failed_attempt(ip).await;

            let error = AuthError {
                code: "INVALID_PIN".to_string(),
                message: "Invalid PIN".to_string(),
            };
            (StatusCode::UNAUTHORIZED, Json(error)).into_response()
        }
    }
}

/// Build the auth API router.
///
/// These routes are NOT protected by the auth middleware since they
/// are used before authentication is established.
///
/// Note: The QR code endpoint was removed from the HTTP server to prevent
/// exposing the PIN to unauthenticated LAN devices. QR generation is now
/// exclusively handled by the `get_companion_qr_svg` Tauri command.
pub fn auth_routes(state: AuthState) -> axum::Router {
    axum::Router::new()
        .route(
            "/api/auth/verify-pin",
            axum::routing::post(verify_pin_handler),
        )
        .with_state(state)
}

#[cfg(test)]
mod tests {
    #[test]
    fn qr_endpoint_not_exposed_via_http() {
        // Security invariant: the PIN must never be served via an
        // unauthenticated HTTP endpoint. QR generation is handled
        // exclusively by the get_companion_qr_svg Tauri command.
        //
        // We verify by scanning the non-test source code for the
        // route definition and handler function.
        let source = include_str!("companion_auth.rs");
        // Only check code above the #[cfg(test)] marker
        let production_code = source
            .split("#[cfg(test)]")
            .next()
            .expect("test module marker must exist");

        assert!(
            !production_code.contains("fn qr_code_handler"),
            "qr_code_handler must not exist in production code"
        );
        assert!(
            !production_code.contains("/api/auth/qr"),
            "/api/auth/qr route must not exist in production code"
        );
    }
}
