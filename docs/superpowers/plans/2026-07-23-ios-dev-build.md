# Plan: iOS Dev Build of Ultra GitLab

Spec: `docs/superpowers/specs/2026-07-23-ios-dev-build-design.md`
Branch: `ios-support`

## Global Constraints

- Apple Developer Team ID: `799QBY4RBJ` (goes in `tauri.conf.json` under `bundle.iOS.developmentTeam`)
- Desktop behavior must not change: tray icon, menu, updater, transparent titlebar, hide-on-close all still work on macOS. `cargo check` (host) and `bunx tsc --noEmit` must pass.
- iOS target must compile: `cargo check --target aarch64-apple-ios` passes from `src-tauri/`.
- Use `#[cfg(desktop)]` / `#[cfg(mobile)]` (Tauri's aliases) rather than raw `target_os` cfgs in `lib.rs`.
- Package manager is `bun`.

## Task 1: Scaffold iOS project (orchestrator — environment work)

- `git checkout -b ios-support`
- `rustup target add aarch64-apple-ios`
- `bun tauri ios init` → generates `src-tauri/gen/apple`
- Commit scaffold.

## Task 2: Gate desktop-only code for iOS compilation (subagent)

**Files:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`

1. **Cargo.toml**: `tauri` currently has `features = ["tray-icon"]` and `tauri-plugin-updater` is an unconditional dependency. Restructure so:
   - Base `tauri` dependency (all targets) has no `tray-icon` feature.
   - `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]` section adds `tauri = { version = "2", features = ["tray-icon"] }` and moves `tauri-plugin-updater = "2"` there.
   - Leave `crate-type` as is (already includes `staticlib`).
2. **lib.rs**: gate behind `#[cfg(desktop)]`:
   - `tauri::menu`/`tauri::tray` imports and the whole tray + menu setup block
   - `.plugin(tauri_plugin_updater::Builder::new().build())` registration (keep `tauri_plugin_process` only if it supports mobile — it is desktop-only, gate it too)
   - Transparent-titlebar window builder options (`TitleBarStyle`, `title_bar_style`, `hidden_title`, etc.) and the macOS `ns_window` block (already `cfg(target_os = "macos")` — leave as is if so)
   - Hide-on-close behavior in `on_window_event` (on mobile there is no close-to-tray concept)
   - Any updater/restart command wiring that references the gated plugins
   - On mobile, still create the `main` window: plain `WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?` with no desktop-only options.
   - `#[cfg_attr(mobile, tauri::mobile_entry_point)]` already exists on `run()` — keep it.
3. **tauri.conf.json**: add `"iOS": { "developmentTeam": "799QBY4RBJ" }` under `bundle`.
4. If `cargo check --target aarch64-apple-ios` surfaces other desktop-only plugins (e.g. aptabase) or APIs, gate them the same way.

**Verify:** `cargo check` (host) passes, `cargo check --target aarch64-apple-ios` passes, `bunx tsc --noEmit` passes. Commit.

## Task 3: Frontend guard for desktop-only invokes (subagent, only if needed)

If the app crashes or errors at runtime on iOS due to invoking desktop-only commands (updater check on startup, etc.), gate those calls by platform via `@tauri-apps/api` `platform()`. Skip if runtime is clean.

## Task 4: Device run & verification (orchestrator)

- `bun tauri ios dev` (or `ios build --debug` + install) targeting "iPhone van Jens"
- Success: app installs, launches, renders the setup/settings UI on the phone.
- Regression: desktop `bun run tauri dev` still shows tray icon and window chrome.
