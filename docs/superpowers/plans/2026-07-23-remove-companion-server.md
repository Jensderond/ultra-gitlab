# Remove Companion Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note on task shape:** This is a removal/cleanup plan, not a new feature. There is no new behavior to TDD, so each task's "test" step is a compile/typecheck/build verification instead of a red/green unit test. Do not skip the verification step — it is how you catch a dangling reference.

**Goal:** Delete the embedded mobile-web "companion" HTTP server (Rust axum server + PIN auth + Settings UI + frontend HTTP-transport fallback) now that native iOS support (via Tauri) makes it obsolete.

**Architecture:** The companion server was a fallback for reaching the app from a phone browser before iOS support existed: a Rust axum HTTP server (`services/companion_server.rs`, `services/companion_api.rs`, `services/companion_auth.rs`) mirrored a subset of Tauri commands over REST, and the frontend's `transport.ts` routed `invoke()` calls to `fetch()` when not running inside a Tauri webview. Now that iOS runs the real Tauri app, that browser-mode fallback is dead weight. Removal touches: 5 whole Rust files, Cargo dependencies, `lib.rs` wiring, `commands/settings.rs`'s settings blob, 8 whole frontend files, `transport.ts`'s HTTP branch, Settings UI wiring, a sidebar indicator, CSS (with two rules that must be *kept* because `AppearanceSection.tsx` reuses them), and e2e fixtures/mocks.

**Tech Stack:** Rust (Tauri 2, axum, tower), TypeScript/React 19, Bun, Playwright.

## Global Constraints

- Do not remove `rand` if anything besides the companion PIN generator uses it — verified: only `companion_settings.rs` uses `rand::`. Safe to remove.
- Do not remove `uuid` — `sync_engine.rs` also depends on it (companion device tokens were not its only consumer).
- Do not remove `.companion-toggle` / `.companion-toggle-knob` CSS rules (and their `:hover`/`.active`/`:disabled` variants) from `src/pages/Settings.css` — `AppearanceSection.tsx`'s condensed-MR-list toggle reuses these exact class names. Every other `.companion-*` rule in that file is safe to delete.
- Do not touch `AppearanceSection.tsx` itself — its use of `companion-toggle`/`companion-toggle-knob` class names is coincidental reuse of a generic toggle-switch style, unrelated to the companion server feature.
- Do not touch `NSLocalNetworkUsageDescription` in `src-tauri/gen/apple/ultra-gitlab_iOS/Info.plist` — that covers dev-server reachability, not the companion server.
- After every task, the frontend must still typecheck/build and the Rust crate must still `cargo check` cleanly before moving to the next task.

---

### Task 1: Remove Rust companion server (commands, services, wiring, deps)

**Files:**
- Delete: `src-tauri/src/commands/companion_server.rs`
- Delete: `src-tauri/src/commands/companion_settings.rs`
- Delete: `src-tauri/src/services/companion_api.rs`
- Delete: `src-tauri/src/services/companion_auth.rs`
- Delete: `src-tauri/src/services/companion_server.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/commands/mr.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces: a crate that `cargo check` passes with zero references to `companion_server`, `companion_settings`, `companion_api`, `companion_auth`, `axum`, `tower`, `tower_http`, `tokio_util`, `qrcode`, `rand`, `local_ip_address`.

- [ ] **Step 1: Delete the 5 companion Rust files**

```bash
rm src-tauri/src/commands/companion_server.rs
rm src-tauri/src/commands/companion_settings.rs
rm src-tauri/src/services/companion_api.rs
rm src-tauri/src/services/companion_auth.rs
rm src-tauri/src/services/companion_server.rs
```

- [ ] **Step 2: Remove the companion module declarations and re-exports from `src-tauri/src/commands/mod.rs`**

Remove these two module lines:
```rust
pub mod companion_server;
pub mod companion_settings;
```

Remove this re-export line:
```rust
pub use companion_server::{start_companion_server_cmd, stop_companion_server_cmd};
```

Remove this re-export block:
```rust
pub use companion_settings::{
    get_companion_qr_svg, get_companion_settings, get_companion_status, regenerate_companion_pin,
    revoke_companion_device, set_companion_pin, update_companion_settings,
};
```

- [ ] **Step 3: Remove the companion module declarations from `src-tauri/src/services/mod.rs`**

Remove:
```rust
pub mod companion_api;
pub mod companion_auth;
pub mod companion_server;
```

- [ ] **Step 4: Remove the `parse_unified_diff_public` alias from `src-tauri/src/commands/mr.rs`**

It exists only for `companion_api.rs` (now deleted) to call. Remove:
```rust
/// Parse a unified diff into hunks (public alias for companion API).
pub fn parse_unified_diff_public(diff: &str) -> Vec<DiffHunk> {
    parse_unified_diff(diff)
}

