# iOS Dev Build of Ultra GitLab — Design

**Date:** 2026-07-23
**Status:** Approved
**Milestone:** App compiles, installs, launches, and renders on Jens' iPhone 17 ("iPhone van Jens"). No mobile UI adaptation.

## Context

Ultra GitLab is a Tauri v2 desktop app (React 19 + Rust). Goal: get a dev build running on a physical iPhone using Apple Developer Team ID `799QBY4RBJ`. Xcode 26.6 is installed; the iPhone 17 is connected and visible to `devicectl`.

Desktop-only code that blocks an iOS build today:

- System tray + menu setup in `src-tauri/src/lib.rs` (tray APIs don't exist on iOS; `tray-icon` cargo feature is desktop-only)
- Updater plugin (`tauri-plugin-updater`) — not supported on iOS
- Process plugin usage tied to updater restart flow
- macOS transparent-titlebar window options and `ns_window` background color code
- Hide-on-close window behavior

## Design

### 1. Scaffold & signing

- `rustup target add aarch64-apple-ios`
- `bun tauri ios init` → generates `src-tauri/gen/apple` (Xcode project, checked into git)
- Add to `tauri.conf.json`: `bundle.iOS.developmentTeam = "799QBY4RBJ"` (team IDs are not secret; keeps signing repeatable)
- Developer Mode must be enabled on the phone; developer cert trusted on first install

### 2. Rust gating

- **Cargo.toml:** target-specific dependency declarations — `tray-icon` feature on `tauri` and the `tauri-plugin-updater` dependency only for desktop targets (`cfg(not(any(target_os = "android", target_os = "ios")))`). Ensure `crate-type` includes `staticlib` for iOS.
- **lib.rs:**
  - `#[cfg(desktop)]` around: tray + menu setup, updater and process plugin registration, titlebar window options, hide-on-close `on_window_event` behavior, and any other desktop-only API use surfaced by `cargo check --target aarch64-apple-ios`
  - On mobile: build a plain `main` `WebviewWindowBuilder` window (no titlebar options)
  - Add `#[cfg_attr(mobile, tauri::mobile_entry_point)]` on the run function
- Everything else (sqlx/SQLite, GitLab client, deep-link plugin — already has a `mobile` key) is expected to compile as-is. If a plugin (e.g. aptabase) turns out not to support iOS, gate it the same way.

### 3. Dev loop & verification

- `bun tauri ios dev` targeting "iPhone van Jens"; Vite config already handles `TAURI_DEV_HOST` for physical-device HMR over Wi-Fi
- **Success:** app installs, launches, renders UI on the phone (fresh install, so the instance-setup/settings screen counts)
- **Regression:** desktop `cargo check` passes, `bunx tsc --noEmit` passes, `bun run tauri dev` still shows the tray icon

## Out of scope

- Mobile UI adaptation (follow-up project)
- TestFlight / App Store distribution
- iOS-specific secure storage for the GitLab token

## Execution notes

- Code changes executed by Sonnet subagents; orchestrator verifies each step (builds, device runs).
