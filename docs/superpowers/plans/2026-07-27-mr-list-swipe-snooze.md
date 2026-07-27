# MR List Swipe-to-Snooze + Condensed Touch Padding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align condensed MR rows' side padding with the touch layout, and make swipe-left snooze/unsnooze MR rows via a shared `SwipeActionRow` component (extracted from the issue list's swipe implementation), hiding the snooze button on touch.

**Architecture:** Pure frontend. A new `SwipeActionRow` component encapsulates the swipe wrapper + action layer + opaque-row states + click guard around the existing `useSwipeAction` hook; `IssueListItem` migrates to it (behavior unchanged) and `MRListItem` adopts it. Swipe on an unsnoozed row opens the existing `SnoozeMenu` (a `position: fixed` bottom sheet at ≤640px width, so it opens only after the row's transform-bearing settle animation finishes, via a new `onSettled` callback); swipe on a snoozed row unsnoozes directly. CSS handles the condensed padding and button hiding under `@media (hover: none)`.

**Tech Stack:** React 19, TypeScript, Playwright e2e (Tauri IPC mocked in `e2e/fixtures/`), Bun.

**Spec:** `docs/superpowers/specs/2026-07-27-mr-list-swipe-snooze-design.md`

## Global Constraints

- Gate touch behavior on touch capability (`@media (hover: none)` in CSS, touch events in JS) — never `isIOS`.
- Condensed touch padding: `8px 16px`; condensed touch divider insets: `16px`. (Regular rows keep `10px 16px` from the previous feature.)
- Never use opacity on list rows to signal state.
- Swipe thresholds are the hook's existing constants (72px trigger / 96px cap / 0.3 damping / 8px intent) — do not change `useSwipeAction`'s constants or its public contract `{ containerRef, offset, dragging, settling, pastThreshold }`.
- Existing spec `e2e/issue-list-mobile.spec.ts` must stay green after the refactor (one deliberate expectation change in Task 2: condensed touch padding `8px 24px` → `8px 16px`).
- Package manager `bun`; typecheck `bunx tsc --noEmit`; e2e `bunx playwright test`.
- Commit on the current branch (`master`), never push; stage with `git add <specific files>` only — the working tree carries unrelated uncommitted changes that must not be staged or reverted.

---

### Task 1: Extract `SwipeActionRow` and migrate the issue list to it

**Files:**
- Create: `src/components/SwipeActionRow/SwipeActionRow.tsx`
- Create: `src/components/SwipeActionRow/SwipeActionRow.css`
- Modify: `src/components/IssueList/IssueListItem.tsx` (swipe JSX → `SwipeActionRow`)
- Modify: `src/components/IssueList/IssueListItem.css` (remove `.issue-swipe*` + swipe-state rules; retarget `:last-child` rules; drop `touch-action` from the row)
- Test: existing `e2e/issue-list-mobile.spec.ts` (no edits — it must pass unchanged; that is the refactor's regression net)

**Interfaces:**
- Consumes: `useSwipeAction` from `src/hooks/useSwipeAction.ts` — `useSwipeAction<T extends HTMLElement>({ onTrigger: () => void; disabled?: boolean })` → `{ containerRef: (node: T | null) => void | (() => void); offset: number; dragging: boolean; settling: boolean; pastThreshold: boolean }`.
- Produces (Task 3 relies on this exactly): default export `SwipeActionRow`, a `forwardRef<HTMLDivElement>` component with props
  `{ icon: ReactNode; armedIcon?: ReactNode; onTrigger: () => void; onSettled?: () => void; disabled?: boolean; rowClassName: string; rowProps?: HTMLAttributes<HTMLDivElement>; children: ReactNode }`.
  DOM: `div.swipe-row` (gets the forwarded ref) > [`div.swipe-row-action(.is-armed)` while swiping] + `div.swipe-row-item.{rowClassName}(.is-swiping|.is-settling)` (gets `rowProps`, the translation transform, and the click guard). `onSettled` fires exactly once after a *triggered* swipe's snap-back finishes (transform gone).
  Shared CSS class contract: `.swipe-row`, `.swipe-row-action`, `.swipe-row-action.is-armed`, `.swipe-row-item` (carries `touch-action: pan-y`), `.is-swiping`, `.is-settling`.

- [ ] **Step 1: Create the component**

Create `src/components/SwipeActionRow/SwipeActionRow.tsx`:

```tsx
/**
 * Swipe-left action row (iOS-Mail style), shared by list rows.
 *
 * Renders a clipping wrapper with an action layer behind a translating row.
 * The row follows the finger via useSwipeAction; releasing past the
 * threshold fires `onTrigger` and the row snaps back. A tap that ended a
 * swipe is suppressed before it reaches `rowProps.onClick`.
 */

import { forwardRef, useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useSwipeAction } from '../../hooks/useSwipeAction';
import './SwipeActionRow.css';

interface SwipeActionRowProps {
  /** Action-layer content while dragging below the threshold. */
  icon: ReactNode;
  /** Action-layer content once past the threshold (defaults to `icon`). */
  armedIcon?: ReactNode;
  /** Fired when a swipe releases past the threshold. */
  onTrigger: () => void;
  /**
   * Fired once a triggered swipe's snap-back animation has finished. The row
   * is transform-free from here, so fixed-position UI (bottom sheets) can
   * open without the transform hijacking its containing block.
   */
  onSettled?: () => void;
  /** Disables the gesture; the row renders and behaves normally. */
  disabled?: boolean;
  /** Classes for the translating row element (e.g. "mr-list-item selected"). */
  rowClassName: string;
  /** Spread onto the row element (onClick, role, tabIndex, onKeyDown…). */
  rowProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}

const SwipeActionRow = forwardRef<HTMLDivElement, SwipeActionRowProps>(function SwipeActionRow(
  { icon, armedIcon, onTrigger, onSettled, disabled, rowClassName, rowProps, children },
  ref,
) {
  const triggeredRef = useRef(false);
  const { containerRef, offset, dragging, settling, pastThreshold } =
    useSwipeAction<HTMLDivElement>({
      onTrigger: () => {
        triggeredRef.current = true;
        onTrigger();
      },
      disabled,
    });

  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (!settling && triggeredRef.current) {
      triggeredRef.current = false;
      onSettledRef.current?.();
    }
  }, [settling]);

  const rowClasses = [rowClassName, 'swipe-row-item'];
  if (dragging) rowClasses.push('is-swiping');
  if (settling) rowClasses.push('is-settling');

  return (
    <div ref={ref} className="swipe-row">
      {(dragging || settling) && (
        <div className={`swipe-row-action${pastThreshold ? ' is-armed' : ''}`} aria-hidden>
          {pastThreshold ? (armedIcon ?? icon) : icon}
        </div>
      )}
      <div
        {...rowProps}
        ref={containerRef}
        className={rowClasses.join(' ')}
        style={offset > 0 ? { transform: `translateX(${-offset}px)` } : undefined}
        onClick={(e) => {
          // A tap that ended a swipe must not activate the row; `settling`
          // is still true in the click's timing window after touchend.
          if (dragging || settling) return;
          rowProps?.onClick?.(e);
        }}
      >
        {children}
      </div>
    </div>
  );
});

export default SwipeActionRow;
```

- [ ] **Step 2: Create the shared CSS**

Create `src/components/SwipeActionRow/SwipeActionRow.css`:

```css
/* Swipe-left action row: wrapper clips the translating row; the action layer
   behind it is revealed by the drag. Consumers keep their own row styling —
   these rules only add the gesture chrome. */

.swipe-row {
  position: relative;
  overflow: hidden;
}

/* Horizontal gestures belong to the row; vertical stays native scroll. */
.swipe-row-item {
  touch-action: pan-y;
}

.swipe-row-action {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 24px;
  color: var(--text-muted);
  background: var(--overlay-hover);
}

.swipe-row-action.is-armed {
  color: var(--warning-color, #e6c07b);
  background: var(--warning-light);
}

/* Rows are transparent at rest; while a swipe is live they must be opaque so
   the action layer only shows in the gap the drag reveals. The descendant
   selector out-specifies consumer rules like `.mr-list-item.selected`
   regardless of stylesheet import order. */
.swipe-row .swipe-row-item.is-swiping,
.swipe-row .swipe-row-item.is-settling {
  background: var(--bg-primary);
}

.swipe-row .swipe-row-item.is-swiping {
  transition: none;
}

.swipe-row .swipe-row-item.is-settling {
  transition: transform 0.2s ease, background 0.2s ease;
}
```

(`0.2s` = 200ms; the hook's `SETTLE_MS = 220` intentionally outlasts it.)

- [ ] **Step 3: Migrate IssueListItem to SwipeActionRow**

In `src/components/IssueList/IssueListItem.tsx`:

Replace the import of the hook with the component:

```tsx
import SwipeActionRow from '../SwipeActionRow/SwipeActionRow';
```

(remove `import { useSwipeAction } from '../../hooks/useSwipeAction';`)

Remove the `useSwipeAction` call and the `is-swiping`/`is-settling` classNames pushes from the component body — `classNames` goes back to only `issue-list-item`, `selected`, `state-closed`.

Replace the returned JSX's outer structure (the `div.issue-swipe` wrapper, the `.issue-swipe-action` layer, and the row `div`'s ref/style/onClick/role/tabIndex/onKeyDown) with:

```tsx
  return (
    <SwipeActionRow
      ref={ref}
      icon={<StarIcon filled={issue.starred} size={20} />}
      armedIcon={<StarIcon filled={!issue.starred} size={20} />}
      onTrigger={() => onToggleStar?.()}
      disabled={!onToggleStar}
      rowClassName={classNames.join(' ')}
      rowProps={{
        onClick,
        role: 'button',
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClick?.();
          }
        },
      }}
    >
      {/* …existing children unchanged: star button + issue-item-body… */}
    </SwipeActionRow>
  );
```

The children (the `.issue-star-button` button and `.issue-item-body` div) move inside unchanged. Note the click guard now lives in `SwipeActionRow` — do not duplicate it here.

- [ ] **Step 4: Clean up IssueListItem.css**

In `src/components/IssueList/IssueListItem.css`:

1. Retarget the two `:last-child` rules (lines ~18 and ~39): `.issue-swipe:last-child .issue-list-item` → `.swipe-row:last-child .issue-list-item`, and `.issue-swipe:last-child .issue-list-item::after` → `.swipe-row:last-child .issue-list-item::after`.
2. Delete the now-shared rules: `.issue-swipe`, `.issue-swipe-action`, `.issue-swipe-action.is-armed`, `.issue-list-item.is-swiping, .issue-list-item.is-settling { background: … }`, `.issue-list-item.is-swiping { transition: none; }`, `.issue-list-item.is-settling { transition: …; }` (the block around lines 66–116, including its comments).
3. Remove `touch-action: pan-y;` from the base `.issue-list-item` rule (now on `.swipe-row-item`).

- [ ] **Step 5: Typecheck and run the issue-list spec unchanged**

Run: `bunx tsc --noEmit && bunx playwright test e2e/issue-list-mobile.spec.ts`
Expected: typecheck clean; all 10 tests PASS with zero spec edits. If a test fails, the refactor changed behavior — fix the component, not the test.

- [ ] **Step 6: Commit**

```bash
git add src/components/SwipeActionRow/SwipeActionRow.tsx src/components/SwipeActionRow/SwipeActionRow.css src/components/IssueList/IssueListItem.tsx src/components/IssueList/IssueListItem.css
git commit -m "refactor(swipe): extract shared SwipeActionRow from issue list"
```

---

### Task 2: Condensed touch padding + hide the snooze button on touch (CSS)

**Files:**
- Create: `e2e/mr-list-mobile-snooze.spec.ts` (layout tests; Task 3 extends it)
- Modify: `src/components/MRList/MRListItem.css` (the `@media (hover: none)` block, ~line 538)
- Modify: `e2e/issue-list-mobile.spec.ts` (ONE deliberate expectation change: condensed touch padding `8px 24px` → `8px 16px`)

**Interfaces:**
- Consumes: the `@media (hover: none)` block in MRListItem.css containing the `:not(.mr-list-item--condensed)` rules and the `.mr-snooze-button` touch rule; `mockTauriIPC(page, { settings: { mrListCondensed: true } })` re-registration pattern (see the condensed test in `e2e/issue-list-mobile.spec.ts`).
- Produces: `e2e/mr-list-mobile-snooze.spec.ts` with a mobile describe block `'Touch MR list snooze'` (viewport 390×664, `hasTouch: true`) that Task 3 extends. Touch CSS: condensed rows `8px 16px` / insets 16px; `.mr-snooze-button { display: none }`.

- [ ] **Step 1: Write the failing layout tests**

Create `e2e/mr-list-mobile-snooze.spec.ts`:

```ts
import { test, expect } from './fixtures/test-base';
import { mockTauriIPC } from './fixtures/tauri-mock';

/**
 * Touch-device MR list: condensed rows share the 16px side edges, the snooze
 * clock button is gone (swipe-left snoozes instead), and swipe drives the
 * snooze sheet. Desktop keeps the hover-revealed button.
 */

const ROW = '.mr-list-item';

test.describe('Touch MR list snooze', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test('condensed rows align to the 16px touch side padding', async ({ page }) => {
    // Re-register the mock with condensed mode on; the later init script wins.
    await mockTauriIPC(page, { settings: { mrListCondensed: true } });
    await page.goto('/mrs');

    const row = page.locator(ROW).first();
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/mr-list-item--condensed/);

    const padding = await row.evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('8px 16px');
  });

  test('snooze button is hidden on touch', async ({ page }) => {
    await expect(page.locator('.mr-snooze-button').first()).toBeHidden();
  });
});

test.describe('Desktop MR list keeps the snooze button', () => {
  test('button exists and is not display:none', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();

    const button = page.locator('.mr-snooze-button').first();
    await expect(button).toBeAttached();
    // Hidden-until-hover uses opacity on desktop, never display.
    expect(await button.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
  });
});
```

- [ ] **Step 2: Run the new spec to verify it fails**

Run: `bunx playwright test e2e/mr-list-mobile-snooze.spec.ts`
Expected: FAIL — condensed padding is `8px 24px`; the snooze button is visible (44px) on touch. The desktop test PASSES already.

- [ ] **Step 3: Apply the CSS changes**

In `src/components/MRList/MRListItem.css`, inside the existing `@media (hover: none)` block (~line 538): keep the two `:not(.mr-list-item--condensed)` rules, ADD condensed rules after them, and REPLACE the `.mr-snooze-button` enlargement rule:

```css
@media (hover: none) {
  .mr-list-item:not(.mr-list-item--condensed) {
    padding: 10px 16px;
  }

  .mr-list-item:not(.mr-list-item--condensed)::after {
    left: 16px;
    right: 16px;
  }

  /* Condensed keeps its tighter vertical rhythm but shares the 16px edges. */
  .mr-list-item--condensed {
    padding: 8px 16px;
  }

  .mr-list-item--condensed::after {
    left: 16px;
    right: 16px;
  }

  /* Swipe-left is the snooze affordance on touch; the button column goes. */
  .mr-snooze-button {
    display: none;
  }
}
```

(The old `.mr-snooze-button { opacity: 1; width: 44px; height: 44px; }` rule is deleted — the comment above the block about enlarging the tap target should be updated to match.)

- [ ] **Step 4: Update the stale expectation in the issue-list spec**

In `e2e/issue-list-mobile.spec.ts`, the test `'condensed MR rows keep their density on touch (padding not overridden)'` pins `8px 24px`. Rename it to `'condensed MR rows keep their vertical density on touch'` and change the assertion:

```ts
    const padding = await row.evaluate((el) => getComputedStyle(el).padding);
    expect(padding).toBe('8px 16px');
```

- [ ] **Step 5: Run both specs to verify green**

Run: `bunx playwright test e2e/mr-list-mobile-snooze.spec.ts e2e/issue-list-mobile.spec.ts`
Expected: PASS (3 + 10 tests).

- [ ] **Step 6: Commit**

```bash
git add e2e/mr-list-mobile-snooze.spec.ts e2e/issue-list-mobile.spec.ts src/components/MRList/MRListItem.css
git commit -m "feat(mr-list): align condensed touch padding, hide snooze button on touch"
```

---

### Task 3: Swipe-to-snooze on MR rows

**Files:**
- Modify: `src/components/MRList/MRListItem.tsx` (adopt `SwipeActionRow`; inline snoozed clock in the condensed row)
- Modify: `src/components/MRList/MRListItem.css` (`:last-child` rework; `.mr-snooze-inline` rules)
- Modify: `e2e/fixtures/tauri-mock.ts` (`mergeRequests` override support; `snooze_mr`/`unsnooze_mr` handlers)
- Test: `e2e/mr-list-mobile-snooze.spec.ts` (swipe behavior tests)

**Interfaces:**
- Consumes: `SwipeActionRow` from Task 1 (exact props/DOM per Task 1's Produces block); `onSnoozeMenuOpenChange(open: boolean)`, `onSnooze(until: number)`, `onUnsnooze()` props already on `MRListItemProps`; `canSnooze` (`!mr.userHasApproved || snoozed`); the frontend services `snoozeMR` → `invoke('snooze_mr', { mrId, until })` and `unsnoozeMR` → `invoke('unsnooze_mr', { mrId })` (verify the `unsnooze_mr` args name in `src/services/tauri.ts:~399` before writing the mock); seed MRs 101 ('feat: Add dark mode toggle to settings'), 102–104, all `userHasApproved: false`; status tabs labeled `Needs review` / `Approved` / `Snoozed` (`.mr-tab` buttons); `SnoozeMenu` markup `.snooze-menu` > `.snooze-menu-option` buttons labeled from `snoozePresets` ('1 hour', '4 hours', 'tomorrow'…).
- Produces: swipe on unsnoozed snoozable rows opens the preset sheet after settle; swipe on snoozed rows unsnoozes; `.mr-snooze-inline` (touch-only, condensed) indicator; mock `mockTauriIPC(page, { mergeRequests })` override.

- [ ] **Step 1: Add mock support — MR overrides + snooze handlers**

In `e2e/fixtures/tauri-mock.ts`:

Extend the overrides parameter (~line 26):

```ts
export async function mockTauriIPC(
  page: Page,
  overrides?: {
    settings?: Partial<typeof seed.settings>;
    mergeRequests?: typeof seed.mergeRequests;
  },
) {
```

and in the `seedJSON` object: `mergeRequests: overrides?.mergeRequests ?? seed.mergeRequests,`

Add handlers next to `get_merge_requests` (~line 101), matching neighboring handlers' style (mutate seed in place; the list refetch picks it up):

```ts
      snooze_mr: (args) => {
        const mr = [...data.mergeRequests, ...data.myMergeRequests].find(
          (m: { id: number }) => m.id === args.mrId,
        );
        if (mr) mr.snoozedUntil = args.until as number;
        return {
          mrId: args.mrId,
          snoozedAt: Math.floor(Date.now() / 1000),
          snoozeUntil: args.until,
        };
      },
      unsnooze_mr: (args) => {
        const mr = [...data.mergeRequests, ...data.myMergeRequests].find(
          (m: { id: number }) => m.id === args.mrId,
        );
        if (mr) mr.snoozedUntil = null;
        return null;
      },
```

(Adjust the arg names only if `src/services/tauri.ts` sends something other than `{ mrId, until }` / `{ mrId }` — check first.)

- [ ] **Step 2: Write the failing swipe tests**

Add to `e2e/mr-list-mobile-snooze.spec.ts`. Imports gain `type { Locator }` and the seed:

```ts
import type { Locator } from '@playwright/test';
import { mergeRequests } from './fixtures/seed-data';
```

Below the imports, the same synthetic-drag helper the issue spec uses:

```ts
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

Add inside the `'Touch MR list snooze'` describe block:

```ts
  test('swipe left opens the snooze sheet; a preset snoozes the MR', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipe(row, -140);

    // The sheet opens only after the row finishes settling (~220ms).
    const menu = page.locator('.snooze-menu');
    await expect(menu).toBeVisible();

    await menu.locator('.snooze-menu-option', { hasText: '1 hour' }).click();

    // Snoozed rows leave Needs review and appear under the Snoozed tab.
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toHaveCount(0);
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toBeVisible();
    await expect(page.locator('.mr-snoozed-badge')).toBeVisible();
  });

  test('short swipe does not open the sheet', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipe(row, -40);

    // The sheet legitimately opens only after the ~220ms settle, so an
    // immediate absence check would pass even if the swipe wrongly armed.
    // Wait out the settle window before asserting.
    await page.waitForTimeout(400);
    await expect(page.locator('.snooze-menu')).toHaveCount(0);
  });

  test('swiping a snoozed row unsnoozes it', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipe(row, -140);
    await page.locator('.snooze-menu-option', { hasText: '1 hour' }).click();
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(snoozedRow).toBeVisible();
    await touchSwipe(snoozedRow, -140);

    // No menu for unsnooze — the row returns to Needs review directly.
    // (Menu absence is checked after the settle window; see 'short swipe'.)
    await page.waitForTimeout(400);
    await expect(page.locator('.snooze-menu')).toHaveCount(0);
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toHaveCount(0);
    await page.locator('.mr-tab', { hasText: 'Needs review' }).click();
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toBeVisible();
  });

  test('approved MRs do not respond to swipe', async ({ page }) => {
    const withApproved = mergeRequests.map((mr) =>
      mr.id === 101 ? { ...mr, userHasApproved: true } : mr,
    );
    await mockTauriIPC(page, { mergeRequests: withApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();

    await touchSwipe(row, -140);
    await page.waitForTimeout(400);
    await expect(page.locator('.snooze-menu')).toHaveCount(0);
  });

  test('condensed snoozed row shows the inline clock on touch', async ({ page }) => {
    await mockTauriIPC(page, { settings: { mrListCondensed: true } });
    await page.goto('/mrs');

    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();
    await touchSwipe(row, -140);
    await page.locator('.snooze-menu-option', { hasText: '1 hour' }).click();

    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();
    await expect(page.locator('.mr-snooze-inline')).toBeVisible();
  });
```

- [ ] **Step 3: Run the spec to verify the new tests fail**

Run: `bunx playwright test e2e/mr-list-mobile-snooze.spec.ts`
Expected: the five new tests FAIL (no gesture on MR rows — the sheet never opens). Task 2's tests still PASS.

- [ ] **Step 4: Adopt SwipeActionRow in MRListItem**

In `src/components/MRList/MRListItem.tsx`:

Imports: add `useRef` to the react import; add:

```tsx
import SwipeActionRow from '../SwipeActionRow/SwipeActionRow';
```

In the component body, after `const canSnooze = …` (keep that where it is), add:

```tsx
    // Swipe-left mirrors the snooze control: unsnoozed rows get the preset
    // sheet, snoozed rows unsnooze directly. The sheet is a fixed-position
    // bottom sheet on narrow screens, so it opens via onSettled — after the
    // row's transform is gone and can't hijack the sheet's containing block.
    const menuPendingRef = useRef(false);
    const swipeDisabled = !canSnooze || !onSnoozeMenuOpenChange || !onSnooze;
```

Replace the returned outer `<div ref={ref} className={classNames.join(' ')} onClick={onClick} role="button" tabIndex={0} onKeyDown={…}>` … `</div>` with:

```tsx
    return (
      <SwipeActionRow
        ref={ref}
        icon={<Clock size={20} weight="bold" />}
        onTrigger={() => {
          if (snoozed) {
            onUnsnooze?.();
          } else {
            menuPendingRef.current = true;
          }
        }}
        onSettled={() => {
          if (menuPendingRef.current) {
            menuPendingRef.current = false;
            onSnoozeMenuOpenChange?.(true);
          }
        }}
        disabled={swipeDisabled}
        rowClassName={classNames.join(' ')}
        rowProps={{
          onClick,
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onClick?.();
            }
          },
        }}
      >
      {/* …existing children unchanged: the condensed/full conditional… */}
      </SwipeActionRow>
    );
