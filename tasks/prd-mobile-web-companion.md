# PRD: Mobile Web Companion Server

## Introduction

Embed an HTTP server in the production Ultra GitLab desktop app so users can access the same review UI from a mobile phone (or any browser on the local network). The desktop app acts as the single source of truth — the mobile browser connects to it, reusing the same cached data, credentials, and settings. This enables quick MR triage and approvals on the go without needing a separate mobile app.

## Goals

- Serve the existing frontend UI over HTTP on a configurable local network port
- Expose a REST API that mirrors existing Tauri `invoke` commands so the frontend works in a regular browser
- Provide PIN-based authentication with persistent device authorization
- Allow users to review MRs, read diffs, browse comments, and approve MRs from mobile
- Require zero setup on the mobile device — just open a URL

## User Stories

### US-001: Enable companion server from settings
**Description:** As a user, I want to toggle the companion web server on/off from the settings page so that I control when my app is accessible on the network.

**Acceptance Criteria:**
- [ ] New "Companion Server" section in Settings page
- [ ] Toggle switch to enable/disable the server
- [ ] Configurable port number input (default: 8888, restricted to 8000-65535)
- [ ] Shows the local URL to open on mobile (e.g., `http://192.168.1.42:8888`)
- [ ] Shows a QR code encoding the URL + PIN for one-tap mobile setup
- [ ] Server starts/stops immediately when toggled
- [ ] Setting persists across app restarts (server auto-starts if previously enabled)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Start embedded HTTP server
**Description:** As a developer, I need an HTTP server embedded in the Tauri app that serves the frontend assets and API routes on the local network.

**Acceptance Criteria:**
- [ ] Axum HTTP server starts on the configured port, bound to `0.0.0.0`
- [ ] Serves the bundled frontend static files (same assets the Tauri webview uses)
- [ ] Server runs on a background Tokio task, does not block the main app
- [ ] Graceful shutdown when the app closes or server is disabled
- [ ] Logs server start/stop to the diagnostics system
- [ ] Typecheck/cargo check passes

### US-003: REST API proxy for Tauri commands
**Description:** As a developer, I need REST API endpoints that call the same Rust service layer as the Tauri commands, so the frontend works identically in a browser.

**Acceptance Criteria:**
- [ ] API routes under `/api/` namespace (e.g., `GET /api/merge-requests`, `POST /api/mr/:id/approve`)
- [ ] Routes call the same service functions as existing Tauri commands
- [ ] JSON request/response format matches the existing Tauri invoke signatures
- [ ] Error responses follow the same `AppError` structure (code + message)
- [ ] Tauri state (DB pool, sync handle) shared with axum via shared `Arc` references
- [ ] Cargo check passes

### US-004: Frontend transport abstraction
**Description:** As a developer, I need the frontend to detect whether it's running inside Tauri or in a browser and use the appropriate transport (`invoke()` vs `fetch()`).

**Acceptance Criteria:**
- [ ] Transport detection: check for `window.__TAURI_INTERNALS__` at startup
- [ ] Abstract transport layer in `src/services/transport.ts` that exposes an `invoke`-compatible interface
- [ ] Tauri transport: calls `invoke()` as today (no change)
- [ ] HTTP transport: calls `fetch('/api/...')` with JSON body, maps response to same types
- [ ] `src/services/tauri.ts` uses the transport abstraction instead of direct `invoke()`
- [ ] All existing functionality continues to work unchanged in the Tauri webview
- [ ] Typecheck passes

### US-005: QR code mobile setup
**Description:** As a user, I want to scan a QR code from my phone to open the companion UI and auto-authenticate, without manually typing the IP, port, and PIN.

