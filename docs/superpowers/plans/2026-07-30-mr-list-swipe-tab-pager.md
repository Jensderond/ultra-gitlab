# MR List Swipe Tab Pager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On touch/small screens, swiping the MR list horizontally pages between the three status tabs (Needs review / Approved / Snoozed) with finger-tracked, non-wrapping, iOS-native motion.

**Architecture:** A new generic `TabPager` component renders its children side-by-side in a horizontally translating track. On small screens `MRListPage` renders three `MRList` instances (one per status tab) inside it; React Query dedupes their identical list queries. Swipe commits go through the existing `setActiveTab` → URL-replace path. The row snooze gesture keeps ownership of leftward drags that start on a swipe-enabled row, advertised via a new `data-swipe-row` attribute.

**Tech Stack:** React 19, TypeScript, Vite, Playwright e2e (`bunx playwright test`), Bun.

**Spec:** `docs/superpowers/specs/2026-07-30-mr-list-swipe-tab-pager-design.md`

## Global Constraints

- Package manager is **bun**: typecheck with `bunx tsc --noEmit`, e2e with `bunx playwright test <file>`.
- Non-wrapping pager: swiping outward at either end rubber-bands with damping `0.3`.
- Commit rule: drag > `40%` of pane width, or a flick (velocity > `0.3` px/ms, ≥ `24px` dragged, same direction).
- Motion: `transition: transform 300ms cubic-bezier(0.2, 0, 0, 1)`; **never** `transition: all`; no transition while dragging; `prefers-reduced-motion` gets no transition. No haptics.
- Intent threshold `8px`, horizontal-dominance test; vertical gestures are never hijacked (`touch-action: pan-y`).
- Touch gating uses `useSmallScreen()` (viewport < 768px), the same gate as the mobile search button.
- Inactive panes must be `inert` and `aria-hidden`.
- Desktop (`!isSmallScreen`) rendering must be byte-for-byte the current behavior (single `MRList`).
- Match the repo's comment style: comments explain *why*, not *what*.
- The pre-commit hook runs eslint + the full Playwright suite and regenerates screenshot PNGs — commits are slow; that is normal. Check `git status` before committing and stage only your files (unrelated work is often already dirty).

---

### Task 1: `SwipeActionRow` advertises enabled swipe rows

The pager must know, at touchstart, whether the touch landed on a row whose
swipe-left gesture is live. Expose that as a `data-swipe-row` attribute on the
translating row element (the one that carries `.mr-list-item`).

**Files:**
- Create: `e2e/mr-list-tab-swipe.spec.ts` (first two tests only)
- Modify: `src/components/SwipeActionRow/SwipeActionRow.tsx:93-97`

