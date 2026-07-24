# Desktop Refresh Animation (Cmd+R) — Design

**Date:** 2026-07-24
**Status:** Approved

## Goal

Show the iOS pull-to-refresh indicator animation (spinner + "Refreshing" label sliding out at the top of the list) on desktop as well. On desktop the trigger is the Cmd+R / Ctrl+R keyboard shortcut. The header refresh button is removed — background syncing is solid, so a visual button is unnecessary.

## Current State

- `src/hooks/usePullToRefresh.ts` owns the animation state (`pullDistance`, `refreshing`) and is driven exclusively by touch events, so the indicator never appears on desktop.
- `src/components/PullToRefresh/PullToRefreshIndicator.tsx` renders the indicator; its CSS (`.pull-refresh-indicator--active`) already transitions height, so a programmatic jump into the refreshing state animates smoothly with no CSS changes.
- Four surfaces use pull-to-refresh: `MRList` (used by `MRListPage`), `MyMRsPage`, `IssuesPage`, `PipelinesPage`.
- Three pages (`MRListPage`, `MyMRsPage`, `IssuesPage`) also pass `onRefresh` to `PageHeader`, which renders a desktop-only refresh button. On `MRListPage`/`MyMRsPage` that button performs a *lighter* refresh (`queryClient.invalidateQueries`) than the pull gesture's full sync (`manualSyncAndWait(true)`).
- There is no existing global Cmd+R handler; the Tauri WebView's default Cmd+R reloads the page, so the new handler must `preventDefault`.

## Design

### 1. `usePullToRefresh`: programmatic trigger

Add `triggerRefresh(): Promise<void>` to the hook's return value:

- No-op (resolve immediately) when already refreshing or when `disabled`.
- Otherwise run the exact sequence the touch-release-past-threshold path runs today: set `refreshing` true, hold `pullDistance` at `PULL_THRESHOLD * 0.8`, await `onRefresh`, then reset everything in a `finally`.
- Refactor that sequence into one shared internal function so touch release and `triggerRefresh` cannot drift apart.

### 2. New hook: `useRefreshShortcut`

`src/hooks/useRefreshShortcut.ts`:

- `useRefreshShortcut(trigger: () => void | Promise<void>, options?: { disabled?: boolean })`
- Listens for `keydown` on `window` where `(metaKey || ctrlKey) && key === 'r'` without other modifiers.
- Calls `e.preventDefault()` (blocks the WebView reload), ignores `e.repeat`, then calls `trigger`.
- Re-triggering while a refresh is in flight is harmless because `triggerRefresh` guards on `refreshing`.

### 3. Wiring (all four surfaces)

Call `useRefreshShortcut(triggerRefresh)` immediately next to the existing `usePullToRefresh` call in:

- `src/components/MRList/MRList.tsx` (covers `MRListPage`; no imperative-handle changes needed)
- `src/pages/MyMRsPage.tsx`
- `src/pages/IssuesPage.tsx`
- `src/pages/PipelinesPage/index.tsx`

Consequence: Cmd+R performs the **full sync** the pull gesture performs (`manualSyncAndWait(true)` / `handleSync` / `handleRefresh`), replacing the header button's lighter invalidate-only refresh. The existing `SyncProgressBar` keeps working unchanged since it is driven by the same `refreshing` state.

### 4. Remove the header refresh button

- `PageHeader`: delete the refresh button markup and the `onRefresh` / `refreshAriaLabel` props.
- Remove the now-dead `onRefresh`/`refreshAriaLabel` arguments at the three call sites (`MRListPage`, `MyMRsPage`, `IssuesPage`), including the `invalidateQueries` handlers that only the button used.

## Error Handling

- `onRefresh` rejections: state reset happens in `finally` (as today), so the indicator always collapses even when a sync fails.
- Shortcut during an in-flight refresh: guarded, no double-run.
- Shortcut while typing in an input: Cmd+R is not a text-editing chord, so no input-focus exclusion is needed.

## Testing

- `bunx tsc --noEmit` for types.
- Manual: run the app, press Cmd+R on each of the four pages — indicator slides out, spinner spins, collapses when the sync completes. Verify the WebView no longer reloads on Cmd+R.
- Verify touch pull-to-refresh still behaves identically (shared code path).

## Out of Scope

- Trackpad/wheel overscroll pull gesture on desktop.
- Any change to the indicator's visuals or CSS.
