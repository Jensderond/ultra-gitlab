# Refresh Without Layout Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desktop refresh (Mod+R) causes zero layout shift: the spinner + "Refreshing" label appear absolutely centered in the page header and the sync bar overlays the header's bottom edge, while touch pull-to-refresh keeps its inline indicator.

**Architecture:** `triggerRefresh` stops setting `pullDistance`; the inline indicator becomes gesture-only (renders only when `pullDistance > 0`); `PageHeader` gains a `refreshing` prop that renders a centered overlay (desktop) and the relocated `SyncProgressBar` (all sizes), both absolutely positioned inside the already-relative header.

**Tech Stack:** React 19, TypeScript, Playwright e2e. Bun for everything (`bunx tsc --noEmit`, `bun run lint`, `bunx playwright test`).

**Spec:** `docs/superpowers/specs/2026-07-24-refresh-no-cls-design.md`

## Global Constraints

- Touch pull-to-refresh behavior must be pixel-identical (same thresholds, held distance, reset).
- No in-flow element may appear or grow anywhere on the page while a desktop refresh runs.
- Commit after each task.

---

### Task 1: Failing e2e test — no CLS, indicator in header

**Files:**
- Modify: `e2e/mr-list.spec.ts` (the `Mod+R shows the pull-to-refresh indicator` test)

- [ ] **Step 1: Rewrite the Mod+R test**

Replace:

```ts
  test('Mod+R shows the pull-to-refresh indicator', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-content')).toBeVisible();

    await page.keyboard.press('ControlOrMeta+r');

    // Programmatic refresh drives the same indicator the iOS pull gesture uses.
    const indicator = page.locator('.pull-refresh-indicator--active');
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('Refreshing');
  });
```

with:

```ts
  test('Mod+R shows the header refresh indicator without shifting the list', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-content')).toBeVisible();
    const firstItem = page.locator('.mr-list-item').first();
    await expect(firstItem).toBeVisible();
    const before = await firstItem.boundingBox();

    await page.keyboard.press('ControlOrMeta+r');

    // Refresh feedback lives in the page header, absolutely positioned…
    const indicator = page.locator('.page-header-refreshing');
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('Refreshing');
    await expect(page.locator('.page-header .sync-progress-bar')).toBeVisible();

    // …so the inline pull indicator stays unmounted and nothing shifts.
    await expect(page.locator('.pull-refresh-indicator')).toHaveCount(0);
    const after = await firstItem.boundingBox();
    expect(after!.y).toBe(before!.y);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx playwright test e2e/mr-list.spec.ts -g "header refresh indicator"`
Expected: FAIL — `.page-header-refreshing` does not exist yet.

- [ ] **Step 3: Commit**

```bash
git add e2e/mr-list.spec.ts
git commit -m "test(e2e): expect Mod+R refresh feedback in the header with zero layout shift"
```

---

### Task 2: Gesture-only inline indicator

**Files:**
- Modify: `src/hooks/usePullToRefresh.ts`
- Modify: `src/components/PullToRefresh/PullToRefreshIndicator.tsx`

**Interfaces:**
- Produces: `runRefresh(holdIndicator: boolean)` internal; `triggerRefresh` keeps its public signature. `PullToRefreshIndicator` mounts only when `pullDistance > 0`.

- [ ] **Step 1: Parameterize `runRefresh`**

In `src/hooks/usePullToRefresh.ts` change `runRefresh` to:

```ts
  // Shared by touch release and the programmatic desktop trigger, so the two
  // paths can't drift apart. `holdIndicator` keeps the inline indicator open
  // for gesture refreshes; the desktop trigger leaves pullDistance at 0 so
  // nothing shifts (the page header shows the feedback instead).
  const runRefresh = useCallback(async (holdIndicator: boolean) => {
    const s = gesture.current;
    if (s.refreshing) return;
    s.refreshing = true;
    setRefreshing(true);
    if (holdIndicator) setPullDistance(PULL_THRESHOLD * 0.8);
    try {
      await onRefreshRef.current();
    } finally {
      s.refreshing = false;
      s.distance = 0;
      setRefreshing(false);
      setPullDistance(0);
    }
  }, []);

  const triggerRefresh = useCallback(async () => {
    if (disabled) return;
    await runRefresh(false);
  }, [disabled, runRefresh]);
```

and in `handleTouchEnd` change `void runRefresh();` to `void runRefresh(true);`.

- [ ] **Step 2: Gate the inline indicator on pull distance**

In `src/components/PullToRefresh/PullToRefreshIndicator.tsx` change:

```ts
  if (pullDistance <= 0 && !refreshing) return null;
```

to:

```ts
  // Gesture-only: programmatic (desktop) refreshes keep pullDistance at 0 and
  // show their feedback in the page header instead, so nothing shifts.
  if (pullDistance <= 0) return null;
```

- [ ] **Step 3: Verify types and touch behavior**

