# Issue List Mobile Layout + Swipe-to-Favorite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On touch devices, remove the issue list's leading star-button column, tighten row padding on both the issue and MR lists, and make swipe-left star/unstar an issue.

**Architecture:** Pure frontend change. CSS media queries (`@media (hover: none)`, the codebase's existing touch-device convention from MRListItem's snooze button) handle layout differences. A new generic `useSwipeAction` hook (mirroring `usePullToRefresh`'s raw-touch-listener + ref-callback-cleanup pattern) drives the gesture; `IssueListItem` gains a wrapper with an action layer behind the translating row. No Rust/backend changes.

**Tech Stack:** React 19, TypeScript, Playwright e2e (mock Tauri IPC fixtures in `e2e/fixtures/`), Bun.

**Spec:** `docs/superpowers/specs/2026-07-27-issue-list-mobile-swipe-design.md`

## Global Constraints

- Gate mobile behavior on touch capability (`@media (hover: none)` in CSS; touch events in JS) — never on `isIOS`.
- Swipe trigger threshold: 72px; visual drag cap: 96px; overdrag damping: 0.3; intent threshold: 8px.
- Desktop padding (both lists): `12px 32px`. Touch padding (both lists): `10px 16px`; divider `::after` insets follow the side padding (32px → 16px).
- Never use opacity on list rows to signal state (existing project rule).
- Package manager is `bun`; typecheck with `bunx tsc --noEmit`; e2e with `bunx playwright test`.
- All commits on the current branch (`master` is this project's working branch — commits stay local, no push).

---

### Task 1: Trimmed padding + hidden star column (CSS) with layout e2e spec

**Files:**
- Create: `e2e/issue-list-mobile.spec.ts`
- Modify: `src/components/IssueList/IssueListItem.css` (padding at ~line 7; append touch block)
- Modify: `src/components/MRList/MRListItem.css` (padding at line 6; extend `@media (hover: none)` block at ~line 538)

**Interfaces:**
- Consumes: existing classes `.issue-list-item`, `.issue-star-button`, `.mr-list-item`, `.mr-snooze-button`; e2e fixture `./fixtures/test-base`.
- Produces: the spec file `e2e/issue-list-mobile.spec.ts` with a mobile describe block (`viewport 390×664, hasTouch: true`) that Tasks 2 and 3 extend. Touch-device CSS blocks in both list stylesheets that Tasks 2 and 3 add rules to.

Background for the test design: e2e fixtures mock all Tauri IPC (`e2e/fixtures/test-base.ts` auto-installs `mockTauriIPC`), so `page.goto('/issues')` renders the seeded issue list. `hasTouch: true` makes Chromium's touch emulation flip the `(hover: none)` media query — the first test asserts that explicitly so a wrong assumption fails loudly rather than silently passing the desktop layout.

- [ ] **Step 1: Write the failing layout tests**

Create `e2e/issue-list-mobile.spec.ts`:

```ts
import { test, expect } from './fixtures/test-base';

/**
 * Touch-device issue list: the leading star-button column is gone (swipe-left
 * stars a row instead), rows are tighter, and starred state shows inline.
 * Desktop keeps the tappable star column.
 */

const ROW = '.issue-list-item';

test.describe('Touch issue list layout', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/issues');
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test('star column is hidden and rows are tighter', async ({ page }) => {
    // Guard: touch emulation must flip the hover MQ, or none of the layout
    // under test is active and every assertion below would be meaningless.
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);

    await expect(page.locator('.issue-star-button').first()).toBeHidden();

    const padding = await page
      .locator(ROW)
      .first()
      .evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('10px 16px');
  });

  test('MR list rows share the tightened touch padding', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-item').first()).toBeVisible();

    const padding = await page
      .locator('.mr-list-item')
      .first()
      .evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('10px 16px');
  });
});

test.describe('Desktop issue list keeps the star column', () => {
  test('star button visible, padding only slightly trimmed', async ({ page }) => {
    await page.goto('/issues');
    await expect(page.locator(ROW).first()).toBeVisible();

    await expect(page.locator('.issue-star-button').first()).toBeVisible();

    const padding = await page
      .locator(ROW)
      .first()
      .evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('12px 32px');
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `bunx playwright test e2e/issue-list-mobile.spec.ts`
Expected: FAIL — mobile padding is `14px 32px` (not `10px 16px`), star button is visible on the touch viewport. If instead the *guard* assertion fails (`matchMedia('(hover: none)')` is `false`), STOP: the `hasTouch` assumption is wrong. In that case drive the media query directly via CDP in `beforeEach` — `const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });` — and re-verify before proceeding.

- [ ] **Step 3: Apply the CSS changes**

In `src/components/IssueList/IssueListItem.css`, change the `.issue-list-item` padding (currently `padding: 14px 32px;`):

```css
  padding: 12px 32px;
