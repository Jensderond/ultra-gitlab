# Desktop Refresh Animation (Cmd+R) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The iOS pull-to-refresh indicator animation plays on desktop when the user presses Mod+R (the existing customizable `trigger-sync` shortcut) or runs "Trigger sync" from the command palette; the header refresh button is removed.

**Architecture:** `usePullToRefresh` gains a programmatic `triggerRefresh()` that runs the same code path as a touch release. A module-level registry (`src/services/manualRefresh.ts`) lets the currently mounted pull-to-refresh surface register its `triggerRefresh`; the global Mod+R handler in `App.tsx` calls the registry, falling back to the old silent `manualSync(true)` on pages without an indicator.

**Tech Stack:** React 19, TypeScript, Vite, @tanstack/react-hotkeys, Playwright e2e (mocked Tauri IPC). Package manager is **bun**. There is no unit-test runner in this repo — Playwright e2e is the test layer.

**Spec:** `docs/superpowers/specs/2026-07-24-desktop-refresh-animation-design.md`

## Global Constraints

- Package manager: `bun` (never npm/yarn). Typecheck: `bunx tsc --noEmit`. Lint: `bun run lint`. E2e: `bunx playwright test <file>` (starts the Vite dev server itself).
- Do not change `PullToRefreshIndicator.tsx` or any CSS except deleting the `.page-header-refresh` rules.
- The touch pull-to-refresh behavior must remain byte-for-byte identical in feel (same thresholds, same resistance, same reset semantics).
- Commit after each task.

---

### Task 1: Failing e2e test — Mod+R shows the refresh indicator

**Files:**
- Modify: `e2e/mr-list.spec.ts` (replace the `shows refresh button` test, currently at lines 55–60)

**Interfaces:**
- Produces: e2e test `mr-list.spec.ts` › "Mod+R shows the pull-to-refresh indicator" that Task 4 will make pass.

Background for the assertions: the Playwright fixture (`e2e/fixtures/tauri-mock.ts`) mocks `trigger_sync` but never emits a `sync-progress` event, so `manualSyncAndWait` stays pending for its 120 s timeout — the indicator therefore stays visible, making the assertion easy. `page.keyboard.press('ControlOrMeta+r')` produces Meta+R on macOS and Ctrl+R on Linux CI, matching how `@tanstack/react-hotkeys` resolves `Mod+R` on each platform.

- [ ] **Step 1: Replace the old button test with the new indicator test**

In `e2e/mr-list.spec.ts`, delete this test:

```ts
  test('shows refresh button', async ({ page }) => {
    await page.goto('/mrs');

    const refreshButton = page.locator('button[aria-label="Refresh merge requests"]');
    await expect(refreshButton).toBeVisible();
  });
```

and add in its place:

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

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx playwright test e2e/mr-list.spec.ts -g "Mod\+R shows"`
Expected: FAIL — `.pull-refresh-indicator--active` never appears (Mod+R currently runs the silent `manualSync`, which never touches the indicator).

- [ ] **Step 3: Commit**

```bash
git add e2e/mr-list.spec.ts
git commit -m "test(e2e): expect Mod+R to show the pull-to-refresh indicator"
```

---

### Task 2: `triggerRefresh()` on `usePullToRefresh`

**Files:**
- Modify: `src/hooks/usePullToRefresh.ts`

**Interfaces:**
- Produces: `usePullToRefresh` now returns `{ containerRef, pullDistance, refreshing, triggerRefresh }` where `triggerRefresh: () => Promise<void>` resolves immediately when `disabled` or already refreshing, otherwise runs the full refresh sequence (indicator out → await `onRefresh` → reset). Tasks 3–4 depend on this exact name.

- [ ] **Step 1: Extract the shared refresh sequence and expose `triggerRefresh`**

In `src/hooks/usePullToRefresh.ts`:

1. Extend the result interface:

```ts
interface UsePullToRefreshResult<T extends HTMLElement> {
  /** Attach to the scrollable element the gesture should apply to (ref callback). */
  containerRef: (node: T | null) => void | (() => void);
  /** Current visual pull distance in px (0 when idle). */
  pullDistance: number;
  /** True while `onRefresh` is in flight. */
  refreshing: boolean;
  /**
   * Programmatically run the same refresh sequence a touch release triggers
   * (used by the desktop Mod+R shortcut). No-op while disabled or refreshing.
   */
  triggerRefresh: () => Promise<void>;
}
```

2. Below the `gesture` ref declaration, add the shared sequence (this is the exact body of today's release-past-threshold branch in `handleTouchEnd`):

```ts
  // Shared by touch release and the programmatic desktop trigger, so the two
  // paths can't drift apart.
  const runRefresh = useCallback(async () => {
    const s = gesture.current;
    if (s.refreshing) return;
    s.refreshing = true;
    setRefreshing(true);
    setPullDistance(PULL_THRESHOLD * 0.8);
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
    await runRefresh();
  }, [disabled, runRefresh]);