Run: `bunx tsc --noEmit && bunx playwright test e2e/mr-list-mobile-search.spec.ts --reporter=line`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePullToRefresh.ts src/components/PullToRefresh/PullToRefreshIndicator.tsx
git commit -m "feat(pull-to-refresh): keep the inline indicator gesture-only"
```

---

### Task 3: PageHeader refresh feedback

**Files:**
- Modify: `src/components/PageHeader/PageHeader.tsx`
- Modify: `src/components/PageHeader/PageHeader.css`

**Interfaces:**
- Produces: `PageHeaderProps.refreshing?: boolean`. Class names `.page-header-refreshing` (centered overlay) and `.page-header-sync-bar` (bottom strip wrapping `SyncProgressBar`) — the Task 1 test asserts them.

- [ ] **Step 1: Component**

Replace `src/components/PageHeader/PageHeader.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { SyncProgressBar } from '../PullToRefresh';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  /** Shows the header refresh feedback (centered spinner on desktop, bottom
      progress bar everywhere) — absolutely positioned, never shifts layout. */
  refreshing?: boolean;
  actions?: ReactNode;
}

export function PageHeader({ title, refreshing = false, actions }: PageHeaderProps) {
  const isSmallScreen = useSmallScreen();

  return (
    <header className="page-header">
      <div className="page-header-title-group">
        <h1>{title}</h1>
      </div>
      {refreshing && !isSmallScreen && (
        <div className="page-header-refreshing" aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          <span>Refreshing</span>
        </div>
      )}
      {actions && <div className="page-header-actions">{actions}</div>}
      {refreshing && (
        <div className="page-header-sync-bar">
          <SyncProgressBar />
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: CSS**

Append to `src/components/PageHeader/PageHeader.css`:

```css
/* Refresh feedback — absolutely positioned so it never shifts layout. */
.page-header-refreshing {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent-color);
  pointer-events: none;
  animation: page-header-refreshing-fade 0.2s ease;
}

.page-header-refreshing svg {
  animation: page-header-refreshing-spin 0.7s linear infinite;
}

.page-header-refreshing span {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.04em;
  white-space: nowrap;
  color: var(--text-muted);
}

.page-header-sync-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

@keyframes page-header-refreshing-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes page-header-refreshing-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-header-refreshing svg {
    animation: none;
  }
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `bunx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/PageHeader/
git commit -m "feat(page-header): absolutely positioned refresh indicator and sync bar"
```

---

### Task 4: Pages pass `refreshing`; drop standalone SyncProgressBar

**Files:**
- Modify: `src/pages/MRListPage.tsx` (`{syncing && <SyncProgressBar />}` at ~line 250, PageHeader at ~line 216)
- Modify: `src/pages/MyMRsPage.tsx` (`{refreshing && <SyncProgressBar />}` at ~line 275, PageHeader at ~line 221)
- Modify: `src/pages/IssuesPage.tsx` (`{refreshing && <SyncProgressBar />}` at ~line 299, PageHeader at ~line 286)
- Modify: `src/pages/PipelinesPage/index.tsx` (`{refreshing && <SyncProgressBar />}` at ~line 91, PageHeader at ~line 71)

In each file: add `refreshing={…}` to `<PageHeader …>`, delete the standalone `{… && <SyncProgressBar />}` line, and remove `SyncProgressBar` from the `../components/PullToRefresh` import (keep `PullToRefreshIndicator` where it's still used).

- [ ] **Step 1: MRListPage** — `<PageHeader title="Merge Requests" refreshing={syncing} …>`; delete `{syncing && <SyncProgressBar />}`; the import line `import { SyncProgressBar } from '../components/PullToRefresh';` goes away entirely.
- [ ] **Step 2: MyMRsPage** — `<PageHeader title="My Merge Requests" refreshing={refreshing} …>`; delete `{refreshing && <SyncProgressBar />}`; import becomes `import { PullToRefreshIndicator } from '../components/PullToRefresh';`.
- [ ] **Step 3: IssuesPage** — `<PageHeader title="Issues" refreshing={refreshing} …>`; delete `{refreshing && <SyncProgressBar />}`; import becomes `import { PullToRefreshIndicator } from '../components/PullToRefresh';`.
- [ ] **Step 4: PipelinesPage** — `<PageHeader title="Pipelines" refreshing={refreshing} …>`; delete `{refreshing && <SyncProgressBar />}`; import becomes `import { PullToRefreshIndicator } from '../../components/PullToRefresh';`.

- [ ] **Step 5: Verify — the Task 1 test passes**

Run: `bunx tsc --noEmit && bunx playwright test e2e/mr-list.spec.ts -g "header refresh indicator"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/MRListPage.tsx src/pages/MyMRsPage.tsx src/pages/IssuesPage.tsx src/pages/PipelinesPage/index.tsx
git commit -m "feat(desktop): refresh feedback in the header — zero layout shift"
```

---

### Task 5: Full verification

- [ ] **Step 1:** `bun run lint` — expected: 0 errors (19 pre-existing warnings).
- [ ] **Step 2:** `bunx playwright test` — expected: all pass.
- [ ] **Step 3:** Manual (real app): Cmd+R on each page shows the centered header spinner + bottom bar, list never moves; touch pull on iOS still shows the inline indicator.
