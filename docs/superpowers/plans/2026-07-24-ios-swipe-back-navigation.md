# iOS Swipe-Back Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the native WKWebView edge-swipe-to-go-back gesture on the iOS build, so every drill-in screen (MR detail, My MR detail, Pipeline detail, Job log, Issue detail, Settings section) supports swipe-back the same way Safari does.

**Architecture:** One Rust-only change in `src-tauri`. On iOS, reach into the native `WKWebView` handle Tauri exposes via `WebviewWindow::with_webview` and flip `allowsBackForwardNavigationGestures` to `true`. The app already uses React Router's `BrowserRouter`, so this operates on the same history stack `navigate()` already pushes to — no frontend code changes.

**Tech Stack:** Rust (Tauri 2.11), `objc2-web-kit` 0.3 (WKWebView bindings), no frontend changes.

## Global Constraints

- iOS only — do not gate this behind `target_os = "macos"` or `cfg(mobile)` generally; use `target_os = "ios"` specifically.
- No frontend changes required or permitted for this feature — the mechanism relies entirely on native browser history, not React state.
- Must not affect the existing macOS `ns_window()` customization block or the desktop `WebviewWindowBuilder` branch in `src-tauri/src/lib.rs`.
- Pin `objc2-web-kit` to `"0.3"` (already resolved to 0.3.2 transitively via `tauri-runtime-wry` per `Cargo.lock` — no new major version enters the dependency tree).

---

### Task 1: Enable `allowsBackForwardNavigationGestures` on iOS

**Files:**
- Modify: `src-tauri/Cargo.toml` (add iOS-only dependency section)
- Modify: `src-tauri/src/lib.rs:207-216` (mobile window setup block)

**Interfaces:**
- Consumes: `tauri::WebviewWindowBuilder`, `tauri::WebviewWindow::with_webview` (existing Tauri APIs already used by the macOS `ns_window()` block a few lines below in the same file).
- Produces: nothing consumed by later tasks — this is the only code task in this plan.

- [ ] **Step 1: Add the iOS-only dependency**

In `src-tauri/Cargo.toml`, after the existing `[target."cfg(target_os = \"macos\")".dependencies]` section (currently ending at the `objc2-foundation = "0.3"` line), add:

```toml
[target."cfg(target_os = \"ios\")".dependencies]
objc2-web-kit = "0.3"
```

- [ ] **Step 2: Verify the dependency resolves without changing the locked version**

Run: `cd src-tauri && cargo check --target aarch64-apple-ios-sim 2>&1 | tail -20`

Expected: compiles (pre-existing warnings are fine); no error about `objc2-web-kit` version resolution. Then run `git diff Cargo.lock | grep -A2 'name = "objc2-web-kit"'` — expected: empty output (version stays at `0.3.2`, already present transitively).

- [ ] **Step 3: Wire up the native call in `lib.rs`**

Current code at `src-tauri/src/lib.rs:207-216`:

```rust
            // Create window with transparent titlebar (desktop); mobile gets a plain window
            #[cfg(desktop)]
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Ultra Gitlab")
                .inner_size(800.0, 600.0)
                .hidden_title(true)
                .title_bar_style(TitleBarStyle::Transparent)
                .build()?;
            #[cfg(mobile)]
            let _win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?;
```

Replace the `#[cfg(mobile)]` line with a binding that's kept (not discarded), followed by an iOS-only block that flips the gesture flag:

```rust
            // Create window with transparent titlebar (desktop); mobile gets a plain window
            #[cfg(desktop)]
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Ultra Gitlab")
                .inner_size(800.0, 600.0)
                .hidden_title(true)
                .title_bar_style(TitleBarStyle::Transparent)
                .build()?;
            #[cfg(mobile)]
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?;

            // iOS: enable the native edge-swipe-to-go-back gesture. Safe because
            // the app uses BrowserRouter — every navigate() call already pushes a
            // real history entry, so this operates on the same back/forward stack.
            #[cfg(target_os = "ios")]
            win.with_webview(|webview| {
                use objc2_web_kit::WKWebView;
                unsafe {
                    let webview: &WKWebView = &*webview.inner().cast();
                    webview.setAllowsBackForwardNavigationGestures(true);
                }
            })?;
```

Note: on non-iOS mobile (Android), `win` is now used only to satisfy the binding — this matches how the desktop `win` binding is used later in the same `setup` closure (e.g. by the tray icon block), so an unused-variable warning is not expected on Android either, since `win` remains in scope for the rest of the closure. If `cargo check --target aarch64-linux-android` (if ever run) flags `win` as unused, that's pre-existing to this task's scope — do not add Android-specific handling.