```

3. Rewrite `handleTouchEnd` (inside the `containerRef` callback) to delegate to `runRefresh`:

```ts
      function handleTouchEnd() {
        if (!s.pulling) {
          s.startY = null;
          return;
        }
        s.pulling = false;
        s.startY = null;
        if (s.distance >= PULL_THRESHOLD) {
          void runRefresh();
        } else {
          reset();
        }
      }
```

Note: `handleTouchEnd` is no longer `async` — update nothing else; the `addEventListener` calls are unchanged. Add `runRefresh` to the `containerRef` `useCallback` dependency array: `[disabled, runRefresh]`.

4. Return the new function:

```ts
  return { containerRef, pullDistance, refreshing, triggerRefresh };
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Verify touch behavior is unchanged via existing e2e**

Run: `bunx playwright test e2e/mr-list-mobile-search.spec.ts`
Expected: PASS (this suite exercises the touch pull gesture against the reveal behavior).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePullToRefresh.ts
git commit -m "feat(pull-to-refresh): expose programmatic triggerRefresh()"
```

---

### Task 3: Manual-refresh registry + `useManualRefreshHandler`, routed through App.tsx

**Files:**
- Create: `src/services/manualRefresh.ts`
- Create: `src/hooks/useManualRefreshHandler.ts`
- Modify: `src/App.tsx` (Mod+R hotkey at lines ~168–171, command palette `TriggerSync` at lines ~231–234)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `registerManualRefreshHandler(handler: () => Promise<void> | void): () => void` and `runManualRefresh(): Promise<void>` from `src/services/manualRefresh.ts`; `useManualRefreshHandler(handler: () => Promise<void> | void, enabled?: boolean): void` from `src/hooks/useManualRefreshHandler.ts`. Task 4 uses the hook with `usePullToRefresh`'s `triggerRefresh`.

- [ ] **Step 1: Create the registry**

`src/services/manualRefresh.ts`:

```ts
import { manualSync } from './storage';

type ManualRefreshHandler = () => Promise<void> | void;

/**
 * The currently mounted pull-to-refresh surface, if any. Pages register their
 * animated triggerRefresh here so the global Mod+R shortcut can drive the
 * indicator instead of firing a silent background sync. Only one surface is
 * mounted at a time (they live on separate routes), so a singleton suffices.
 */
let current: ManualRefreshHandler | null = null;

export function registerManualRefreshHandler(handler: ManualRefreshHandler): () => void {
  current = handler;
  return () => {
    if (current === handler) current = null;
  };
}

/** Run the page's animated refresh, or fall back to a silent full sync. */
export async function runManualRefresh(): Promise<void> {
  if (current) {
    await current();
  } else {
    await manualSync(true);
  }
}
```

- [ ] **Step 2: Create the hook**

`src/hooks/useManualRefreshHandler.ts`:

```ts
import { useEffect, useRef } from 'react';
import { registerManualRefreshHandler } from '../services/manualRefresh';