**Acceptance Criteria:**
- [ ] QR code displayed in the companion server settings section
- [ ] QR code encodes a URL with the PIN as a query parameter (e.g., `http://192.168.1.42:8888/auth?pin=123456`)
- [ ] Mobile browser navigates to the URL, auto-submits the PIN, and redirects to the MR list
- [ ] QR code regenerates when PIN or network IP changes
- [ ] QR SVG generated Rust-side using `qrcode` crate, served via `/api/auth/qr` endpoint
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: PIN-based authentication
**Description:** As a user, I want to authorize my mobile device with a PIN so that only I can access my MR data.

**Acceptance Criteria:**
- [ ] When companion server is enabled, a 6-digit PIN is generated and displayed in settings
- [ ] PIN can be regenerated manually (button in settings)
- [ ] Mobile browser shows a PIN entry screen on first visit
- [ ] Incorrect PIN shows an error, rate-limited to 5 attempts per minute
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-007: Persistent device authorization
**Description:** As a user, I want my phone to stay authorized so I don't have to re-enter the PIN every time.

**Acceptance Criteria:**
- [ ] On successful PIN entry, server issues a session token (stored in a cookie or localStorage)
- [ ] Token is a random UUID mapped to the device on the server side
- [ ] Token persists across browser sessions (long expiry, e.g., 30 days)
- [ ] Desktop settings page shows list of authorized devices with "Revoke" option
- [ ] Revoking a device immediately invalidates its token
- [ ] Changing the PIN revokes all existing device authorizations
- [ ] Typecheck/cargo check passes
- [ ] Verify in browser using dev-browser skill

### US-008: Connected devices indicator
**Description:** As a user, I want to see at a glance in the desktop app whether any mobile devices are currently connected to the companion server.

**Acceptance Criteria:**
- [ ] Icon/badge in the desktop app toolbar/status bar when companion server is enabled
- [ ] Indicator shows number of currently connected devices (active sessions with recent activity)
- [ ] Clicking the indicator opens the companion server settings section
- [ ] Indicator disappears when companion server is disabled
- [ ] "Currently connected" defined as session with activity in the last 5 minutes
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-009: Browse and triage MRs on mobile
**Description:** As a user, I want to browse MR lists, read MR details, view diffs, and read comments from my phone.

**Acceptance Criteria:**
- [ ] MR list page loads and displays correctly in mobile browser
- [ ] MR detail page shows description, diff file list, and comments
- [ ] Diff viewer renders (unified mode forced on small screens)
- [ ] Comments display inline and in overview
- [ ] Navigation between pages works (React Router with browser history)
- [ ] Verify in browser using dev-browser skill

### US-010: Approve MRs from mobile
**Description:** As a user, I want to approve (or unapprove) a merge request from my phone so I can unblock teammates without being at my desk.

**Acceptance Criteria:**
- [ ] Approve/unapprove buttons visible on MR detail page in mobile browser
- [ ] Tapping approve calls the API and shows confirmation
- [ ] Approval status updates in real-time on both mobile and desktop
- [ ] Error handling for network failures or sync conflicts
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: Embed an axum HTTP server in the Tauri app, configurable port (default 8888), bound to `0.0.0.0`
- FR-2: Serve bundled frontend static files from the embedded server (same build artifacts as Tauri webview)
- FR-3: Expose REST API endpoints under `/api/` that map to existing Rust service functions
- FR-4: API endpoints must cover at minimum: instances list, MR list, MR detail, diff files, diff hunks, file content, comments, approval status, approve, unapprove, sync status, settings (read-only)
- FR-5: Frontend detects Tauri vs browser environment and switches transport (invoke vs fetch)
- FR-6: Generate a 6-digit PIN displayed in the desktop app settings
- FR-7: Mobile browser presents PIN entry screen; validate against stored PIN with rate limiting
- FR-8: Issue long-lived session tokens on successful PIN auth, stored server-side
- FR-9: Companion server settings persisted in app settings (enabled, port, PIN, authorized devices)
- FR-10: Server gracefully shuts down when app closes or feature is disabled
- FR-11: All API endpoints require valid session token (except PIN auth endpoint)
- FR-12: Force unified diff view mode when viewport width < 768px