```

- [ ] **Step 5: Strip companion references out of `src-tauri/src/lib.rs`**

In the `use commands::{ ... }` block, remove these companion names from the import list (keep everything else in the list exactly as-is): `get_companion_qr_svg`, `get_companion_settings`, `get_companion_status`, `regenerate_companion_pin`, `set_companion_pin`, `revoke_companion_device`, `start_companion_server_cmd`, `stop_companion_server_cmd`, `update_companion_settings`.

Remove this line entirely:
```rust
use services::companion_server;
```

Remove the entire auto-start block:
```rust
            // Auto-start companion server if enabled in settings
            {
                use commands::companion_settings::CompanionServerSettings;
                let companion_settings: CompanionServerSettings = app
                    .handle()
                    .store("settings.json")
                    .ok()
                    .and_then(|store| store.get("companion_server"))
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();

                if companion_settings.enabled {
                    let port = companion_settings.port;
                    let pool_clone = pool.clone();
                    let sync_clone = sync_handle.clone();
                    let app_handle_clone = app.handle().clone();

                    // Resolve frontend dist path (must match resolve_frontend_dist in commands)
                    let resource_dir = app.path().resource_dir().ok();
                    let frontend_dist = resource_dir
                        .map(|p| p.join("companion-dist"))
                        .filter(|p| p.join("index.html").exists())
                        .or_else(|| {
                            let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                                .join("../dist");
                            dev.join("index.html").exists().then_some(dev)
                        });

                    if let Some(dist_path) = frontend_dist {
                        tauri::async_runtime::spawn(async move {
                            match companion_server::start_companion_server(
                                port,
                                dist_path,
                                pool_clone,
                                sync_clone,
                                app_handle_clone,
                            )
                            .await
                            {
                                Ok(()) => log::info!("[companion] Auto-started on port {}", port),
                                Err(e) => log::error!("[companion] Auto-start failed: {}", e),
                            }
                        });
                    } else {
                        log::warn!("[companion] Auto-start skipped: frontend dist not found");
                    }
                }
            }

```

Remove the invoke_handler entries:
```rust
            // Companion server
            get_companion_settings,
            get_companion_qr_svg,
            get_companion_status,
            update_companion_settings,
            regenerate_companion_pin,
            set_companion_pin,
            revoke_companion_device,
            start_companion_server_cmd,
            stop_companion_server_cmd,
```

If, after removing the auto-start block, `pool` or `sync_handle` (the clones) become unused in that scope, leave the original bindings alone — they are used elsewhere in `setup()`. Only the block above is removed.

- [ ] **Step 6: Remove the companion settings field from `src-tauri/src/commands/settings.rs`**

Remove the import:
```rust
use crate::commands::companion_settings::CompanionServerSettings;
```

Remove the constant:
```rust
/// Key for companion server settings in the store.
const COMPANION_SERVER_KEY: &str = "companion_server";
```

Remove the struct field (and its doc comment) from `AppSettings`:
```rust
    /// Companion server settings (mobile web access).
    pub companion_server: CompanionServerSettings,
```

Remove the default field from `impl Default for AppSettings`:
```rust
            companion_server: CompanionServerSettings::default(),