/**
 * Registers `handler` as the target of the global manual-refresh action
 * (Mod+R / command palette "Trigger sync") while the component is mounted.
 */
export function useManualRefreshHandler(handler: () => Promise<void> | void, enabled = true) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return;
    return registerManualRefreshHandler(() => handlerRef.current());
  }, [enabled]);
}
```

- [ ] **Step 3: Route App.tsx through the registry**

In `src/App.tsx`, add the import next to the existing storage import (line ~33):

```ts
import { runManualRefresh } from './services/manualRefresh';
```

Change the hotkey handler (lines ~168–171) from:

```ts
  useHotkey(parseHotkey(getKey('trigger-sync') ?? 'Mod+R'), () => {
    trackShortcut('Mod+R', 'trigger_sync', 'global');
    manualSync(true).catch(console.error);
  }, { enabled: isTauri });
```

to:

```ts
  useHotkey(parseHotkey(getKey('trigger-sync') ?? 'Mod+R'), () => {
    trackShortcut('Mod+R', 'trigger_sync', 'global');
    runManualRefresh().catch(console.error);
  }, { enabled: isTauri });
```

Change the command palette action (lines ~231–234) from:

```ts
      [CommandId.TriggerSync]: () => {
        manualSync(true).catch(console.error);
      },
```

to:

```ts
      [CommandId.TriggerSync]: () => {
        runManualRefresh().catch(console.error);
      },
```

If `manualSync` is now unused in `App.tsx`, remove it from the import at line ~33.

- [ ] **Step 4: Typecheck and lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: PASS. (Behavior is unchanged at this point — nothing registers a handler yet, so `runManualRefresh` always falls back to `manualSync(true)`.)

- [ ] **Step 5: Commit**

```bash
git add src/services/manualRefresh.ts src/hooks/useManualRefreshHandler.ts src/App.tsx
git commit -m "feat(sync): route Mod+R and command palette through manual-refresh registry"
```

---

### Task 4: Register the four pull-to-refresh surfaces

**Files:**
- Modify: `src/components/MRList/MRList.tsx` (hook call at lines ~98–101)
- Modify: `src/pages/MyMRsPage.tsx` (hook call at lines ~96–98)
- Modify: `src/pages/IssuesPage.tsx` (hook call at lines ~210–213)
- Modify: `src/pages/PipelinesPage/index.tsx` (hook call at lines ~40–42)

**Interfaces:**
- Consumes: `triggerRefresh` from Task 2, `useManualRefreshHandler` from Task 3.

Each change is the same shape: destructure `triggerRefresh` from `usePullToRefresh` and register it on the next line.

- [ ] **Step 1: MRList.tsx**

Import (path is from `src/components/MRList/`):

```ts
import { useManualRefreshHandler } from '../../hooks/useManualRefreshHandler';
```

Change lines ~98–101 from:

```ts
  const { containerRef: pullRef, pullDistance, refreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: onRefresh ?? (() => {}),
    disabled: !onRefresh,
  });
```

to:

```ts
  const { containerRef: pullRef, pullDistance, refreshing, triggerRefresh } = usePullToRefresh<HTMLDivElement>({
    onRefresh: onRefresh ?? (() => {}),
    disabled: !onRefresh,
  });
  useManualRefreshHandler(triggerRefresh, !!onRefresh);
```

- [ ] **Step 2: MyMRsPage.tsx**

Import:

```ts
import { useManualRefreshHandler } from '../hooks/useManualRefreshHandler';
```

Change lines ~96–98 from:

```ts
  const { containerRef: pullRef, pullDistance, refreshing } = usePullToRefresh<HTMLDivElement>({
    onRefresh: () => manualSyncAndWait(true),
  });
```

to:

```ts
  const { containerRef: pullRef, pullDistance, refreshing, triggerRefresh } = usePullToRefresh<HTMLDivElement>({
    onRefresh: () => manualSyncAndWait(true),
  });
  useManualRefreshHandler(triggerRefresh);