```

Append at the end of the file:

```css
/* Touch devices: the leading star column disappears (swipe-left stars the
   row instead) and the row tightens up. */
@media (hover: none) {
  .issue-list-item {
    padding: 10px 16px;
  }

  .issue-list-item::after {
    left: 16px;
    right: 16px;
  }

  .issue-star-button {
    display: none;
  }
}
```

In `src/components/MRList/MRListItem.css`, change the `.mr-list-item` padding (line 6, currently `padding: 14px 32px;`):

```css
  padding: 12px 32px;
```

Extend the existing `@media (hover: none)` block (~line 538) — keep the `.mr-snooze-button` rule and add before it:

```css
@media (hover: none) {
  .mr-list-item {
    padding: 10px 16px;
  }

  .mr-list-item::after {
    left: 16px;
    right: 16px;
  }

  .mr-snooze-button {
    opacity: 1;
    width: 44px;
    height: 44px;
  }
}
```

Do NOT touch `.mr-list-item--condensed` (it has its own `8px 24px` padding — condensed mode is a separate user setting).

- [ ] **Step 4: Run the spec to verify it passes**

Run: `bunx playwright test e2e/issue-list-mobile.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Check for regressions in adjacent specs**

Run: `bunx playwright test e2e/mr-list-mobile-search.spec.ts e2e/page-header-heights.spec.ts e2e/mr-list.spec.ts`
Expected: PASS. (These touch the same lists/pages; padding is not asserted anywhere else, but verify.)

- [ ] **Step 6: Commit**

```bash
git add e2e/issue-list-mobile.spec.ts src/components/IssueList/IssueListItem.css src/components/MRList/MRListItem.css
git commit -m "feat(lists): tighten row padding, hide issue star column on touch"
```

---

### Task 2: Inline starred indicator on touch devices

**Files:**
- Modify: `e2e/fixtures/seed-data.ts` (add a starred seed issue after the existing one in the `issues` array, ~line 796)
- Modify: `src/components/IssueList/IssueListItem.tsx` (header row, ~line 98)
- Modify: `src/components/IssueList/IssueListItem.css` (new rule + addition to the Task 1 touch block)
- Test: `e2e/issue-list-mobile.spec.ts` (extend both describe blocks)

**Interfaces:**
- Consumes: `StarIcon` from `../icons` — signature `{ filled: boolean; size?: number }` (already imported in IssueListItem.tsx); the `@media (hover: none)` block created in Task 1.
- Produces: `.issue-star-inline` element rendered whenever `issue.starred` is true (hidden on hover-capable devices via CSS). Seed issue id `9002` / iid `43`, title `'Dark mode flashes white on startup'`, `starred: true` — Task 3's unstar test targets it by that title.

- [ ] **Step 1: Add a starred issue to the e2e seed data**

In `e2e/fixtures/seed-data.ts`, append to the `issues` array (after the existing `id: 9001` entry, same shape):

```ts
  {
    id: 9002,
    instanceId: 1,
    iid: 43,
    projectId: 7,
    title: 'Dark mode flashes white on startup',
    description: 'The window paints white before the theme loads.',
    state: 'open',
    webUrl: 'https://gitlab.example.com/example/webapp/-/issues/43',
    authorUsername: 'bob',
    assigneeUsernames: '["testuser"]',
    labels: '[]',
    createdAt: now - 86400 * 5,
    updatedAt: now - 7200,
    closedAt: null,
    dueDate: null,
    confidential: false,
    userNotesCount: 0,
    starred: true,
    assignedToMe: true,
    cachedAt: now,
    projectName: 'WebApp',
    projectNameWithNamespace: 'Example / WebApp',
    projectPathWithNamespace: 'example/webapp',
    projectCustomName: null,
    projectStarred: false,
  },
```

(No existing spec asserts an issue-list row count — `issue-comment-mentions` and `issue-description-edit` navigate straight to the detail URL — so a second list row is safe.)

- [ ] **Step 2: Write the failing tests**