- [ ] **Step 4: Verify iOS target compiles with the new code**

Run: `cd src-tauri && cargo check --target aarch64-apple-ios-sim 2>&1 | tail -30`

Expected: `Checking ultra-gitlab v0.24.1 (...)` completes with no errors (pre-existing warnings unrelated to this change are fine).

- [ ] **Step 5: Verify desktop build is unaffected**

Run: `cd src-tauri && cargo check 2>&1 | tail -30`

Expected: compiles cleanly, same as before this change (the `#[cfg(target_os = "ios")]` block is compiled out entirely on desktop targets).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(ios): enable native swipe-back gesture via WKWebView"
```

---

### Task 2: Verify the gesture on the iOS Simulator

**Files:** none (manual verification only — no code changes in this task).

**Interfaces:**
- Consumes: the iOS build produced from Task 1's committed code.
- Produces: nothing — this is the terminal task in this plan.

- [ ] **Step 1: Build and install a debug build on the iOS Simulator**

Use the project's existing iOS Simulator tooling (Claude Code's iOS Simulator MCP `build`/`control` tools, per [[ios-simulator-mcp-quirks]] in project memory) to build the app for the simulator and install/launch it. If using the MCP build tool isn't available in this environment, fall back to:

```bash
bun run tauri ios build --debug
```

then install the resulting `.app` under `src-tauri/gen/apple/build/` onto a booted simulator via `xcrun simctl install booted <path-to-.app>` and launch with `xcrun simctl launch booted com.jens.ultra-gitlab`.

Expected: app installs and launches, showing the MR list (or instance setup if no instance is configured).

- [ ] **Step 2: Verify swipe-back on MR detail**

From the MR list, tap into an MR to open MR detail. Swipe from the left edge of the screen toward the right.

Expected: the screen follows the finger with the native interactive drag (a snapshot of the MR list slides in from the left), and releasing past the halfway point completes the transition back to the MR list. Releasing before the halfway point (or dragging back to the left edge) cancels and returns to MR detail.

- [ ] **Step 3: Verify swipe-back on My MR detail, Pipeline detail, Job log, and Issue detail**

Repeat the same edge-swipe on:
- My MRs → a My MR detail screen
- Pipelines → a Pipeline detail screen
- Pipeline detail → a Job log screen (one level deeper — confirm it goes back to Pipeline detail, not the Pipelines list)
- Issues → an Issue detail screen

Expected: same interactive drag-back behavior on each, always landing one level up in the navigation stack it came from.

- [ ] **Step 4: Verify Settings drill-in lands on the section list, not further back**

Open Settings, drill into any section (e.g. Appearance), then swipe back from the left edge.

Expected: returns to the Settings section list (`/settings`), not to whatever screen was open before Settings was opened.

- [ ] **Step 5: Verify root screens don't respond to the gesture**

On each of the MR list, My MRs, Pipelines, and Issues root screens (nothing pushed on top), swipe from the left edge.

Expected: nothing happens — no drag, no snapshot, no navigation (there's no back-forward-list entry to go to).

- [ ] **Step 6: Verify the existing on-screen back buttons still work unchanged**

On any drill-in screen from Steps 2–4, tap the on-screen back button (chevron, `BackButton` component) instead of swiping.

Expected: identical behavior to before this change — navigates back one level, same as the swipe gesture.

- [ ] **Step 7: Record the result**

If all six checks pass, the feature is complete — no further commit needed (Task 1's commit already contains the full change). If any check fails, note which one and return to Task 1 to adjust the implementation (e.g. re-check whether `win.with_webview` actually ran, via `log::info!` temporarily added before the `unsafe` block, rebuilt, and checked with `xcrun simctl spawn booted log stream --predicate 'process == "Ultra Gitlab"'` while launching).

## Self-Review Notes

- **Spec coverage:** Cargo.toml dependency ✅ (Task 1 Step 1), lib.rs code change ✅ (Task 1 Step 3), no frontend changes ✅ (explicit constraint, no frontend files touched), iOS-only scope ✅ (`target_os = "ios"`, not `mobile` or `macos`), all five manual test scenarios from the spec's Testing section ✅ (Task 2 Steps 2–6), caveat about edge-adjacent horizontal scroll is inherent to the native gesture and not independently testable/actionable — noted in the spec, not a separate task.
- **Placeholder scan:** no TBD/TODO; every step has literal commands or literal code.
- **Type consistency:** `win` binding introduced in Task 1 Step 3 is the only new identifier and is used consistently within that same step; no later task references it.