```

- [ ] **Step 3: IssuesPage.tsx**

Import:

```ts
import { useManualRefreshHandler } from '../hooks/useManualRefreshHandler';
```

Change lines ~210–213 from:

```ts
  const { containerRef: pullRef, pullDistance, refreshing } = usePullToRefresh<HTMLElement>({
    onRefresh: handleSync,
    disabled: selectedInstanceId == null,
  });
```

to:

```ts
  const { containerRef: pullRef, pullDistance, refreshing, triggerRefresh } = usePullToRefresh<HTMLElement>({
    onRefresh: handleSync,
    disabled: selectedInstanceId == null,
  });
  useManualRefreshHandler(triggerRefresh, selectedInstanceId != null);
```

- [ ] **Step 4: PipelinesPage/index.tsx**

Import (path is from `src/pages/PipelinesPage/`):

```ts
import { useManualRefreshHandler } from '../../hooks/useManualRefreshHandler';
```

Change lines ~40–42 from:

```ts
  const { containerRef: pullRef, pullDistance, refreshing } = usePullToRefresh<HTMLElement>({
    onRefresh: handleRefresh,
  });
```

to:

```ts
  const { containerRef: pullRef, pullDistance, refreshing, triggerRefresh } = usePullToRefresh<HTMLElement>({
    onRefresh: handleRefresh,
  });
  useManualRefreshHandler(triggerRefresh);
```

- [ ] **Step 5: Run the Task 1 e2e test to verify it now passes**

Run: `bunx playwright test e2e/mr-list.spec.ts -g "Mod\+R shows"`
Expected: PASS — the indicator appears with the spinning animation and "Refreshing" label.

- [ ] **Step 6: Typecheck and commit**

Run: `bunx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/MRList/MRList.tsx src/pages/MyMRsPage.tsx src/pages/IssuesPage.tsx src/pages/PipelinesPage/index.tsx
git commit -m "feat(desktop): Mod+R plays the pull-to-refresh animation on all list pages"
```

---

### Task 5: Remove the header refresh button

**Files:**
- Modify: `src/components/PageHeader/PageHeader.tsx`
- Modify: `src/components/PageHeader/PageHeader.css` (delete `.page-header-refresh` rules, lines ~70–107)
- Modify: `src/pages/MRListPage.tsx` (PageHeader props at lines ~218–221; `queryClient` becomes unused)
- Modify: `src/pages/MyMRsPage.tsx` (PageHeader props at lines ~221–224; `queryClient` still used elsewhere — keep it)
- Modify: `src/pages/IssuesPage.tsx` (PageHeader props at lines ~286–290)
- Modify: `src/pages/PipelinesPage/index.tsx` (PageHeader props at lines ~71–75)
- Modify: `src/services/productTour.ts` (step at lines ~78–86)

**Interfaces:**
- Consumes: nothing — pure removal; Mod+R (Task 4) is now the desktop refresh path.
- Produces: `PageHeaderProps` is reduced to `{ title: string; actions?: ReactNode }`.

- [ ] **Step 1: Strip the button from PageHeader**

Replace the whole of `src/components/PageHeader/PageHeader.tsx` with:

```tsx
import type { ReactNode } from 'react';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
}

export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-title-group">
        <h1>{title}</h1>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
```

(`useSmallScreen` was only used to hide the button on mobile — the import goes away with it.)

- [ ] **Step 2: Delete the button CSS**

In `src/components/PageHeader/PageHeader.css`, delete every rule whose selector starts with `.page-header-refresh` (currently `.page-header-refresh`, `.page-header-refresh:hover:not(:disabled)`, `.page-header-refresh svg`, `.page-header-refresh:active:not(:disabled) svg`, `.page-header-refresh:focus`, `.page-header-refresh:disabled` — lines ~70–107).

- [ ] **Step 3: Update the four call sites**

`src/pages/MRListPage.tsx` — change:

```tsx
      <PageHeader
        title="Merge Requests"
        onRefresh={() => selectedInstanceId != null && queryClient.invalidateQueries({ queryKey: queryKeys.mrList(String(selectedInstanceId)) })}
        refreshAriaLabel="Refresh merge requests"
