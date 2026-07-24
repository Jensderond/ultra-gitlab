# Desktop Refresh Animation (Cmd+R) — Design

**Date:** 2026-07-24
**Status:** Approved (revised: reuse the existing `trigger-sync` Mod+R hotkey instead of a new keydown hook)

## Goal

Show the iOS pull-to-refresh indicator animation (spinner + "Refreshing" label sliding out at the top of the list) on desktop as well. On desktop the trigger is the Cmd+R / Ctrl+R keyboard shortcut. The header refresh button is removed — background syncing is solid, so a visual button is unnecessary.

## Current State

- `src/hooks/usePullToRefresh.ts` owns the animation state (`pullDistance`, `refreshing`) and is driven exclusively by touch events, so the indicator never appears on desktop.
- `src/components/PullToRefresh/PullToRefreshIndicator.tsx` renders the indicator; its CSS (`.pull-refresh-indicator--active`) already transitions height, so a programmatic jump into the refreshing state animates smoothly with no CSS changes.
- Four surfaces use pull-to-refresh: `MRList` (used by `MRListPage`), `MyMRsPage`, `IssuesPage`, `PipelinesPage`.
- **Mod+R already exists**: the customizable `trigger-sync` shortcut (`src/config/shortcuts.ts`, default `Mod+R`) is handled globally in `App.tsx` via `useHotkey` and calls `manualSync(true)` — fire-and-forget, no visual feedback. The command palette's `CommandId.TriggerSync` does the same.
- All four pages pass `onRefresh` to `PageHeader`, which renders a desktop-only refresh button (`data-tour="refresh"`). On `MRListPage`/`MyMRsPage` that button performs a *lighter* refresh (`queryClient.invalidateQueries`) than the pull gesture's full sync.
- The product tour has a step anchored to `[data-tour="refresh"]`, and `e2e/mr-list.spec.ts` has a "shows refresh button" test — both must change when the button goes away.

## Design

### 1. `usePullToRefresh`: programmatic trigger

Add `triggerRefresh(): Promise<void>` to the hook's return value:

- No-op (resolve immediately) when already refreshing or when `disabled`.
- Otherwise run the exact sequence the touch-release-past-threshold path runs today: set `refreshing` true, hold `pullDistance` at `PULL_THRESHOLD * 0.8`, await `onRefresh`, then reset everything in a `finally`.
- Refactor that sequence into one shared internal `runRefresh` so touch release and `triggerRefresh` cannot drift apart.

### 2. Manual-refresh registry

The Mod+R handler lives in `App.tsx`; the animation state lives in whichever page is mounted. A tiny module-level registry connects them:

- `src/services/manualRefresh.ts`: `registerManualRefreshHandler(handler)` (returns an unregister function; last registration wins, unregister only clears its own) and `runManualRefresh()` — calls the registered handler if present, otherwise falls back to `manualSync(true)` so Mod+R keeps working on pages without pull-to-refresh (MR detail, Settings, …).
- `src/hooks/useManualRefreshHandler.ts`: React wrapper that registers on mount / unregisters on unmount, with an `enabled` flag and a ref so the latest handler is always called.
- `App.tsx`: the `trigger-sync` hotkey handler and the command palette's `CommandId.TriggerSync` both call `runManualRefresh()` instead of `manualSync(true)`.

Only one pull-to-refresh surface is mounted at a time (they are distinct routes), so a singleton registry is sufficient.

### 3. Wiring (all four surfaces)

Call `useManualRefreshHandler(triggerRefresh, …)` next to the existing `usePullToRefresh` call in:

- `src/components/MRList/MRList.tsx` (enabled when `onRefresh` is provided)
- `src/pages/MyMRsPage.tsx`
- `src/pages/IssuesPage.tsx` (enabled when an instance is selected)
- `src/pages/PipelinesPage/index.tsx`

Consequence: Mod+R on these pages performs the **full sync** the pull gesture performs, with the indicator animation, replacing both the silent `manualSync` and the header button's lighter invalidate-only refresh. The existing `SyncProgressBar` keeps working unchanged since it is driven by the same `refreshing` state.

### 4. Remove the header refresh button

- `PageHeader`: delete the refresh button markup and the `onRefresh` / `refreshDisabled` / `refreshAriaLabel` props; delete the `.page-header-refresh` CSS rules.
- Remove the now-dead arguments at the four call sites, including the `invalidateQueries` handlers that only the button used (and any imports that become unused).
- Product tour: the "Stay in sync" step loses its `[data-tour="refresh"]` anchor — make it an element-less (centered) step and update the copy to mention ⌘R.
- e2e: replace `mr-list.spec.ts` "shows refresh button" with a test that Mod+R shows the refresh indicator. `product-tour.spec.ts` step-4 assertions ("Stay in sync") still hold.

## Error Handling

- `onRefresh` rejections: state reset happens in `finally` (as today), so the indicator always collapses even when a sync fails.
- Shortcut during an in-flight refresh: `triggerRefresh` guards on `refreshing`, no double-run.
- Mod+R on pages without pull-to-refresh: falls back to the current silent `manualSync(true)`.

## Testing

- e2e (Playwright, mocked Tauri): pressing Mod+R on `/mrs` shows `.pull-refresh-indicator--active`. The mock never emits `sync-progress`, so the indicator stays visible long enough to assert.
- `bunx tsc --noEmit` for types, `bun run lint` for unused imports.
- Manual: run the app, press Cmd+R on each of the four pages — indicator slides out, spinner spins, collapses when the sync completes. Verify touch pull-to-refresh still behaves identically (shared code path).

## Out of Scope

- Trackpad/wheel overscroll pull gesture on desktop.
- Any change to the indicator's visuals or CSS.