```

Remove the load block from `load_settings`:
```rust
    // Try to load companion server settings
    let companion_server = match store.get(COMPANION_SERVER_KEY) {
        Some(value) => serde_json::from_value(value.clone()).unwrap_or_default(),
        None => CompanionServerSettings::default(),
    };

```
and remove `companion_server,` from the `Ok(AppSettings { ... })` construction at the end of that function.

Remove the save block from `save_settings`:
```rust
    // Save companion server settings
    let companion_value = serde_json::to_value(&settings.companion_server)?;
    store.set(COMPANION_SERVER_KEY, companion_value);

```

- [ ] **Step 7: Remove companion-only dependencies from `src-tauri/Cargo.toml`**

Remove:
```toml
# HTTP Server (companion server)
axum = "0.8"
tower = "0.5"
tower-http = { version = "0.6", features = ["fs", "cors"] }
tokio-util = "0.7"

```
Remove:
```toml
# Random number generation (companion server PIN)
rand = "0.8"

```
Remove:
```toml
# QR code generation (companion server)
qrcode = "0.14"

```
Remove the `local-ip-address` line (leave `tauri-plugin-deep-link` which sits on the same block):
```toml
local-ip-address = "0.6"
```
Update the comment above `uuid` since it's no longer companion-specific (it's used by `sync_engine.rs`):
```toml
# UUID generation (companion server device tokens)
uuid = { version = "1", features = ["v4"] }
```
becomes:
```toml
# UUID generation
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 8: Remove the companion-dist bundle resources from `src-tauri/tauri.conf.json`**

Remove the `resources` key entirely from `bundle` (it only existed to ship a second copy of the frontend for the companion HTTP server to serve):
```json
    "resources": {
      "../dist/*": "companion-dist/",
      "../dist/assets/*": "companion-dist/assets/"
    },
```

- [ ] **Step 9: Verify the Rust crate compiles**

Run: `cd src-tauri && cargo check`
Expected: builds cleanly, no errors, no warnings about unused `companion_server`/`companion_settings` imports. `Cargo.lock` will update automatically to drop the removed dependencies.

---

### Task 2: Remove frontend companion code (Settings UI, auth gate, transport HTTP fallback)

**Files:**
- Delete: `src/hooks/useCompanionAuth.ts`
- Delete: `src/hooks/queries/useCompanionSettingsQuery.ts`
- Delete: `src/hooks/queries/useCompanionStatusQuery.ts`
- Delete: `src/pages/Settings/CompanionServerSection.tsx`
- Delete: `src/pages/Settings/CompanionActivePanel.tsx`
- Delete: `src/pages/Settings/CompanionDeviceList.tsx`
- Delete: `src/pages/AuthPage.tsx`
- Delete: `src/pages/AuthPage.css` (if present alongside AuthPage.tsx)
- Modify: `src/App.tsx`
- Modify: `src/components/AppSidebar/AppSidebar.tsx`
- Modify: `src/components/AppSidebar/AppSidebar.css`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/pages/Settings.css`
- Modify: `src/services/transport.ts`
- Modify: `src/services/tauri.ts`
- Modify: `src/services/index.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (frontend and Rust sides are independent to compile, though the app is only meaningfully runnable once both are done).
- Produces: `transportInvoke<T>(cmd, args)` still exists with the same signature (`Promise<T>`), now unconditionally delegating to Tauri's `invoke`, so every caller in `services/tauri.ts` keeps working unchanged.

- [ ] **Step 1: Delete the companion-only frontend files**

```bash
rm src/hooks/useCompanionAuth.ts
rm src/hooks/queries/useCompanionSettingsQuery.ts
rm src/hooks/queries/useCompanionStatusQuery.ts
rm src/pages/Settings/CompanionServerSection.tsx
rm src/pages/Settings/CompanionActivePanel.tsx
rm src/pages/Settings/CompanionDeviceList.tsx
rm src/pages/AuthPage.tsx
rm -f src/pages/AuthPage.css
```