```

In the condensed layout's top row, add the inline snoozed clock immediately before `<span className="mr-condensed-time">`:

```tsx
            {snoozed && (
              <span className="mr-snooze-inline" role="img" aria-label="Snoozed">
                <Clock size={11} weight="bold" />
              </span>
            )}
```

- [ ] **Step 5: MRListItem.css — `:last-child` rework + inline clock**

In `src/components/MRList/MRListItem.css`:

1. Replace the two `:last-child` rules (lines ~33–37) — the row is now always the only child of its `.swipe-row` wrapper, so `.mr-list-item:last-child` would match every row and delete all dividers:

```css
.swipe-row:last-child .mr-list-item {
  border-bottom: none;
}
.swipe-row:last-child .mr-list-item::after {
  display: none;
}
```

2. Add after the `.mr-snoozed-badge` rule:

```css
/* Inline snoozed indicator — the touch-device stand-in for the clock button
   in the condensed row (the full layout shows the snoozed badge instead). */
.mr-snooze-inline {
  display: none;
  align-items: center;
  color: var(--warning-color);
  flex-shrink: 0;
}
```

3. Inside the `@media (hover: none)` block, add:

```css
  .mr-snooze-inline {
    display: inline-flex;
  }
```

- [ ] **Step 6: Typecheck and run the spec**

Run: `bunx tsc --noEmit && bunx playwright test e2e/mr-list-mobile-snooze.spec.ts`
Expected: typecheck clean; all 8 tests PASS.

- [ ] **Step 7: Regression run on adjacent specs**

Run: `bunx playwright test e2e/issue-list-mobile.spec.ts e2e/mr-list.spec.ts e2e/mr-list-mobile-search.spec.ts e2e/my-mrs.spec.ts e2e/navigation.spec.ts e2e/page-header-heights.spec.ts`
Expected: PASS — the wrapper div and swipe wiring must not disturb selection, keyboard nav (`itemRefs` scroll-into-view still targets the outermost element via the forwarded ref), pull-to-refresh, search, or the My MRs page.

- [ ] **Step 8: Commit**

```bash
git add src/components/MRList/MRListItem.tsx src/components/MRList/MRListItem.css e2e/fixtures/tauri-mock.ts e2e/mr-list-mobile-snooze.spec.ts
git commit -m "feat(mr-list): swipe left to snooze on touch devices"
```

---

### Task 4: Full verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything above.
- Produces: a verified, committed feature.

- [ ] **Step 1: Typecheck + lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: both clean for the feature's files. Pre-existing lint issues in other files are reported, not fixed.

- [ ] **Step 2: Full e2e suite**

Run: `bunx playwright test`
Expected: PASS. The screenshot generator rewrites `e2e/screenshots/*.png` (already dirty from other in-flight work) — leave them uncommitted and unstaged.

- [ ] **Step 3: Manual gesture check in the iOS simulator (human)**

Human-owned: verify on the MRs page — swipe an unsnoozed row left opens the preset bottom sheet after the row settles (no sheet mis-positioning), picking a preset moves the row to Snoozed, swiping a snoozed row returns it, approved rows don't swipe, condensed rows share the 16px edges, and the condensed snoozed row shows the small clock. Report findings rather than assuming success.

**Plan complete.**