In `e2e/issue-list-mobile.spec.ts`, add to the mobile describe block:

```ts
  test('starred issue shows an inline star in the header', async ({ page }) => {
    const starredRow = page.locator(ROW).filter({ hasText: 'Dark mode flashes' });
    await expect(starredRow.locator('.issue-star-inline')).toBeVisible();

    const plainRow = page.locator(ROW).filter({ hasText: 'Login button misaligned' });
    await expect(plainRow.locator('.issue-star-inline')).toHaveCount(0);
  });
```

And to the desktop describe block:

```ts
  test('inline star stays hidden on hover-capable devices', async ({ page }) => {
    await page.goto('/issues');
    await expect(page.locator(ROW).first()).toBeVisible();

    const inline = page.locator('.issue-star-inline');
    await expect(inline).toBeAttached(); // rendered for the starred seed issue…
    await expect(inline).toBeHidden(); // …but display: none at desktop
  });
```

- [ ] **Step 3: Run the spec to verify the new tests fail**

Run: `bunx playwright test e2e/issue-list-mobile.spec.ts`
Expected: the two new tests FAIL (`.issue-star-inline` not attached); Task 1's tests still PASS.

- [ ] **Step 4: Render the inline star and style it**

In `src/components/IssueList/IssueListItem.tsx`, inside `<div className="issue-item-header">`, add as the FIRST child (before the `.issue-iid` span):

```tsx
          {issue.starred && (
            <span className="issue-star-inline" aria-label="Starred">
              <StarIcon filled size={12} />
            </span>
          )}
```

In `src/components/IssueList/IssueListItem.css`, add after the `.issue-star-button:active` rule:

```css
/* Inline starred indicator — the touch-device stand-in for the star button. */
.issue-star-inline {
  display: none;
  align-items: center;
  color: var(--warning-color, #e6c07b);
  flex-shrink: 0;
}
```

And inside the `@media (hover: none)` block from Task 1, add:

```css
  .issue-star-inline {
    display: inline-flex;
  }
```

- [ ] **Step 5: Typecheck and run the spec**

Run: `bunx tsc --noEmit && bunx playwright test e2e/issue-list-mobile.spec.ts`
Expected: typecheck clean; all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/seed-data.ts e2e/issue-list-mobile.spec.ts src/components/IssueList/IssueListItem.tsx src/components/IssueList/IssueListItem.css
git commit -m "feat(issues): inline starred indicator on touch devices"
```

---

### Task 3: Swipe-left-to-star gesture

**Files:**
- Create: `src/hooks/useSwipeAction.ts`
- Modify: `src/components/IssueList/IssueListItem.tsx` (wrap the row, wire the hook)
- Modify: `src/components/IssueList/IssueListItem.css` (wrapper/action-layer/swipe-state rules; rework `:last-child`)
- Modify: `e2e/fixtures/tauri-mock.ts` (add `toggle_issue_star` handler in the `-- Issues --` section, ~line 218)
- Test: `e2e/issue-list-mobile.spec.ts` (swipe tests)

**Interfaces:**
- Consumes: `onToggleStar` prop (already on `IssueListItemProps`; IssuesPage passes `() => handleStarIssue(issue.id)` which invokes `toggle_issue_star` then refetches the list); Task 2's `.issue-star-inline` (the observable outcome of a successful swipe); seed issues 9001 (`'Login button misaligned…'`, unstarred) and 9002 (`'Dark mode flashes…'`, starred).
- Produces: `useSwipeAction<T extends HTMLElement>({ onTrigger: () => void; disabled?: boolean })` returning `{ containerRef: (node: T | null) => void | (() => void); offset: number; dragging: boolean; settling: boolean; pastThreshold: boolean }`. Generic — future consumers (e.g. MR snooze swipe) use the same shape. New DOM structure: `.issue-swipe` wrapper > (`.issue-swipe-action` + `.issue-list-item`).

- [ ] **Step 1: Mock the star-toggle IPC command**

The frontend calls `invoke('toggle_issue_star', { instanceId, issueId })` (`src/services/tauri.ts:783`), which the e2e mock doesn't handle yet. In `e2e/fixtures/tauri-mock.ts`, add to the `// -- Issues --` section, right after `list_cached_issues`:

```ts
      toggle_issue_star: (args) => {
        const issue = data.issues.find((i: { id: number }) => i.id === args.issueId);
        if (issue) issue.starred = !issue.starred;
        return issue?.starred ?? false;
      },
```