- [ ] **Step 2: Simplify `src/services/transport.ts` to drop the HTTP fallback**

Replace the entire file content with:
```ts
/**
 * Transport abstraction layer.
 *
 * Detects whether the app is running inside a Tauri webview (desktop or iOS).
 * The app only ever runs inside a Tauri webview — there is no browser-only mode.
 */

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * True when running inside a Tauri webview.
 */
export const isTauri: boolean = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ============================================================================
// Tauri event listener helper
// ============================================================================

type UnlistenFn = () => void;

/**
 * Listen for a Tauri event.
 */
export async function tauriListen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, handler);
}

// ============================================================================
// Open external URL helper
// ============================================================================

/**
 * Open a URL externally via Tauri's plugin-opener.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

// ============================================================================
// Unified invoke — the public API
// ============================================================================

/**
 * Invoke a backend command via Tauri IPC.
 */
export async function transportInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}
```

- [ ] **Step 3: Remove companion imports/usage from `src/App.tsx`**

Remove these two import lines:
```ts
import { useCompanionStatusQuery } from './hooks/queries/useCompanionStatusQuery';
import useCompanionAuth from './hooks/useCompanionAuth';
```
Also remove the now-unused `AuthPage` import:
```ts
import AuthPage from './pages/AuthPage';
```

Remove:
```ts
  const companionAuth = useCompanionAuth(isTauri || location.pathname === '/auth');
```
Remove:
```ts
  const companionStatusQuery = useCompanionStatusQuery();
```

Remove the redirect effect:
```ts
  // In browser mode, redirect to /auth if not authenticated
  useEffect(() => {
    if (companionAuth.isAuthenticated === false) {
      navigate('/auth', { replace: true });
    }
  }, [companionAuth.isAuthenticated, navigate]);

```

Replace:
```ts
  // Load pipeline projects for command palette via TQ
  const isAuthed = companionAuth.isAuthenticated;
  const instances = instancesQuery.data ?? [];
  const pipelineProjectQueries = useQueries({
    queries: instances.map((inst) => ({
      queryKey: queryKeys.pipelineProjects(String(inst.id)),
      queryFn: () => listPipelineProjects(inst.id),
      staleTime: 60_000,
      enabled: isTauri || isAuthed === true,
    })),
  });
```
with:
```ts
  // Load pipeline projects for command palette via TQ
  const instances = instancesQuery.data ?? [];
  const pipelineProjectQueries = useQueries({
    queries: instances.map((inst) => ({
      queryKey: queryKeys.pipelineProjects(String(inst.id)),
      queryFn: () => listPipelineProjects(inst.id),
      staleTime: 60_000,
    })),
  });
```

Remove the auth-page branch and the "wait for auth check" branch:
```ts
  // Auth page renders without sidebar (mobile companion flow)
  const isAuthPage = location.pathname === '/auth';

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
      </Routes>
    );
  }

  // In browser mode, wait for auth check before rendering main app
  if (!isTauri && companionAuth.isAuthenticated !== true) {
    return null;
  }

```

Replace:
```tsx
      <AppSidebar updateAvailable={updateChecker.available} hasApprovedMRs={hasApprovedMRs} companionEnabled={companionStatusQuery.data?.enabled ?? false} companionDeviceCount={companionStatusQuery.data?.connectedDevices ?? 0} />
```
with:
```tsx
      <AppSidebar updateAvailable={updateChecker.available} hasApprovedMRs={hasApprovedMRs} />
```

Note: `isTauri` will now always evaluate to `true` at runtime (there is no other way to run the app), so the remaining `isTauri &&`/`enabled: isTauri` conditionals elsewhere in this file are unaffected — leave them as-is; they gate unrelated desktop-only features (command palette, `/settings` route, titlebar) and are out of scope for this removal.

- [ ] **Step 4: Remove the companion indicator from `src/components/AppSidebar/AppSidebar.tsx`**

Remove from the props interface:
```ts
  companionEnabled?: boolean;
  companionDeviceCount?: number;
```

