# MR list: swipe between status tabs (mobile pager)

**Date:** 2026-07-30
**Scope:** `MRListPage` (small screens), new `src/components/TabPager/`, `SwipeActionRow`

## Problem

On touch the three status tabs (Needs review / Approved / Snoozed) can only be
switched by tapping the tab strip. The natural iOS gesture — sliding the view
horizontally to move between adjacent pages, finger-tracked, like Photos or the
App Store — does nothing. The desktop stepping shortcuts (⌃⌥←/→) wrap at the
ends; the touch gesture must **not** wrap: swiping past the first or last tab
rubber-bands, as a native pager would.

The gesture has to coexist with two existing touch owners on the same surface:

- **Row swipe-left** (`useSwipeAction` via `SwipeActionRow`) opens the snooze
  presets. It only ever claims *leftward* drags, and only on rows where snoozing
  is available (`swipeDisabled` is true on approved rows).
- **Pull-to-refresh** (`usePullToRefresh`) owns vertical overscroll.

## Non-goals

- **Desktop.** Pointer screens keep the single `MRList` instance and the
  keyboard shortcuts. Nothing changes there.
- **Wrapping.** The pager never wraps; only the keyboard stepping does.
- **Tab-strip indicator tracking.** The active pill flips on commit; it does not
  slide proportionally during the drag. The finger-tracked content *is* the
  feedback (better-ui motion restraint).
- **Haptics.** Native pagers don't buzz; neither does this one.
- **Other tabbed surfaces** (`MyMRDetailPage`). Revisit only if wanted there.

## Design

### 1. `TabPager` component (`src/components/TabPager/`)

A generic, reusable horizontal pager: `TabPager.tsx` + `TabPager.css`.

```tsx
interface TabPagerProps {
  /** Which pane is active — controlled by the parent (URL-derived). */
  activeIndex: number;
  /** Called when a swipe commits to a neighbouring pane. */
  onCommit: (index: number) => void;
  /** Disables the gesture (e.g. while filtering). Panes still render. */
  disabled?: boolean;
  /** The panes, in tab order. */
  children: ReactNode[];
}
```

**Structure.** An `overflow: hidden` viewport wrapping a flex track; each pane
is `flex: 0 0 100%` and its own vertical scroll context. Track position is
`translateX(calc(-activeIndex * 100% + dragOffsetPx))`.

**Gesture.** Native touch listeners on the viewport, mutable gesture state in a
ref (same pattern as `useSwipeAction` / `usePullToRefresh`):

- Intent: 8px movement threshold, horizontal-dominance test. Vertical intent
  hands the touch back for good — scrolling and pull-to-refresh are never
  hijacked. `touch-action: pan-y` on the track; `preventDefault()` on moves
  only once the gesture is armed.
- **Arbitration with row swipe:** on touchstart, record whether the target sits
  inside a swipe-enabled row (`target.closest('[data-swipe-row]')`). If so,
  leftward drags never arm the pager — the row's snooze gesture wins left.
  Rightward drags, and either direction starting on empty space, disabled rows,
  footer, or empty states, belong to the pager.
- **Commit rule:** on release, commit to the neighbour when the drag exceeds
  40% of the pane width **or** the release is a flick (velocity over the last
  few move events above ~0.3 px/ms in the drag direction). Otherwise spring
  back.
- **Non-wrapping rubber band:** dragging outward at either end damps the offset
  by 0.3 — the same `OVERDRAG_RESISTANCE` feel as the row swipe.

**Motion (better-ui).**

- No transition while the finger is down; the track follows the finger 1:1.
- On release (commit or spring-back): `transition: transform 300ms` ease-out —
  property-specific, never `transition: all`.
- **Interruptible:** a touchstart mid-settle reads the track's computed
  transform, kills the transition, and seeds the new drag from wherever the
  track visually is.
- `prefers-reduced-motion`: no transition — tab changes jump-cut.
- `will-change: transform` only if the simulator shows first-frame stutter.

**A11y.** Inactive panes get `inert` and `aria-hidden` so focus and VoiceOver
cannot wander into off-screen content.

### 2. `SwipeActionRow`: advertise the swipe surface

The row root gains `data-swipe-row` when the swipe is enabled (i.e. not
`disabled`). This is the only change to existing components, and it is what the
pager's arbitration keys on.

### 3. `MRListPage` wiring

On small screens (`useSmallScreen`, the same gate the mobile search button
uses), the single `<MRList>` is replaced by:

```tsx
<TabPager
  activeIndex={STATUS_TABS.findIndex((t) => t.id === activeTab)}
  onCommit={(i) => setActiveTab(STATUS_TABS[i].id)}
  disabled={filtering}
>
  {STATUS_TABS.map((tab) => (
    <MRList key={tab.id} activeTab={tab.id} … />
  ))}
</TabPager>
```

- **Active-pane-only props:** `searchSlot`, `filterQuery`,
  `onFilteredCountChange`, `onMRsLoaded`, `onCountsChange`, `onRefresh`,
  `onRefreshingChange`, and the `mrListRef` imperative handle are passed only
  to the pane whose tab is active. This avoids triple manual-refresh
  registration (`useManualRefreshHandler` is mounted per `MRList` with
  `onRefresh`) and triple count/list reporting. Inactive panes get the minimal
  set: `instanceId`, `activeTab`, `condensed`, `onSelect`, `onSelectTab`, and
  the snooze-menu wiring.
- **Commit path:** `onCommit` goes through the existing `setActiveTab` → URL
  replace. Tab taps, `Shift+Z`, the empty-state shortcut buttons, and the iOS
  edge-swipe-back restore all keep working unchanged — and a tab *tap* now also
  slides the track, since `activeIndex` changes animate via the same
  transition.
- **Filtering** disables the gesture (`disabled={filtering}`): the tab strip is
  a read-only match breakdown then, same reasoning as the disabled keyboard
  stepping.
- Desktop renders exactly what it renders today.

### 4. Data flow

All three panes call `useMRListQuery(instanceId)` — identical query key, so
React Query dedupes to a single fetch; each pane partitions and renders only
its own category. Each pane keeps its own `scrollTop` while mounted (the native
payoff of side-by-side panes); the existing `listPosition` store still covers
remounts (navigating to an MR and back). Loading/error states render per pane
as today.

### 5. Known risk: iOS edge-swipe-back

The OS back gesture starts at the left screen edge and could fight a rightward
pager drag. The WebView usually claims it first (the page sees a `touchcancel`,
which the pager must treat as a clean release-without-fire). If the simulator
shows a real conflict, add a ~20px left-edge dead zone for pager arming.

## Testing

- **Playwright (e2e):** touch-context test following the existing row-swipe
  gesture patterns — read the `e2e-touch-gesture-testing` memory first
  (synthetic touches need care to flush React state). Cover: swipe left
  commits to the next tab (URL updates), swipe right at Needs review rubber-
  bands and stays, swipe-left starting on a snoozable row opens the snooze
  action instead of switching tabs.
- **Manual (iOS simulator):** finger tracking, flick commit below the 40%
  threshold, rubber band at both ends, interruptible settle, row snooze still
  works, pull-to-refresh unaffected, filtering disables the pager, edge-swipe-
  back still navigates back.
