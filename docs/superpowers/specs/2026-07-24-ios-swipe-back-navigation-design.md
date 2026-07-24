# iOS Swipe-Back Navigation

## Problem

The iOS app has no swipe-from-left-edge-to-go-back gesture on drill-in screens
(MR detail, My MR detail, Pipeline detail, Job log, Issue detail, Settings
section drill-in). Users must tap the on-screen back button, which doesn't
match the system navigation pattern iOS users expect.

## Approach

Enable WKWebView's native `allowsBackForwardNavigationGestures` property on
iOS. This is the same mechanism Safari and most WebView-based iOS apps use for
swipe-back — real system gesture physics, interactive drag-to-cancel, and a
snapshot of the previous screen during the drag, all provided by WebKit.

The app already uses React Router's `BrowserRouter`, so every `navigate()`
call (going into a detail page, into a Settings section, etc.) already pushes
a real HTML5 history entry. WKWebView's back-forward gesture operates on that
same history stack via `popstate`/`pushstate`, so enabling the flag makes
swipe-back work correctly across every drill-in screen at once — no
per-route wiring needed. The gesture only arms where `canGoBack` is true, so
root/list screens (`/mrs`, `/my-mrs`, `/pipelines`, `/issues`) are unaffected
automatically.

Scope: iOS only. Not macOS — out of scope for this change (a possible fast
follow if trackpad swipe-back is wanted later, but not requested here).

### Why native over a custom JS gesture

A custom `useSwipeBack` hook (matching the shape of the existing
`usePullToRefresh`) was considered, but would require keeping two routes
mounted during the drag and reimplementing iOS's interactive pop transition
(easing, rubber-banding, cancel-mid-drag) from scratch — the app currently
has no route-transition animation infrastructure to build on. The native
property gets the real system behavior for a few lines of Rust.

## Implementation

**`src-tauri/Cargo.toml`** — add an iOS-only dependency, mirroring the
existing macOS-only dependency section:

```toml
[target."cfg(target_os = \"ios\")".dependencies]
objc2-web-kit = "0.3"
```

(`objc2-web-kit` 0.3.2 is already resolved transitively via
`tauri-runtime-wry`, per `Cargo.lock`, so this pins no new major version.)

**`src-tauri/src/lib.rs`** — in the mobile window setup, keep the window
binding (currently discarded as `_win`) and, on iOS, reach into the native
webview to flip the flag:

```rust
#[cfg(mobile)]
let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?;

#[cfg(target_os = "ios")]
win.with_webview(|webview| {
    use objc2_web_kit::WKWebView;
    unsafe {
        let webview: &WKWebView = &*webview.inner().cast();
        webview.setAllowsBackForwardNavigationGestures(true);
    }
})?;
```

This mirrors the existing macOS `ns_window()` customization pattern already
in `lib.rs` (same `with_webview` / raw-pointer-cast approach, different
platform accessor).

No frontend changes are required.

## Caveats

- The system edge-swipe recognizer only arms within ~20pt of the left screen
  edge. This shouldn't conflict with horizontally-scrollable content (e.g.
  wide diffs) unless a drag starts right at the edge — the same trade-off
  Safari has for any page with edge-adjacent horizontal scrolling.
- Verification requires a real device/simulator build (`bun run tauri ios
  dev` or an installed debug build) — this gesture cannot be exercised in a
  desktop browser.

## Testing

Manual verification only, on the iOS Simulator:
1. Open an MR detail page from the MR list → swipe from the left edge →
   confirm it returns to the list with the native interactive drag.
2. Same for My MR detail, Pipeline detail (and Job log, one level deeper),
   Issue detail.
3. Settings: drill into a section → swipe back → confirm it returns to the
   Settings section list, not further back to whatever screen was open
   before Settings.
4. Confirm swiping from the edge on a root screen (MR list, My MRs,
   Pipelines, Issues) does nothing (no back target).
5. Confirm the existing on-screen back buttons still work unchanged.