## Non-Goals

- No dedicated mobile-optimized UI or responsive redesign (existing UI should work; force unified diffs on small screens)
- No push notifications to mobile
- No write operations beyond approve/unapprove in v1 (no commenting, merging, or pipeline actions from mobile) — but API design should accommodate future write operations
- No HTTPS/TLS for the embedded server (local network only)
- No discovery/mDNS — user manually enters the IP:port
- No multi-user access — single-user app, one set of credentials
- No WebSocket real-time sync to mobile (polling or manual refresh)

## Design Considerations

- Reuse the existing Settings page layout for the companion server section
- PIN display should be large and easy to read (meant to be glanced at and typed on phone)
- Mobile PIN entry screen should be minimal — centered input, large touch targets
- Show a QR code alongside the URL in settings that encodes URL + PIN for one-tap mobile setup
- Authorized devices list similar to the existing instance-list styling

## Technical Considerations

- **Axum integration**: Tauri v2 runs on Tokio, so axum fits naturally without a second runtime. Spawn the server as a background task via `tokio::spawn`
- **Shared state**: The `DbPool` and `SyncHandle` are already in `Arc`-wrapped Tauri state. Extract and share them with axum's state extractor
- **Static file serving**: Tauri bundles frontend assets. Use `include_dir` or Tauri's resource resolver to access them at runtime for axum to serve
- **API route generation**: Create an axum router with routes matching Tauri commands. Each handler calls the same service functions (in `src-tauri/src/services/`). Design the API namespace broadly to accommodate future write operations (commenting, merging) without restructuring
- **QR code**: Use `qrcode` Rust crate to generate SVG server-side (no frontend dependency), served via a `/api/auth/qr` endpoint
- **Connected devices tracking**: Track last-activity timestamp per session token in memory; axum middleware updates on each request
- **Transport abstraction**: A thin layer in `src/services/transport.ts` that returns the same types. The HTTP transport serializes args to JSON body and deserializes responses
- **Auth middleware**: Axum middleware layer that checks session token on all `/api/` routes, skipping `/api/auth/verify-pin`
- **Rate limiting**: In-memory rate limiter (IP + attempt count) for PIN verification
- **Port range**: Configurable port restricted to high-port range (8000-65535) to avoid privileged port issues
- **Port conflicts**: If the configured port is occupied, log an error and disable the server with a notification to the user
- **Graceful degradation**: Frontend uses `isTauri` checks to hide/disable Tauri-specific features (native notifications, system tray shortcuts, command palette) in browser mode rather than showing broken UI

## Success Metrics

- User can open the mobile URL and see the MR list within 5 seconds of enabling the server
- PIN auth flow completes in under 10 seconds (type 6 digits, tap submit)
- Approved MR from mobile reflects in desktop app on next sync cycle
- No measurable performance impact on the desktop app when companion server is idle
- Zero additional setup required on the mobile device

## Resolved Questions

- **QR code for mobile setup?** Yes — included in v1 (US-005). QR encodes URL + PIN for one-tap auth.
- **mDNS/Bonjour discovery?** Not in v1 — planned for a future version. Manual IP entry for now.
- **Connected devices indicator?** Yes — included in v1 (US-008). Icon in toolbar with active session count.
- **Commenting from mobile?** Not in v1 — but API design should be broad enough to add write operations (comments, merge, pipeline actions) in future versions without restructuring.
- **QR code library?** Rust-side SVG generation using `qrcode` crate. No frontend dependency needed.
- **Port range?** Restricted to high ports (8000-65535) to avoid privileged port issues. Default 8888.
- **Tauri-specific features in browser?** Graceful degradation — hide/disable features that require Tauri (native notifications, system tray, command palette) with `isTauri` checks. No broken UI, no "desktop only" tooltips.

## Open Questions

None — all questions resolved.