Change the function signature:
```ts
export function AppSidebar({ updateAvailable, hasApprovedMRs, companionEnabled, companionDeviceCount = 0 }: AppSidebarProps) {
```
to:
```ts
export function AppSidebar({ updateAvailable, hasApprovedMRs }: AppSidebarProps) {
```

Remove the indicator block:
```tsx
        {companionEnabled && (
          <div
            className="app-sidebar-companion app-sidebar-desktop-only"
            title={`Companion: ${companionDeviceCount} device${companionDeviceCount !== 1 ? 's' : ''} connected`}
          >
            <SmartphoneIcon />
            {companionDeviceCount > 0 && (
              <span className="companion-dot" />
            )}
          </div>
        )}
```

Remove the now-unused `SmartphoneIcon` component definition (search for `const SmartphoneIcon = () => (` and delete the whole arrow-function icon block).

- [ ] **Step 5: Remove the companion-only rules from `src/components/AppSidebar/AppSidebar.css`**

Remove:
```css
.app-sidebar-companion {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.companion-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-color, #28a745);
  border: 2px solid var(--bg-secondary);
```
(include the rule's closing brace and any remaining declarations on the lines that follow, up to the next unrelated rule). Do not remove `.app-sidebar-desktop-only` — it is a shared class used by other sidebar items.

- [ ] **Step 6: Remove the Companion Server section from `src/pages/Settings/index.tsx`**

Remove the import:
```ts
import CompanionServerSection from './CompanionServerSection';
```
Remove the section:
```tsx
        {isTauri && (
          <CollapsibleSection title={<>Companion Server <span className="beta-badge">Beta</span></>}>
            <CompanionServerSection />
          </CollapsibleSection>
        )}

```

- [ ] **Step 7: Remove companion-only CSS from `src/pages/Settings.css`, keeping the two shared toggle rules**

The companion block runs from the `COMPANION SERVER SETTINGS` section comment through the last `.companion-device-revoke:disabled` rule (roughly lines 1141–1508 as currently ordered: section header, `.beta-badge`, `.companion-description`, `.companion-settings-form`, `.companion-toggle-row`, `.companion-toggle-label`, `.companion-toggle-text` + `.active`, then `.companion-toggle` + `:hover`/`.active`/`:disabled`, `.companion-toggle-knob` + `.active .companion-toggle-knob`, then port/connection-info/qr/pin/devices rules).

Delete everything in that block **except** these rules, which `AppearanceSection.tsx`'s condensed-list toggle also uses and must be kept:
```css
.companion-toggle {
  position: relative;
  width: 44px;
  height: 24px;
  background: var(--overlay-glass);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  padding: 0;
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.companion-toggle:hover:not(:disabled) {
  border-color: var(--text-fuji);
}

.companion-toggle.active {
  background: var(--accent-color);
  border-color: var(--accent-bg);
}

.companion-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.companion-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: var(--text-tertiary);
  border-radius: 50%;
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.companion-toggle.active .companion-toggle-knob {
  left: 22px;
  background: var(--bg-secondary);
}
```

Concretely: delete from the `COMPANION SERVER SETTINGS` section-header comment down through `.companion-toggle-text.active { ... }` (this removes the header comment, `.beta-badge`, `.companion-description`, `.companion-settings-form`, `.companion-toggle-row`, `.companion-toggle-label`, `.companion-toggle-text`, `.companion-toggle-text.active`), replacing it with a one-line comment:
```css
/* Shared toggle switch (also used by AppearanceSection's condensed-list toggle) */
```
directly above the `.companion-toggle { ... }` rule you're keeping. Then delete everything from the `/* Port input */` comment through `.companion-device-revoke:disabled { ... }` (the closing rule right before the `COLLAPSE PATTERNS EDITOR` section comment).

- [ ] **Step 8: Remove companion functions and type imports from `src/services/tauri.ts`**

Remove the type imports:
```ts
  CompanionServerSettings,
  CompanionStatus,
```
(from whichever `import type { ... } from '../types'` block they're in — remove just those two lines).

Remove the whole "Companion Server Settings Commands" section — every exported function from `getCompanionSettings` through `getCompanionStatus`, i.e.:
```ts
// Companion Server Settings Commands
// ...

/**
 * Get companion server settings.
 */
export async function getCompanionSettings(): Promise<CompanionServerSettings> {
  return invoke<CompanionServerSettings>('get_companion_settings');
}

/**
 * Update companion server settings.
 */
export async function updateCompanionSettings(companion: CompanionServerSettings): Promise<void> {
  return invoke<void>('update_companion_settings', { companion });
}

/**
 * Regenerate the companion server PIN. Returns the new PIN.
 */
export async function regenerateCompanionPin(): Promise<string> {
  return invoke<string>('regenerate_companion_pin');
}

/**
 * Set a custom companion server PIN (4–8 digits).
 */
export async function setCompanionPin(pin: string): Promise<void> {
  return invoke<void>('set_companion_pin', { pin });
}

/**
 * Generate QR code SVG for the companion server.
 */
export async function getCompanionQrSvg(): Promise<string> {
  return invoke<string>('get_companion_qr_svg');
}

/**
 * Revoke an authorized companion device.
 */
export async function revokeCompanionDevice(deviceId: string): Promise<void> {
  return invoke<void>('revoke_companion_device', { deviceId });
}

/**
 * Start the companion HTTP server.
 */
export async function startCompanionServer(): Promise<void> {
  return invoke<void>('start_companion_server_cmd');
}

/**
 * Stop the companion HTTP server.
 */
export async function stopCompanionServer(): Promise<void> {
  return invoke<void>('stop_companion_server_cmd');
}

/**
 * Get companion server status (enabled + connected device count).
 */
export async function getCompanionStatus(): Promise<CompanionStatus> {
  return invoke<CompanionStatus>('get_companion_status');
}
```

- [ ] **Step 9: Remove companion re-exports from `src/services/index.ts`**

Remove:
```ts
  getCompanionSettings,
  updateCompanionSettings,
  regenerateCompanionPin,
  revokeCompanionDevice,
  startCompanionServer,
  stopCompanionServer,
  getCompanionStatus,
```

- [ ] **Step 10: Remove companion types from `src/types/index.ts`**

Remove:
```ts
// ============================================================================
// Companion Server Settings
// ============================================================================

export interface AuthorizedDevice {
  id: string;
  name: string;
  token: string;
  lastActive: string;
  createdAt: string;
}

export interface CompanionServerSettings {
  enabled: boolean;
  port: number;
  pin: string;
  authorizedDevices: AuthorizedDevice[];
}

export interface CompanionStatus {
  enabled: boolean;
  connectedDevices: number;
}

```

- [ ] **Step 11: Remove companion query keys from `src/lib/queryKeys.ts`**

Remove:
```ts
  companionStatus: () => ["companionStatus"] as const,
  companionSettings: () => ["companionSettings"] as const,
```

- [ ] **Step 12: Verify the frontend typechecks and builds**

Run: `bunx tsc --noEmit`
Expected: no errors (in particular, no "cannot find module" for any deleted file, no unused-import errors).

Run: `bun run build`
Expected: build succeeds.

---

### Task 3: Clean up e2e fixtures and stale comments referencing companion mode

**Files:**
- Modify: `e2e/fixtures/seed-data.ts`
- Modify: `e2e/fixtures/tauri-mock.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: `CompanionServerSettings`/`CompanionStatus` types removed in Task 2 — this task removes the last references to them.
- Produces: no `companion` references remain anywhere under `e2e/`.

- [ ] **Step 1: Remove companion exports and imports from `e2e/fixtures/seed-data.ts`**

Remove the type imports:
```ts
  CompanionServerSettings,
  CompanionStatus,
```
Remove the exports:
```ts
export const companionStatus: CompanionStatus = {
  enabled: false,
  connectedDevices: 0,
};

export const companionSettings: CompanionServerSettings = {
  enabled: false,
  port: 8080,
  pin: '1234',
  authorizedDevices: [],
};
```
Update the section header comment (it currently reads `// Notification & Companion`) to:
```ts
// ============================================================================
// Notifications
// ============================================================================
```
Update the file's top docstring, which currently claims the app "uses companion HTTP mode" — replace:
```ts
 * This file provides deterministic test data that mirrors what the SQLite
 * database would contain. Since Playwright runs in a browser (no Tauri IPC),
 * the app uses companion HTTP mode. We intercept the /api/* routes with
 * this data so tests don't depend on a live GitLab instance.
```
with:
```ts
 * This file provides deterministic test data that mirrors what the SQLite
 * database would contain. `tauri-mock.ts` injects a fake `__TAURI_INTERNALS__`
 * so the app runs in desktop-Tauri mode against this seeded data, so tests
 * don't depend on a live GitLab instance.
```

- [ ] **Step 2: Remove companion mock command handlers from `e2e/fixtures/tauri-mock.ts`**

Remove from the serialized seed object:
```ts
    companionStatus: seed.companionStatus,
    companionSettings: seed.companionSettings,
```
Remove the mock command handlers:
```ts
      // -- Companion --
      get_companion_settings: () => data.companionSettings,
      update_companion_settings: () => undefined,
      get_companion_qr_svg: () => '<svg></svg>',
      get_companion_status: () => data.companionStatus,
      regenerate_companion_pin: () => '5678',
      revoke_companion_device: () => undefined,
      start_companion_server_cmd: () => undefined,
      stop_companion_server_cmd: () => undefined,
```

- [ ] **Step 3: Fix the stale comment in `playwright.config.ts`**

Replace:
```ts
/**
 * Playwright configuration for Ultra GitLab.
 *
 * Tests run against the Vite dev server. Since Playwright runs in a real browser
 * (no `__TAURI_INTERNALS__`), the app falls back to companion HTTP mode.
 * Tests use route interception to mock the `/api/*` responses with seeded data.
 */
```
with:
```ts
/**
 * Playwright configuration for Ultra GitLab.
 *
 * Tests run against the Vite dev server. `e2e/fixtures/tauri-mock.ts` injects a
 * fake `__TAURI_INTERNALS__` and mocks the Tauri `invoke()` calls with seeded data,
 * so the app runs in desktop-Tauri mode without needing a live GitLab instance.
 */
```

- [ ] **Step 4: Verify e2e fixtures still typecheck and tests still pass**

Run: `bunx tsc --noEmit`
Expected: no errors.

Run: `bun run test:e2e`
Expected: existing suite passes (no test was exercising `/auth` or companion commands directly, per repo search, so none should need updating).

---

### Task 4: Final sweep and full verification

**Files:**
- None (verification only), unless the grep in Step 1 turns up a residual reference — in which case fix it in its own file using the same pattern as the task above it covers.

- [ ] **Step 1: Grep for any remaining "companion" reference in source (excluding docs/history)**

Run:
```bash
grep -rli "companion" src src-tauri/src src-tauri/Cargo.toml src-tauri/tauri.conf.json e2e playwright.config.ts 2>/dev/null
```
Expected: no output. If anything appears, resolve it the same way the relevant task above handled its file, then re-run.

- [ ] **Step 2: Full Rust verification**

Run: `cd src-tauri && cargo check && cargo build`
Expected: builds cleanly.

- [ ] **Step 3: Full frontend verification**

Run: `bunx tsc --noEmit && bun run build`
Expected: builds cleanly.

- [ ] **Step 4: Manually confirm the Appearance section's condensed-list toggle still renders correctly**

Run: `bun run tauri dev`, open Settings → Appearance, and toggle "Condensed MR list". Confirm the switch still animates (knob slides, background color changes) — this is the regression check for the CSS classes kept in Task 2 Step 7.

- [ ] **Step 5: Full e2e suite**

Run: `bun run test:e2e`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove companion server now that iOS support exists"
```