**Interfaces:**
- Consumes: existing `SwipeActionRow` `disabled` prop (true on approved rows via `MRListItem`'s `swipeDisabled`).
- Produces: `[data-swipe-row]` (empty-string value) present on the row element exactly when the swipe gesture is enabled. Task 2's pager and Task 4's tests rely on this selector.

- [ ] **Step 1: Write the failing tests**

Create `e2e/mr-list-tab-swipe.spec.ts`:

```ts
import { test, expect } from './fixtures/test-base';
import type { Locator } from '@playwright/test';
import { mockTauriIPC } from './fixtures/tauri-mock';
import { mergeRequests } from './fixtures/seed-data';

/**
 * Touch MR list: horizontal swipes on the list surface page between the
 * status tabs (non-wrapping), while swipe-left on a snoozable row still
 * belongs to the snooze gesture. Desktop renders no pager at all.
 */

const ROW = '.mr-list-item';
/** The pane the pager currently shows (inactive panes are inert). */
const ACTIVE_PANE = '.tab-pager-pane:not([inert])';

/**
 * Dispatch a synthetic horizontal touch-drag on `el`, then release.
 * Positive deltaX drags rightward (previous tab), negative leftward (next).
 * All events land in one JS task, so React state is only observable after
 * the evaluate round-trip (see e2e-touch-gesture-testing notes).
 */
async function touchSwipeX(el: Locator, deltaX: number) {
  await el.evaluate((node, delta) => {
    const startX = delta < 0 ? 320 : 40;
    const y = node.getBoundingClientRect().top + 20;
    const touch = (x: number) =>
      new Touch({ identifier: 1, target: node, clientX: x, clientY: y });
    const opts = { bubbles: true, cancelable: true };
    node.dispatchEvent(new TouchEvent('touchstart', { ...opts, touches: [touch(startX)] }));
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      node.dispatchEvent(
        new TouchEvent('touchmove', { ...opts, touches: [touch(startX + (delta * i) / steps)] }),
      );
    }
    node.dispatchEvent(new TouchEvent('touchend', { ...opts, touches: [] }));
  }, deltaX);
}

test.describe('Touch MR list tab swipe', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test('snoozable rows advertise the swipe surface', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toHaveAttribute('data-swipe-row', '');
  });

  test('approved rows do not advertise the swipe surface', async ({ page }) => {
    const withApproved = mergeRequests.map((mr) =>
      mr.id === 101 ? { ...mr, userHasApproved: true } : mr,
    );
    await mockTauriIPC(page, { mergeRequests: withApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();
    await expect(row).not.toHaveAttribute('data-swipe-row');
  });
});
```

(`touchSwipeX` and `ACTIVE_PANE` are unused until Task 3 — that is fine; the
pre-commit hook lints `src/` only.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx playwright test e2e/mr-list-tab-swipe.spec.ts`
Expected: FAIL — `toHaveAttribute('data-swipe-row', '')` times out (attribute absent).

- [ ] **Step 3: Add the attribute in `SwipeActionRow`**

In `src/components/SwipeActionRow/SwipeActionRow.tsx`, the translating row
element currently starts:

```tsx
      <div
        {...rowProps}
        ref={containerRef}
        className={rowClasses.join(' ')}
```

Change it to:

```tsx
      <div
        {...rowProps}
        ref={containerRef}
        // Advertises a live swipe-left gesture to ancestor gesture owners
        // (TabPager yields leftward drags that start inside one of these).
        data-swipe-row={disabled ? undefined : ''}
        className={rowClasses.join(' ')}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx playwright test e2e/mr-list-tab-swipe.spec.ts`
Expected: PASS (2 tests).

Also run the neighbouring suite to prove no regression:
`bunx playwright test e2e/mr-list-mobile-snooze.spec.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/mr-list-tab-swipe.spec.ts src/components/SwipeActionRow/SwipeActionRow.tsx
git commit -m "feat(swipe-row): advertise enabled swipe rows via data-swipe-row"
```

---

### Task 2: `TabPager` component

A generic finger-tracking horizontal pager. No page wiring yet — the gate for
this task is a clean typecheck; behavior is e2e-tested through the MR list in
Tasks 3–4.

**Files:**
- Create: `src/components/TabPager/TabPager.tsx`
- Create: `src/components/TabPager/TabPager.css`
- Create: `src/components/TabPager/index.ts`

**Interfaces:**
- Consumes: `[data-swipe-row]` from Task 1.
- Produces: `TabPager` component, imported as `import { TabPager } from '../components/TabPager'`, with props `{ activeIndex: number; onCommit: (index: number) => void; disabled?: boolean; children: ReactNode }`. DOM: `.tab-pager` viewport > `.tab-pager-track` (grid) > one `.tab-pager-pane` per child; inactive panes carry `inert` + `aria-hidden`. Tasks 3–4 rely on these class names and the `inert` marker.

- [ ] **Step 1: Write `src/components/TabPager/TabPager.tsx`**

```tsx
/**
 * Horizontal finger-tracking pager for tabbed views (touch).
 *
 * Renders its children side by side; `activeIndex` picks the visible pane and
 * horizontal swipes commit to a neighbour via `onCommit` — controlled, so the
 * parent can keep the active tab in the URL. Non-wrapping: dragging outward
 * at either end rubber-bands. Vertical scrolling is never hijacked, and
 * leftward drags that start on a swipe-enabled row (`[data-swipe-row]`) are
 * left to the row's own gesture.
 */

import { Children, useCallback, useRef, useState, type ReactNode } from 'react';
import './TabPager.css';

/** Movement (px) before the gesture commits to horizontal vs vertical. */
const INTENT_THRESHOLD = 8;
/** Fraction of the pane width a drag must cross to commit on release. */
const COMMIT_FRACTION = 0.4;
/** Release speed (px/ms) that commits regardless of distance (a flick). */
const FLICK_VELOCITY = 0.3;
/** Minimum finger travel (px) before a flick may commit — filters jitter. */
const FLICK_MIN_DRAG = 24;
/** Damping applied when dragging outward at either end (non-wrapping). */
const RUBBER_BAND = 0.3;

interface TabPagerProps {
  /** Which pane is showing — controlled by the parent (URL-derived). */
  activeIndex: number;
  /** Called when a swipe commits to a neighbouring pane. */
  onCommit: (index: number) => void;
  /** Disables the gesture (e.g. while filtering). Panes still render. */
  disabled?: boolean;
  /** The panes, in tab order. */
  children: ReactNode;
}

export default function TabPager({
  activeIndex,
  onCommit,
  disabled = false,
  children,
}: TabPagerProps) {
  const panes = Children.toArray(children);
  const count = panes.length;

  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Mirrors for the native handlers, which must read the latest values
  // without re-subscribing (same pattern as useSwipeAction).
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const countRef = useRef(count);
  countRef.current = count;

  const trackRef = useRef<HTMLDivElement | null>(null);

  // Mutable gesture state — outside React state so the touch handlers can
  // read/write it synchronously (same pattern as usePullToRefresh).
  const gesture = useRef({
    startX: 0,
    startY: 0,
    tracking: false, // finger down, intent not yet decided
    armed: false, // gesture claimed the touch (horizontal intent)
    rowOwnsLeft: false, // touch started on a swipe-enabled row
    seed: 0, // offset inherited from a grabbed mid-settle track
    fingerDx: 0, // actual finger travel, excluding the seed
    offset: 0, // rendered track offset (seed + travel, damped at ends)
    lastX: 0,
    lastT: 0,
    velocity: 0, // px/ms, sign matches drag direction
  });

  const viewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || disabled) return;
      const s = gesture.current;

      function reset() {
        s.tracking = false;
        s.armed = false;
        s.rowOwnsLeft = false;
        s.seed = 0;
        s.fingerDx = 0;
        s.offset = 0;
        s.velocity = 0;
      }

      function handleTouchStart(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        reset();
        s.startX = e.touches[0].clientX;
        s.startY = e.touches[0].clientY;
        s.lastX = s.startX;
        s.lastT = e.timeStamp;
        s.tracking = true;
        s.rowOwnsLeft =
          e.target instanceof Element && e.target.closest('[data-swipe-row]') != null;

        // Grab a settling track mid-flight: seed the drag from where the
        // track visually is and skip the intent phase — horizontal motion is
        // already established and the finger should freeze it.
        const track = trackRef.current;
        const width = node.clientWidth;
        if (track && width > 0) {
          const t = getComputedStyle(track).transform;
          if (t !== 'none') {
            const offset =
              new DOMMatrixReadOnly(t).m41 + activeIndexRef.current * width;
            if (Math.abs(offset) > 1) {
              s.armed = true;
              s.seed = offset;
              s.offset = offset;
              setDragging(true);
              setDragOffset(offset);
            }
          }
        }
      }

      function handleTouchMove(e: TouchEvent) {
        if (!s.tracking) return;
        const x = e.touches[0].clientX;
        const dx = x - s.startX;
        const dy = e.touches[0].clientY - s.startY;

        if (!s.armed) {
          if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > INTENT_THRESHOLD) {
            // Vertical — scrolling and pull-to-refresh own it, for good.
            s.tracking = false;
            return;
          }
          if (Math.abs(dx) <= INTENT_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) {
            return; // intent not decided yet
          }
          if (dx < 0 && s.rowOwnsLeft) {
            // Leftward on a swipe-enabled row — the snooze gesture wins.
            s.tracking = false;
            return;
          }
          s.armed = true;
          setDragging(true);
        }

        const dt = e.timeStamp - s.lastT;
        // Synthetic test events share a timestamp; a dt of 0 must not
        // produce an Infinity flick.
        if (dt > 0) s.velocity = (x - s.lastX) / dt;
        s.lastX = x;
        s.lastT = e.timeStamp;
        s.fingerDx = dx;

        const width = node.clientWidth || 1;
        const index = activeIndexRef.current;
        const raw = s.seed + dx;
        const outward =
          (index === 0 && raw > 0) || (index === countRef.current - 1 && raw < 0);
        s.offset = outward ? raw * RUBBER_BAND : raw;
        setDragOffset(s.offset);
        if (e.cancelable) e.preventDefault();
      }

      function release(fire: boolean) {
        if (s.armed) {
          const width = node.clientWidth || 1;
          const index = activeIndexRef.current;
          let next = index;
          if (fire) {
            // Nearest pane to where the track visually sits — this is what
            // makes a tap-to-stop mid-settle land somewhere sensible…
            next = Math.round(index - s.offset / width);
            // …while a deliberate drag or flick always reaches the
            // neighbour the finger was heading for, even short of halfway.
            const dragged = Math.abs(s.fingerDx) > width * COMMIT_FRACTION;
            const flicked =
              Math.abs(s.fingerDx) > FLICK_MIN_DRAG &&
              Math.abs(s.velocity) > FLICK_VELOCITY &&
              Math.sign(s.velocity) === Math.sign(s.fingerDx);
            if ((dragged || flicked) && next === index) {
              next += s.fingerDx < 0 ? 1 : -1;
            }
            // One pane per gesture, and never past the ends (non-wrapping).
            next = Math.max(index - 1, Math.min(index + 1, next));
            next = Math.max(0, Math.min(countRef.current - 1, next));
          }
          setDragging(false);
          setDragOffset(0);
          // The router update and the offset reset batch into one render, so
          // the track transitions straight from the finger position to the
          // committed pane without a snap-back frame.
          if (next !== index) onCommitRef.current(next);
        }
        reset();
      }

      const handleTouchEnd = () => release(true);
      const handleTouchCancel = () => release(false);

      node.addEventListener('touchstart', handleTouchStart, { passive: true });
      node.addEventListener('touchmove', handleTouchMove, { passive: false });
      node.addEventListener('touchend', handleTouchEnd);
      node.addEventListener('touchcancel', handleTouchCancel);

      // React 19 ref-cleanup: runs when the node detaches or `disabled`
      // flips, so a mid-gesture disable can never leave the track dragged.
      return () => {
        node.removeEventListener('touchstart', handleTouchStart);
        node.removeEventListener('touchmove', handleTouchMove);
        node.removeEventListener('touchend', handleTouchEnd);
        node.removeEventListener('touchcancel', handleTouchCancel);
        reset();
        setDragging(false);
        setDragOffset(0);
      };
    },
    [disabled],
  );

  return (
    <div ref={viewportRef} className="tab-pager">
      <div
        ref={trackRef}
        className={`tab-pager-track${dragging ? ' is-dragging' : ''}`}
        style={{
          transform: `translateX(calc(${activeIndex * -100}% + ${dragOffset}px))`,
        }}
      >
        {panes.map((pane, i) => (
          <div
            // Order is fixed (one pane per status tab), so index keys are safe.
            key={i}
            className="tab-pager-pane"
            inert={i !== activeIndex}
            aria-hidden={i !== activeIndex}
          >
            {pane}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/TabPager/TabPager.css`**

```css
/* Tab pager — finger-tracking horizontal pager for tabbed views (touch). */

/* Viewport: clips the horizontal track. Sized by the flex column it sits in
   (.mr-list-page-content), same as the single list it replaces. */
.tab-pager {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}

/* One implicit 100%-wide column per pane. The track box itself keeps the
   viewport's width (the columns overflow it), so translateX percentages step
   exactly one pane per 100%. */
.tab-pager-track {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 100%;
  height: 100%;
  /* The browser keeps vertical scrolling; horizontal moves are ours to
     preventDefault once the gesture arms. */
  touch-action: pan-y;
  transition: transform 300ms cubic-bezier(0.2, 0, 0, 1);
}

/* Finger tracking must be transition-free per frame; this also lets a new
   touch freeze a settling track (interruptible animation). */
.tab-pager-track.is-dragging {
  transition: none;
}

.tab-pager-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

@media (prefers-reduced-motion: reduce) {
  .tab-pager-track {
    transition: none;
  }
}
```

- [ ] **Step 3: Write `src/components/TabPager/index.ts`**

```ts
export { default as TabPager } from './TabPager';
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean. (If `inert` is rejected: this project is React 19, where
`inert` is a typed boolean prop — check the error is not something else
before touching it.)

- [ ] **Step 5: Commit**

```bash
git add src/components/TabPager/
git commit -m "feat(tab-pager): finger-tracking horizontal pager component"
```

---

### Task 3: Wire the pager into `MRListPage`

On small screens, render three `MRList` panes inside `TabPager`. Only the
active pane gets the page-level singletons (search slot, refresh
registration, count reporting) — `registerManualRefreshHandler` is
last-write-wins, so three registrations would leave Mod+R pointing at an
arbitrary pane. Per-tab refresh reporting replaces the single `syncing`
boolean so a pane finishing a sync after the user swiped away can still
clear the header spinner.

**Files:**
- Modify: `src/pages/MRListPage.tsx`
- Test: `e2e/mr-list-tab-swipe.spec.ts` (extend)

**Interfaces:**
- Consumes: `TabPager` from Task 2 (`activeIndex`, `onCommit`, `disabled`, children in `STATUS_TABS` order); existing `setActiveTab`, `STATUS_TABS`, `MRList` props.
- Produces: on viewports < 768px, DOM contains `.tab-pager` with three `.tab-pager-pane` children, active one not `[inert]`; swiping commits via `setActiveTab` (URL `?tab=`). Task 4's tests rely on this.

- [ ] **Step 1: Write the failing tests**

Append inside the `Touch MR list tab swipe` describe block in
`e2e/mr-list-tab-swipe.spec.ts`:

```ts
  test('renders the three status panes in a pager', async ({ page }) => {
    await expect(page.locator('.tab-pager')).toBeVisible();
    await expect(page.locator('.tab-pager-pane')).toHaveCount(3);
    // Exactly one pane is interactive; the others are inert for focus/VO.
    await expect(page.locator('.tab-pager-pane:not([inert])')).toHaveCount(1);
  });

  test('swipe left pages to the Approved tab and updates the URL', async ({ page }) => {
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -220); // > 40% of the 390px viewport

    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
    await expect(page).toHaveURL(/tab=approved/);
  });

  test('swipe right pages back from Approved to Needs review', async ({ page }) => {
    await page.goto('/mrs?tab=approved');
    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);

    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, 220);

    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
  });

  test('a short swipe springs back without changing tabs', async ({ page }) => {
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -60); // below the 156px commit distance

    // Settle window first — an immediate check passes even on a wrong commit.
    await page.waitForTimeout(400);
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await expect(page).not.toHaveURL(/tab=/);
  });
```

And a desktop describe at file bottom (no `test.use` — default viewport,
no touch):

```ts
test.describe('Desktop MR list has no pager', () => {
  test('renders a single list without pager wrappers', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-item').first()).toBeVisible();

    await expect(page.locator('.tab-pager')).toHaveCount(0);
    await expect(page.locator('.mr-list')).toHaveCount(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx playwright test e2e/mr-list-tab-swipe.spec.ts`
Expected: the 4 new touch tests FAIL (`.tab-pager` never appears); the desktop
test and Task 1's two tests PASS.

- [ ] **Step 3: Rework `MRListPage.tsx`**

3a. Add the import next to the other component imports:

```tsx
import { TabPager } from '../components/TabPager';
```

3b. Replace the single `syncing` state (line ~85,
`const [syncing, setSyncing] = useState(false);`) with per-tab reporting:

```tsx
  // Refresh state is tracked per tab: a pane can finish its sync after the
  // user swiped to another tab, and must still be able to clear the header
  // spinner it turned on.
  const [syncingTabs, setSyncingTabs] = useState<Partial<Record<MrTab, boolean>>>({});
  const syncing = STATUS_TABS.some((tab) => syncingTabs[tab.id]);

  const handleRefreshingChange = useCallback((tab: MrTab, refreshing: boolean) => {
    setSyncingTabs((prev) =>
      !!prev[tab] === refreshing ? prev : { ...prev, [tab]: refreshing },
    );
  }, []);
```

3c. In the desktop `<MRList>` JSX, replace
`onRefreshingChange={setSyncing}` with:

```tsx
            onRefreshingChange={(r) => handleRefreshingChange(activeTab, r)}
```

3d. Add a pane renderer above the `return` (after `handleSelectMR`). Only the
active pane gets the page-level singletons:

```tsx
  // One MRList per status tab, side by side in the pager (small screens).
  // Only the active pane gets the page-level wiring: the manual-refresh
  // registration is a last-write-wins singleton, and the search bar / count
  // reporting must not have three writers.
  const renderPane = (tab: MrTab, instanceId: number) => {
    const active = tab === activeTab;
    return (
      <MRList
        key={tab}
        ref={active ? mrListRef : undefined}
        instanceId={instanceId}
        activeTab={tab}
        onSelect={handleSelectMR}
        onSelectTab={setActiveTab}
        condensed={condensed}
        snoozeMenuMrId={snoozeMenuMrId}
        onSnoozeMenuChange={setSnoozeMenuMrId}
        onRefreshingChange={(r) => handleRefreshingChange(tab, r)}
        {...(active
          ? {
              focusIndex,
              onFocusChange: setFocusIndex,
              onMRsLoaded: handleMRsLoaded,
              filterQuery: query,
              onFilteredCountChange: handleFilteredCountChange,
              onCountsChange: setTabCounts,
              onRefresh: () => manualSyncAndWait(true),
              searchSlot: (
                <SearchBar
                  query={query}
                  onQueryChange={setQuery}
                  onClose={closeMobileSearch}
                  filteredCount={filteredCounts.filtered}
                  totalCount={filteredCounts.total}
                  autoFocus={false}
                  inputRef={mobileSearchInputRef}
                />
              ),
            }
          : {})}
      />
    );
  };
```

3e. Replace the `{selectedInstanceId != null ? (<MRList …/>) : null}` block in
the JSX with a small-screen fork. The desktop branch is the **existing**
`<MRList>` element unchanged except for two edits: `onRefreshingChange` from
3c, and `filterQuery={isSearchOpen ? query : undefined}` (the `isSmallScreen`
arm of that ternary is now dead in this branch):

```tsx
        {selectedInstanceId != null ? (
          isSmallScreen ? (
            <TabPager
              activeIndex={STATUS_TABS.findIndex((tab) => tab.id === activeTab)}
              onCommit={(index) => setActiveTab(STATUS_TABS[index].id)}
              disabled={filtering}
            >
              {STATUS_TABS.map((tab) => renderPane(tab.id, selectedInstanceId))}
            </TabPager>
          ) : (
            <MRList
              ref={mrListRef}
              instanceId={selectedInstanceId}
              onSelect={handleSelectMR}
              focusIndex={focusIndex}
              onFocusChange={setFocusIndex}
              onMRsLoaded={handleMRsLoaded}
              filterQuery={isSearchOpen ? query : undefined}
              onFilteredCountChange={handleFilteredCountChange}
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              onCountsChange={setTabCounts}
              snoozeMenuMrId={snoozeMenuMrId}
              onSnoozeMenuChange={setSnoozeMenuMrId}
              condensed={condensed}
              onRefresh={() => manualSyncAndWait(true)}
              onRefreshingChange={(r) => handleRefreshingChange(activeTab, r)}
            />
          )
        ) : null}
```

(The desktop branch keeps no `searchSlot` — it was only ever passed on small
screens.)

- [ ] **Step 4: Typecheck, then run the tests**

Run: `bunx tsc --noEmit` — Expected: clean.
Run: `bunx playwright test e2e/mr-list-tab-swipe.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the adjacent mobile suites for regressions**

Run: `bunx playwright test e2e/mr-list-mobile-snooze.spec.ts e2e/mr-list-mobile-search.spec.ts e2e/mr-list-back-restore.spec.ts e2e/mr-list.spec.ts`
Expected: PASS. These cover the row snooze gesture, the collapsed search slot,
the POP-restore of `?tab=`, and the desktop list — the surfaces this rewiring
could plausibly break. Investigate any failure before proceeding (the panes
now nest inside `.tab-pager-pane`; selectors in those specs use classes, not
structure, so they should hold).

- [ ] **Step 6: Commit**

```bash
git add src/pages/MRListPage.tsx e2e/mr-list-tab-swipe.spec.ts
git commit -m "feat(mr-list): swipe between status tabs on touch"
```

---

### Task 4: Arbitration and edge-behavior coverage

The remaining spec behaviors: non-wrapping rubber-band at both ends, row
snooze keeping leftward drags, rightward drags on rows belonging to the
pager, and filtering disabling the gesture. These are tests of Task 2/3 code —
expected to pass; a failure means a bug to fix now, not a test to soften.

**Files:**
- Test: `e2e/mr-list-tab-swipe.spec.ts` (extend)
- Possibly fix: `src/components/TabPager/TabPager.tsx`

**Interfaces:**
- Consumes: `touchSwipeX`, `ACTIVE_PANE`, `[data-swipe-row]`, `.snooze-menu` (existing snooze sheet class), `.header-search-button`, `.search-bar-input`.
- Produces: nothing new — coverage only.

- [ ] **Step 1: Add the tests**

Append inside the `Touch MR list tab swipe` describe block:

```ts
  test('swipe right at the first tab rubber-bands and stays', async ({ page }) => {
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, 220);

    await page.waitForTimeout(400);
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('swipe left at the last tab rubber-bands and stays', async ({ page }) => {
    await page.goto('/mrs?tab=snoozed');
    await expect(page.locator('.mr-tab--active')).toHaveText(/Snoozed/);

    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -220);

    await page.waitForTimeout(400);
    await expect(page.locator('.mr-tab--active')).toHaveText(/Snoozed/);
  });

  test('swipe left on a snoozable row opens the snooze sheet, not the next tab', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    // Well past the pager's 156px commit distance — proves the pager yielded
    // to the row rather than merely missing its threshold.
    await touchSwipeX(row, -220);

    await expect(page.locator('.snooze-menu')).toBeVisible();
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('swipe right on a swipe-enabled row still pages (rows own left only)', async ({ page }) => {
    // Park an MR in Snoozed: its rows keep the swipe gesture (unsnooze).
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipeX(row, -140);
    await page.locator('.snooze-menu-option', { hasText: '1 hour' }).click();
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(snoozedRow).toBeVisible();
    await expect(snoozedRow).toHaveAttribute('data-swipe-row', '');
    await touchSwipeX(snoozedRow, 220);

    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
    // The rightward drag must not have unsnoozed the row on the way out.
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toBeVisible();
  });

  test('filtering disables the pager', async ({ page }) => {
    await page.locator('button[aria-label="Search merge requests"]').click();
    await page.locator('.search-bar-input').fill('dark');
    await expect(page.locator('.mr-tabs--filtering')).toBeVisible();

    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -220);

    await page.waitForTimeout(400);
    await expect(page).not.toHaveURL(/tab=/);
  });
```

- [ ] **Step 2: Run the tests**

Run: `bunx playwright test e2e/mr-list-tab-swipe.spec.ts`
Expected: PASS (12 tests). If an arbitration test fails, debug the pager
(`rowOwnsLeft`, the `disabled` ref-cleanup) — do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add e2e/mr-list-tab-swipe.spec.ts
git commit -m "test(mr-list): tab-swipe arbitration and edge coverage"
```

---

### Task 5: Full verification

**Files:** none (verification only; fixes go where the bug is).

- [ ] **Step 1: Full e2e suite and typecheck**

Run: `bunx tsc --noEmit && bunx playwright test`
Expected: PASS. Screenshot specs may regenerate PNGs — that is the pre-commit
hook's normal behavior; only investigate if a comparison *fails*.

- [ ] **Step 2: Manual verification on the iOS simulator**

Launch the app in the simulator (`bun run tauri ios dev`; see the
`ios-simulator-mcp-quirks` memory for driving it). Walk the checklist from the
spec:

1. Drag the list horizontally — the track follows the finger 1:1.
2. Release past ~40% — commits with an ease-out settle; short drag springs back.
3. Quick flick below 40% — commits.
4. Touch the track mid-settle — it freezes under the finger (interruptible).
5. Swipe right on Needs review and left on Snoozed — rubber-band, no wrap.
6. Swipe left on a row — snooze sheet, no page change; swipe right on a row — pages.
7. Vertical scrolling and pull-to-refresh — unaffected.
8. Search, then swipe — nothing moves (filtering disables the pager).
9. iOS edge-swipe-back at the left screen edge — still navigates back. If the
   pager fights it, file the ~20px left-edge dead zone follow-up from the
   spec's "Known risk" section (do not implement it speculatively).
10. Tab **tap** — the track slides to the tapped tab.

- [ ] **Step 3: Report**

Report the checklist results to the user, including anything from item 9 that
needs the dead-zone follow-up.
