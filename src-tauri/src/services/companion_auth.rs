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

/// Atomically check rate limit and record a failed attempt.
///
/// Acquires a single write lock to avoid TOCTOU races between checking
/// the rate limit and recording the attempt. Returns `true` if the IP
/// is rate-limited (caller should reject the request).
///
/// If the IP is already at or above the limit, returns `true` without
/// recording an additional attempt. Otherwise, records the attempt and
/// returns whether the limit has now been reached.
pub async fn check_and_record_attempt(ip: IpAddr) -> bool {
    let mut store = store().write().await;
    let now = Utc::now().timestamp();
    let cutoff = now - RATE_LIMIT_WINDOW_SECS;

    // Get or create the attempts list for this IP.
    let attempts = store.rate_limits.entry(ip).or_default();

    // Prune expired entries.
    attempts.retain(|&t| t > cutoff);

    // If all entries expired, remove the IP key to prevent memory leak.
    if attempts.is_empty() {
        store.rate_limits.remove(&ip);
        // Not rate-limited. Record the new attempt under a fresh entry.
        store.rate_limits.insert(ip, vec![now]);
        return false;
    }

    // Already rate-limited — reject without recording another attempt.
    if attempts.len() >= MAX_ATTEMPTS {
        return true;
    }

    // Record the new failed attempt.
    attempts.push(now);

    // Return whether the limit has now been reached.
    attempts.len() >= MAX_ATTEMPTS
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
            // Atomically check rate limit and record the failed attempt
            // using a single write lock to prevent TOCTOU bypass.
            if check_and_record_attempt(ip).await {
                let error = AuthError {
                    code: "RATE_LIMITED".to_string(),
                    message: "Too many attempts, try again in 1 minute".to_string(),
                };
                return (StatusCode::TOO_MANY_REQUESTS, Json(error)).into_response();
            }

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
    use super::*;

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

    /// Clear rate limit state for a specific IP.
    async fn clear_ip_rate_limit(ip: IpAddr) {
        let mut s = store().write().await;
        s.rate_limits.remove(&ip);
    }

    #[tokio::test]
    async fn check_and_record_rate_limits_after_max_attempts() {
        let ip: IpAddr = "10.0.0.1".parse().unwrap();
        clear_ip_rate_limit(ip).await;

        // First MAX_ATTEMPTS - 1 calls should not be rate-limited.
        for i in 0..MAX_ATTEMPTS - 1 {
            let limited = check_and_record_attempt(ip).await;
            assert!(!limited, "attempt {} should not be rate-limited", i + 1);
        }

        // The MAX_ATTEMPTS-th call records and hits the limit.
        let limited = check_and_record_attempt(ip).await;
        assert!(limited, "attempt {} should be rate-limited", MAX_ATTEMPTS);

        // Subsequent calls should also be rate-limited (already at limit).
        let limited = check_and_record_attempt(ip).await;
        assert!(limited, "attempt after limit should still be rate-limited");
    }

    #[tokio::test]
    async fn rate_limit_cleans_up_expired_entries() {
        let ip: IpAddr = "10.0.0.2".parse().unwrap();
        clear_ip_rate_limit(ip).await;

        // Manually insert expired attempts (older than the window).
        {
            let mut s = store().write().await;
            let expired_time = Utc::now().timestamp() - RATE_LIMIT_WINDOW_SECS - 10;
            let attempts = s.rate_limits.entry(ip).or_default();
            for _ in 0..MAX_ATTEMPTS {
                attempts.push(expired_time);
            }
        }

        // The expired entries should be pruned — not rate-limited.
        let limited = check_and_record_attempt(ip).await;
        assert!(!limited, "expired entries should not cause rate limiting");

        // The old expired key should have been removed and replaced
        // with a fresh entry containing just the new attempt.
        {
            let s = store().read().await;
            let attempts = s.rate_limits.get(&ip).expect("IP should have a fresh entry");
            assert_eq!(attempts.len(), 1, "should have exactly 1 fresh attempt");
        }

        // Now verify full cleanup: insert expired entries without calling
        // the function, then verify the cleanup happens on next call.
        {
            let mut s = store().write().await;
            s.rate_limits.remove(&ip);
            let expired_time = Utc::now().timestamp() - RATE_LIMIT_WINDOW_SECS - 10;
            s.rate_limits.insert(ip, vec![expired_time; MAX_ATTEMPTS]);
        }

        // After this call, the expired entries are pruned, the stale key
        // is removed, and a single fresh attempt is recorded.
        let limited = check_and_record_attempt(ip).await;
        assert!(!limited);

        {
            let s = store().read().await;
            let attempts = s.rate_limits.get(&ip).unwrap();
            assert_eq!(attempts.len(), 1, "stale entries should be pruned");
        }
    }
}
