# Refresh Without Layout Shift — Design

**Date:** 2026-07-24
**Status:** Approved
**Follows:** `2026-07-24-desktop-refresh-animation-design.md`

## Goal

A desktop refresh (Mod+R / command palette) must cause zero cumulative layout shift. Today the programmatic refresh inserts the 40px inline pull indicator above the list, and the 2px `SyncProgressBar` under the header also nudges content. On touch (mobile) the inline pull indicator stays exactly as is — the pull gesture makes the shift natural there.

## Design

### 1. Programmatic refresh leaves `pullDistance` at 0

`usePullToRefresh`'s shared `runRefresh` gains a `holdIndicator` flag: the touch-release path passes `true` (unchanged behavior — indicator held at 80% threshold), `triggerRefresh` passes `false` so `pullDistance` stays 0 for the whole programmatic refresh.

### 2. Inline indicator renders only during a gesture

`PullToRefreshIndicator`'s render guard changes from `pullDistance <= 0 && !refreshing` to `pullDistance <= 0`. Gesture refreshes keep a non-zero held distance, so touch behavior is identical; programmatic refreshes never mount the inline indicator → nothing is inserted into the list flow.

### 3. `PageHeader` owns all refresh feedback, absolutely positioned

`PageHeader` gains `refreshing?: boolean`. When true it renders, inside the already-`position: relative` header:

- **Centered spinner + "Refreshing" label** (desktop only, `!isSmallScreen`): `position: absolute`, centered with `left: 50% / top: 50% / translate(-50%, -50%)`, `pointer-events: none`, opacity fade-in, same IBM Plex Mono styling and spinner glyph as the pull indicator. `aria-hidden` — the progress bar carries the a11y signal.
- **`SyncProgressBar`** (all screen sizes): moves from the pages into `PageHeader`, wrapped in an absolutely positioned strip pinned to the header's bottom edge (`left: 0; right: 0; bottom: 0`), overlaying the divider instead of pushing content. PageHeader is visible on mobile too, so mobile keeps its sync feedback.

### 4. Pages

All four surfaces pass their existing refreshing state to `PageHeader` (`syncing` on MRListPage, the hook's `refreshing` on MyMRsPage / IssuesPage / PipelinesPage) and drop their standalone `{… && <SyncProgressBar />}` renders and now-unused imports.

## Testing

- e2e: the Mod+R test asserts `.page-header-refreshing` is visible, the inline `.pull-refresh-indicator` is absent, and the first `.mr-list-item`'s `boundingBox().y` is unchanged after the refresh starts (CLS regression guard).
- Touch behavior covered by the existing mobile-search pull-gesture suite.
- `bunx tsc --noEmit`, `bun run lint`, full Playwright suite.

## Out of Scope

- Changing the pull gesture, thresholds, or mobile visuals.