```

to:

```tsx
      <PageHeader
        title="Merge Requests"
```

Then remove the now-unused `const queryClient = useQueryClient();` (line ~48) and, if nothing else in the file uses them, the `useQueryClient` import and `queryKeys` import (verify with lint — `queryKeys` may still be used elsewhere in the file).

`src/pages/MyMRsPage.tsx` — change:

```tsx
      <PageHeader
        title="My Merge Requests"
        onRefresh={() => selectedInstanceId != null && queryClient.invalidateQueries({ queryKey: queryKeys.myMRList(String(selectedInstanceId)) })}
        refreshAriaLabel="Refresh merge requests"
```

to:

```tsx
      <PageHeader
        title="My Merge Requests"
```

(`queryClient` is still used by the settings toggles in this file — keep it.)

`src/pages/IssuesPage.tsx` — change:

```tsx
      <PageHeader
        title="Issues"
        onRefresh={handleSync}
        refreshDisabled={syncing}
        refreshAriaLabel="Sync issues from GitLab"
```

to:

```tsx
      <PageHeader
        title="Issues"
```

`src/pages/PipelinesPage/index.tsx` — change:

```tsx
      <PageHeader
        title="Pipelines"
        onRefresh={handleRefresh}
        refreshDisabled={refreshing}
        refreshAriaLabel="Refresh pipelines"
```

to:

```tsx
      <PageHeader
        title="Pipelines"
```

- [ ] **Step 4: Re-anchor the product tour step**

In `src/services/productTour.ts` (lines ~78–86), the "Stay in sync" step is anchored to the deleted button. Make it an element-less (centered) step and teach the shortcut instead — change:

```ts
    {
      element: '[data-tour="refresh"]',
      popover: {
        title: 'Stay in sync',
        description:
          'Syncs happen automatically in the background; this triggers one manually.',
        side: 'bottom',
      },
    },
```

to:

```ts
    {
      popover: {
        title: 'Stay in sync',
        description:
          'Syncs happen automatically in the background; press ⌘R to trigger one manually.',
      },
    },
```

(driver.js renders a step without `element` as a centered modal, same as the welcome step. `side` is meaningless without an anchor — drop it.)

- [ ] **Step 5: Typecheck, lint, and run the affected e2e suites**

Run: `bunx tsc --noEmit && bun run lint`
Expected: PASS — this catches any `onRefresh`/`refreshDisabled` prop left behind and unused imports.

Run: `bunx playwright test e2e/product-tour.spec.ts e2e/mr-list.spec.ts e2e/my-mrs.spec.ts`
Expected: PASS — the tour still walks all 8 steps (step 4 is now centered but keeps the "Stay in sync" text the spec asserts).

- [ ] **Step 6: Commit**

```bash
git add src/components/PageHeader/ src/pages/MRListPage.tsx src/pages/MyMRsPage.tsx src/pages/IssuesPage.tsx src/pages/PipelinesPage/index.tsx src/services/productTour.ts
git commit -m "feat(desktop): remove header refresh button in favor of Mod+R"
```

---

### Task 6: Full verification

**Files:** none new.

- [ ] **Step 1: Full e2e suite**

Run: `bunx playwright test`
Expected: PASS (all suites; screenshots may be regenerated — inspect any diff before committing them).

- [ ] **Step 2: Manual check in the real app**

Run: `bun run tauri dev`, then on each of Merge Requests, My MRs, Issues, Pipelines press Cmd+R:
- The indicator slides out at the top of the list, the spinner spins with the "Refreshing" label, and it collapses when the sync finishes.
- On MR detail / Settings, Cmd+R still triggers a silent background sync (no error in console).
- The header no longer shows a refresh button on any page.

- [ ] **Step 3: Commit any remaining artifacts**

```bash
git status
# add/commit only intentional changes (e.g. regenerated e2e screenshots)
```