(Match the surrounding handlers' style — they mutate `data.issues` in place; the page refetches via `list_cached_issues` after toggling.)

- [ ] **Step 2: Write the failing swipe tests**

In `e2e/issue-list-mobile.spec.ts`, add below the imports a horizontal-drag helper (same synthetic-TouchEvent technique as `e2e/mr-list-mobile-search.spec.ts`):

```ts
import type { Locator } from '@playwright/test';

/** Dispatch a synthetic leftward touch-drag on a row, then release. */
async function touchSwipe(row: Locator, deltaX: number) {
  await row.evaluate((el, delta) => {
    const touch = (x: number) =>
      new Touch({ identifier: 1, target: el, clientX: x, clientY: 200 });
    const opts = { bubbles: true, cancelable: true };
    el.dispatchEvent(new TouchEvent('touchstart', { ...opts, touches: [touch(300)] }));
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      el.dispatchEvent(
        new TouchEvent('touchmove', { ...opts, touches: [touch(300 + (delta * i) / steps)] }),
      );
    }
    el.dispatchEvent(new TouchEvent('touchend', { ...opts, touches: [] }));
  }, deltaX);
}
```

Add to the mobile describe block. Drag distances: 140px raw ≫ 72px threshold (damped visual ≈ 92px, still past); 40px raw < 72px threshold.

```ts
  test('swipe left past the threshold stars the issue', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Login button misaligned' });
    await expect(row.locator('.issue-star-inline')).toHaveCount(0);

    await touchSwipe(row, -140);
    await expect(row.locator('.issue-star-inline')).toBeVisible();
  });

  test('short swipe leaves the issue unstarred', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Login button misaligned' });
    await touchSwipe(row, -40);

    await expect(row.locator('.issue-star-inline')).toHaveCount(0);
  });

  test('swiping a starred issue unstars it', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Dark mode flashes' });
    await expect(row.locator('.issue-star-inline')).toBeVisible();

    await touchSwipe(row, -140);
    await expect(row.locator('.issue-star-inline')).toHaveCount(0);
  });

  test('swipe does not open the issue detail', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Login button misaligned' });
    await touchSwipe(row, -140);

    await expect(row.locator('.issue-star-inline')).toBeVisible();
    await expect(page).toHaveURL(/\/issues$/);
  });
```

- [ ] **Step 3: Run the spec to verify the new tests fail**

Run: `bunx playwright test e2e/issue-list-mobile.spec.ts`
Expected: the four swipe tests FAIL (no gesture handling — the inline star never appears / never disappears). Earlier tests still PASS.

- [ ] **Step 4: Create the `useSwipeAction` hook**

Create `src/hooks/useSwipeAction.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** Leftward drag distance (px) required before release triggers the action. */
const TRIGGER_THRESHOLD = 72;
/** Visual cap on how far the row can be dragged out. */
const MAX_DRAG = 96;
/** Damping applied past the trigger threshold, so overdrag rubber-bands. */
const OVERDRAG_RESISTANCE = 0.3;
/** Movement (px) before the gesture commits to horizontal vs vertical. */
const INTENT_THRESHOLD = 8;
/** Must match the snap-back transition duration in the consumer's CSS. */
const SETTLE_MS = 220;

interface UseSwipeActionOptions {
  /** Called when the user releases a drag past the threshold. */
  onTrigger: () => void;
  disabled?: boolean;
}

interface UseSwipeActionResult<T extends HTMLElement> {
  /** Attach to the element that should follow the finger (ref callback). */
  containerRef: (node: T | null) => void | (() => void);
  /** Current leftward drag distance in px (0 when idle). */
  offset: number;
  /** True while the finger is down and the gesture has claimed the touch. */
  dragging: boolean;
  /** True while the row animates back after release. */
  settling: boolean;
  /** True when releasing right now would fire `onTrigger`. */
  pastThreshold: boolean;
}

/**
 * Swipe-left action for a list row (iOS-Mail style). The row follows the
 * finger once horizontal intent is established; releasing past the threshold
 * fires `onTrigger` and the row snaps back. Vertical scrolling is never
 * hijacked — the gesture only claims the touch when horizontal movement
 * dominates.
 */
export function useSwipeAction<T extends HTMLElement>({
  onTrigger,
  disabled = false,
}: UseSwipeActionOptions): UseSwipeActionResult<T> {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);

  const onTriggerRef = useRef(onTrigger);
  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  // Mutable gesture state — outside React state so the touch handlers can
  // read/write it synchronously (same pattern as usePullToRefresh).
  const gesture = useRef({
    startX: 0,
    startY: 0,
    tracking: false, // finger down, intent not yet decided
    armed: false, // gesture claimed the touch (horizontal intent)
    distance: 0,
  });
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useCallback(
    (node: T | null) => {
      if (!node || disabled) return;
      const s = gesture.current;

      function release(fire: boolean) {
        if (s.armed) {
          if (fire && s.distance >= TRIGGER_THRESHOLD) onTriggerRef.current();
          setDragging(false);
          setSettling(true);
          setOffset(0);
          if (settleTimer.current) clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(() => setSettling(false), SETTLE_MS);
        }
        s.tracking = false;
        s.armed = false;
        s.distance = 0;
      }

      function handleTouchStart(e: TouchEvent) {
        if (e.touches.length !== 1) return;
        s.startX = e.touches[0].clientX;
        s.startY = e.touches[0].clientY;
        s.tracking = true;
        s.armed = false;
        s.distance = 0;
      }

      function handleTouchMove(e: TouchEvent) {
        if (!s.tracking) return;
        const dx = e.touches[0].clientX - s.startX;
        const dy = e.touches[0].clientY - s.startY;

        if (!s.armed) {
          if (Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) > INTENT_THRESHOLD) {
            // Vertical scroll — hand the touch back for good.
            s.tracking = false;
            return;
          }
          if (dx > INTENT_THRESHOLD) {
            // Rightward drag — not ours.
            s.tracking = false;
            return;
          }
          if (dx <= -INTENT_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            s.armed = true;
            setDragging(true);
          } else {
            return; // intent not decided yet
          }
        }

        const raw = Math.max(0, -dx);
        s.distance =
          raw <= TRIGGER_THRESHOLD
            ? raw
            : Math.min(
                TRIGGER_THRESHOLD + (raw - TRIGGER_THRESHOLD) * OVERDRAG_RESISTANCE,
                MAX_DRAG,
              );
        setOffset(s.distance);
        if (e.cancelable) e.preventDefault();
      }

      const handleTouchEnd = () => release(true);
      const handleTouchCancel = () => release(false);

      node.addEventListener('touchstart', handleTouchStart, { passive: true });
      node.addEventListener('touchmove', handleTouchMove, { passive: false });
      node.addEventListener('touchend', handleTouchEnd);
      node.addEventListener('touchcancel', handleTouchCancel);

      // React 19 ref-cleanup: called when the node detaches or this callback
      // identity changes, so add/remove always share one closure.
      return () => {
        node.removeEventListener('touchstart', handleTouchStart);
        node.removeEventListener('touchmove', handleTouchMove);
        node.removeEventListener('touchend', handleTouchEnd);
        node.removeEventListener('touchcancel', handleTouchCancel);
        if (settleTimer.current) clearTimeout(settleTimer.current);
      };
    },
    [disabled],
  );

  return {
    containerRef,
    offset,
    dragging,
    settling,
    pastThreshold: dragging && offset >= TRIGGER_THRESHOLD,
  };
}
```

- [ ] **Step 5: Wire the gesture into IssueListItem**

In `src/components/IssueList/IssueListItem.tsx`:

Add the import:

```tsx
import { useSwipeAction } from '../../hooks/useSwipeAction';
```

Inside the component body, before `classNames` is built, add the hook and extend the class list:

```tsx
  const { containerRef, offset, dragging, settling, pastThreshold } =
    useSwipeAction<HTMLDivElement>({
      onTrigger: () => onToggleStar?.(),
      disabled: !onToggleStar,
    });

  const classNames = ['issue-list-item'];
  if (selected) classNames.push('selected');
  if (issue.state === 'closed') classNames.push('state-closed');
  if (dragging) classNames.push('is-swiping');
  if (settling) classNames.push('is-settling');
```

Replace the outer JSX (the `<div ref={ref} className={classNames.join(' ')} …>` opening and its matching close) with a wrapper structure. The forwarded `ref` moves to the wrapper (IssuesPage only uses it for scroll-into-view, so the outermost element is the right target); the row itself gets `containerRef` and the translation:

```tsx
  return (
    <div ref={ref} className="issue-swipe">
      {(dragging || settling) && (
        <div
          className={`issue-swipe-action${pastThreshold ? ' is-armed' : ''}`}
          aria-hidden
        >
          <StarIcon filled={pastThreshold ? !issue.starred : issue.starred} size={20} />
        </div>
      )}
      <div
        ref={containerRef}
        className={classNames.join(' ')}
        style={offset > 0 ? { transform: `translateX(${-offset}px)` } : undefined}
        onClick={() => {
          // A tap that ended a swipe must not navigate; `settling` is still
          // true in the click's timing window right after touchend.
          if (dragging || settling) return;
          onClick?.();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClick?.();
          }
        }}
      >
        {/* …existing children unchanged: star button + issue-item-body… */}
      </div>
    </div>
  );
```

The action layer's star previews the post-release state: past the threshold it shows what releasing will produce (`!issue.starred`), below it the current state.

- [ ] **Step 6: Add the swipe CSS**

In `src/components/IssueList/IssueListItem.css`:

Replace the two `:last-child` rules — the row is now always the wrapper's only child, so `.issue-list-item:last-child` would match every row and delete all dividers:

```css
.issue-swipe:last-child .issue-list-item {
  border-bottom: none;
}
```

```css
.issue-swipe:last-child .issue-list-item::after {
  display: none;
}
```

Add after the `.issue-list-item.state-closed:hover` rule (order matters: the swipe background overrides `.selected`'s gradient, so these must come later in the file than the rules they beat — end-of-main-section is fine):

```css
/* Swipe-to-star (touch): wrapper clips the translating row; the action layer
   behind it is revealed by the drag. */
.issue-swipe {
  position: relative;
  overflow: hidden;
}

.issue-swipe-action {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 24px;
  color: var(--text-muted);
  background: var(--overlay-hover);
}

.issue-swipe-action.is-armed {
  color: var(--warning-color, #e6c07b);
  background: var(--warning-light);
}

/* The row is transparent at rest; while a swipe is live it must be opaque so
   the action layer only shows in the gap the drag reveals. */
.issue-list-item.is-swiping,
.issue-list-item.is-settling {
  background: var(--bg-primary);
}

.issue-list-item.is-swiping {
  transition: none;
}

.issue-list-item.is-settling {
  transition: transform 0.2s ease, background 0.2s ease;
}
```

(`0.2s` = 200ms; the hook's `SETTLE_MS = 220` intentionally outlasts it.)

- [ ] **Step 7: Typecheck and run the full spec**

Run: `bunx tsc --noEmit && bunx playwright test e2e/issue-list-mobile.spec.ts`
Expected: typecheck clean; all 9 tests PASS.

- [ ] **Step 8: Run adjacent specs for regressions**

Run: `bunx playwright test e2e/issue-comment-mentions.spec.ts e2e/issue-description-edit.spec.ts e2e/navigation.spec.ts e2e/page-header-heights.spec.ts`
Expected: PASS — the issue detail flow and page chrome are untouched; this catches accidental fallout from the wrapper div (e.g. keyboard scroll-into-view still works because `ref` stays on the outermost element).

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useSwipeAction.ts src/components/IssueList/IssueListItem.tsx src/components/IssueList/IssueListItem.css e2e/fixtures/tauri-mock.ts e2e/issue-list-mobile.spec.ts
git commit -m "feat(issues): swipe left to star on touch devices"
```

---

### Task 4: Full verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified, committed feature.

- [ ] **Step 1: Typecheck + lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: both clean. If lint flags anything in the new/changed files, fix and amend the relevant commit.

- [ ] **Step 2: Full e2e suite**

Run: `bunx playwright test`
Expected: PASS. Note: `e2e/screenshots.spec.ts` is a README-screenshot *generator* (no pixel assertions) — it will regenerate `e2e/screenshots/*.png` with the new padding; that's expected. Leave the regenerated PNGs uncommitted unless the working tree already had them modified (it does — they're pre-existing dirty files owned by other in-flight work; don't touch them).

- [ ] **Step 3: Manual gesture check in the iOS simulator (human)**

This needs a human/simulator: run the iOS build (`bun run ios:install` or `bun run tauri ios dev`) and verify on the Issues page: (a) rows are tighter with no leading star column, (b) swiping a row left reveals the star layer, arms (color change) past ~72px, and toggles on release, (c) vertical scrolling over rows is not hijacked, (d) starred rows show the small inline star. Report findings back rather than assuming success.

**Plan complete.**
