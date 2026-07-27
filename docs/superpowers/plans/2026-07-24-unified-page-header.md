# Unified Page Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every top-level page header in the app (MR List, My MRs, Pipelines, Issues, and all three Settings views) renders through the shared `<PageHeader>` component at exactly one of two fixed heights — 60px desktop, 56px mobile — instead of each page's height drifting a few px depending on which action buttons happen to be mounted.

**Architecture:** `PageHeader.css` switches from an implicit, baseline-derived height to an explicit `height` + `align-items: center` + `box-sizing: border-box`. `PageHeader.tsx` gains one new optional `leading` slot (for a `BackButton`). Settings currently hand-duplicates the header markup/CSS (`.settings-header`) and additionally renders a second, separate in-content header (`.settings-detail-header`) inside its desktop detail pane; both are deleted and replaced with the same `<PageHeader>` component Settings' mobile drill-in will now also use, with the description text moved into the scrolling content pane as a plain paragraph.

**Tech Stack:** React 19 + TypeScript, Playwright e2e (Tauri IPC mocked via `e2e/fixtures/tauri-mock.ts`), Bun.

## Global Constraints

- Mobile is viewport width < 768px, matching the existing `useSmallScreen` hook (`src/hooks/useSmallScreen.ts:3`, `SMALL_SCREEN_BREAKPOINT = 768`) and the CSS breakpoint `max-width: 767px`.
- Header heights are fixed constants: **60px desktop, 56px mobile** — every top-level page header must render at exactly one of these two values, verified via `boundingBox().height` in e2e tests.
- `BackButton` (`src/components/BackButton.tsx` / `.css`) is unchanged — it's used elsewhere (MR/Pipeline detail headers) outside this task's scope. It stays 32px desktop / 40px square on mobile; the header is sized to fit it, not the other way around.
- No changes to Settings' persistence, commands, routes, or section content components — this is header/layout-only.
- Package manager is `bun`. Typecheck with `bunx tsc --noEmit`, lint with `bun run lint`, e2e with `bun run test:e2e`.
- Spec: `docs/superpowers/specs/2026-07-24-unified-page-header-design.md`.

---

### Task 1: `PageHeader` — fixed height, center alignment, `leading` slot

**Files:**
- Modify: `src/components/PageHeader/PageHeader.tsx`
- Modify: `src/components/PageHeader/PageHeader.css`
- Create: `e2e/page-header-heights.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PageHeaderProps` gains `leading?: ReactNode` (rendered before `<h1>`, inside `.page-header-title-group`). `title`, `refreshing`, `actions` are unchanged. Task 2 consumes `leading` to pass a `BackButton`.

---

- [ ] **Step 1: Write the failing e2e spec**

Create `e2e/page-header-heights.spec.ts`:

```typescript
import { test, expect } from './fixtures/test-base';

/**
 * MR List, My MRs, Pipelines and Issues all render the same <PageHeader>
 * component. Its height must be a fixed constant per breakpoint —
 * 60px desktop, 56px mobile (<768px) — regardless of which action buttons
 * a given page happens to mount.
 */

const DESKTOP_HEIGHT = 60;
const MOBILE_HEIGHT = 56;

test.describe('Page header heights — desktop', () => {
  test('MR List, My MRs, Pipelines and Issues headers are all the same height', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('h1')).toHaveText('Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);

    await page.goto('/my-mrs');
    await expect(page.locator('h1')).toHaveText('My Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);

    await page.goto('/pipelines');
    await expect(page.locator('h1')).toHaveText('Pipelines');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);

    await page.goto('/issues');
    await expect(page.locator('h1')).toHaveText('Issues');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);
  });
});

test.describe('Page header heights — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('MR List, My MRs, Pipelines and Issues headers are all the same height', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('h1')).toHaveText('Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);

    await page.goto('/my-mrs');
    await expect(page.locator('h1')).toHaveText('My Merge Requests');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);

    await page.goto('/pipelines');
    await expect(page.locator('h1')).toHaveText('Pipelines');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);

    await page.goto('/issues');
    await expect(page.locator('h1')).toHaveText('Issues');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);
  });
});
```

- [ ] **Step 2: Run the spec and confirm it fails**

Run: `bun run test:e2e -- page-header-heights`
Expected: FAIL — today's heights are 58/62/57 on desktop (not 60) and vary on mobile too (not 56).

- [ ] **Step 3: Rewrite `PageHeader.css`**

Replace the full contents of `src/components/PageHeader/PageHeader.css`:

```css
/* Reusable page header — calligraphic title bar with refresh + actions slot.
   Used on every top-level page (MR list, My MRs, Issues, Pipelines,
   Settings…) — height is a fixed constant per breakpoint (60px desktop /
   56px mobile) so every screen's header is pixel-identical regardless of
   which action buttons or leading control (e.g. a BackButton) it renders. */

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 32px;
  box-sizing: border-box;
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  z-index: 100;
}

.page-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 32px;
  right: 32px;
  height: 1px;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--border-color) 15%,
    var(--text-fuji) 50%,
    var(--border-color) 85%,
    transparent 100%);
  opacity: 0.6;
}

.page-header h1 {
  margin: 0;
  font-family: var(--ui-font, 'Noto Sans JP', -apple-system, sans-serif);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 16px;
  line-height: 1;
}

.page-header h1::before {
  content: '';
  display: block;
  width: 3px;
  height: 22px;
  background: linear-gradient(180deg,
    var(--accent-color) 0%,
    var(--accent-hover) 60%,
    transparent 100%);
  border-radius: 1.5px;
  box-shadow: 0 0 14px var(--wave-glow-strong);
  flex-shrink: 0;
}

.page-header-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Compact nav-bar treatment on phone widths — the 26px display title reads
   as oversized chrome once the sidebar has already collapsed to a bottom
   tab bar (which carries its own iconography for wayfinding). */
@media (max-width: 767px) {
  .page-header {
    height: 56px;
    padding: 0 16px;
  }

  .page-header h1 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
    gap: 10px;
  }

  .page-header h1::before {
    height: 14px;
  }
}

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

What changed from today's file: `align-items: baseline` → `center`; `padding: 24px 32px 20px` → `height: 60px; padding: 0 32px; box-sizing: border-box;`; `.page-header-title-group` gap `4px` → `12px` (room for the `leading` slot added in Step 4); the mobile block's `padding: 14px 16px 12px` → `height: 56px; padding: 0 16px;`; the touch-device `@media (max-width: 767px) and (hover: none), (max-width: 767px) and (pointer: coarse) { .page-header { padding-top: 6px; } }` block is removed entirely (it only existed to shave asymmetric top padding, which no longer exists now that padding is horizontal-only and content is vertically centered).

- [ ] **Step 4: Add the `leading` prop to `PageHeader.tsx`**

Replace the full contents of `src/components/PageHeader/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { SyncProgressBar } from '../PullToRefresh';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  /** Rendered before the title — e.g. a BackButton on a drill-in screen. */
  leading?: ReactNode;
  /** Shows the header refresh feedback (centered spinner on desktop, bottom
      progress bar everywhere) — absolutely positioned, never shifts layout. */
  refreshing?: boolean;
  actions?: ReactNode;
}

export function PageHeader({ title, leading, refreshing = false, actions }: PageHeaderProps) {
  const isSmallScreen = useSmallScreen();

  return (
    <header className="page-header">
      <div className="page-header-title-group">
        {leading}
        <h1>{title}</h1>
      </div>
      {refreshing && !isSmallScreen && (
        <div className="page-header-refreshing" aria-hidden="true">
          <ArrowsClockwise size={14} weight="bold" />
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

(Only change from today's file: the `leading` prop, its JSDoc, and rendering it before `<h1>`.)

- [ ] **Step 5: Run the spec and confirm it passes**

Run: `bun run test:e2e -- page-header-heights`
Expected: PASS — both the desktop and mobile tests.

- [ ] **Step 6: Run the full e2e suite, typecheck and lint**

Run: `bun run test:e2e && bunx tsc --noEmit && bun run lint`
Expected: all e2e tests pass (this CSS change touches every list page — `mr-list.spec.ts`'s `Mod+R` test in particular asserts a list item's `y` position is unchanged before/after refresh, which still holds since it compares before/after, not an absolute value); typecheck clean; only pre-existing lint warnings (no new errors).

- [ ] **Step 7: Commit**

```bash
git add src/components/PageHeader/PageHeader.tsx src/components/PageHeader/PageHeader.css e2e/page-header-heights.spec.ts
git commit -m "fix(page-header): unify header height across MR List, My MRs, Pipelines and Issues"
```

---

### Task 2: Settings — fold root, drill-in, and detail sub-heading into `PageHeader`

**Files:**
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/pages/Settings.css`
- Modify: `e2e/page-header-heights.spec.ts`

**Interfaces:**
- Consumes: `PageHeader` from `../../components/PageHeader` with `{ title: string, leading?: ReactNode }` (produced in Task 1); `BackButton` from `../../components/BackButton` (unchanged, existing import).
- Produces: no new exports. `Settings`'s own props (`{ updateChecker? }`) are unchanged.

---

- [ ] **Step 1: Write the failing Settings e2e tests**

Append this to the end of `e2e/page-header-heights.spec.ts` (after the closing `});` of the `'Page header heights — mobile'` describe block):

```typescript

test.describe('Settings header heights', () => {
  test('desktop rail+detail header matches the same height and shows the active section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1')).toHaveText('GitLab Instances');
    expect((await page.locator('.page-header').boundingBox())!.height).toBe(DESKTOP_HEIGHT);
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('category list header matches the mobile height', async ({ page }) => {
      await page.goto('/settings');
      await expect(page.locator('h1')).toHaveText('Settings');
      expect((await page.locator('.page-header').boundingBox())!.height).toBe(MOBILE_HEIGHT);
    });

    test('drill-in header matches the mobile height and the back button fits inside it', async ({ page }) => {
      await page.goto('/settings/instances');
      await expect(page.locator('h1')).toHaveText('GitLab Instances');

      const headerBox = (await page.locator('.page-header').boundingBox())!;
      expect(headerBox.height).toBe(MOBILE_HEIGHT);

      const backButton = page.locator('.back-button-icon');
      await expect(backButton).toBeVisible();
      const backBox = (await backButton.boundingBox())!;
      expect(backBox.y).toBeGreaterThanOrEqual(headerBox.y);
      expect(backBox.y + backBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height);
    });
  });
});
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `bun run test:e2e -- page-header-heights`
Expected: FAIL on all three new "Settings header heights" tests — Settings doesn't render `<PageHeader>`/`.page-header` yet, and the desktop `h1` still reads "Settings" instead of "GitLab Instances".

- [ ] **Step 3: Add the `PageHeader` import**

In `src/pages/Settings/index.tsx`, add the import alongside the other component imports (after the existing `import BackButton from '../../components/BackButton';` on line 17):

```typescript
import { PageHeader } from '../../components/PageHeader';
```

- [ ] **Step 4: Replace the mobile category-list header**

In `src/pages/Settings/index.tsx`, find this block (the `isSmallScreen && !activeDef` branch):

```tsx
      <div className="settings-page">
        <header className="settings-header settings-header--root">
          <h1>Settings</h1>
        </header>
        <main className="settings-content">
          <nav className="settings-mobile-list">
```

Replace the `<header>` line with:

```tsx
      <div className="settings-page">
        <PageHeader title="Settings" />
        <main className="settings-content">
          <nav className="settings-mobile-list">
```

- [ ] **Step 5: Replace the mobile drill-in header**

In the same file, find this block (the `isSmallScreen && activeDef` branch):

```tsx
      <div className="settings-page">
        <header className="settings-header settings-header--sub">
          <BackButton to="/settings" title="Back to Settings" />
          <h1>{activeDef.label}</h1>
        </header>
        <main className="settings-content">
```

Replace the `<header>...</header>` block with:

```tsx
      <div className="settings-page">
        <PageHeader
          title={activeDef.label}
          leading={<BackButton to="/settings" title="Back to Settings" />}
        />
        <main className="settings-content">
```

(The rest of this branch — the `<p className="settings-detail-description">` and `<div className="settings-detail-content">` — is already exactly the shape desktop needs too, so it's untouched here.)

- [ ] **Step 6: Replace the desktop root header and fold the detail sub-heading in**

In the same file, find the final `return` block (desktop rail+detail):

```tsx
    <div className="settings-page">
      <header className="settings-header settings-header--root">
        <h1>Settings</h1>
      </header>
      <div className="settings-body">
```

Replace the `<header>` line with:

```tsx
    <div className="settings-page">
      <PageHeader title={activeDef?.label ?? 'Settings'} />
      <div className="settings-body">
```

Then, further down in the same `return` block, find:

```tsx
        {activeDef && (
          <main className="settings-detail" key={activeDef.id}>
            <header className="settings-detail-header">
              <h2>{activeDef.label}</h2>
              <p>{activeDef.description}</p>
            </header>
            <div className="settings-detail-content">
```

Replace the `<header className="settings-detail-header">...</header>` block with:

```tsx
        {activeDef && (
          <main className="settings-detail" key={activeDef.id}>
            <p className="settings-detail-description">{activeDef.description}</p>
            <div className="settings-detail-content">
```

- [ ] **Step 7: Delete the dead `.settings-header` CSS**

In `src/pages/Settings.css`, delete lines 18–82 (the `HEADER` section comment through the end of `.settings-header h1::before`, i.e. everything between `.settings-page { … }` and the `CONTENT AREA` section comment). Before deletion this range reads:

```css
/* ================================================
   HEADER
   ================================================ */

/* Padding, h1 type scale, accent bar and background all match the shared
   <PageHeader> used by Issues/Pipelines/My MRs — Settings is a primary
   sidebar/tab destination too, so its header should read as the same chrome,
   not a distinct sub-page. In particular: no background/blur of its own —
   the glass-gradient this used to have created a visible seam against the
   plain --bg-primary that .app-content extends up under the status bar/notch. */
.settings-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 32px 20px;
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.settings-header::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 32px;
  right: 32px;
  height: 1px;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--border-color) 15%,
    var(--text-fuji) 50%,
    var(--border-color) 85%,
    transparent 100%);
  opacity: 0.6;
}

.settings-header h1 {
  margin: 0;
  font-family: var(--ui-font, 'Noto Sans JP', -apple-system, sans-serif);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 16px;
  line-height: 1;
}

/* Vertical accent bar */
.settings-header h1::before {
  content: '';
  display: block;
  width: 3px;
  height: 22px;
  background: linear-gradient(180deg,
    var(--accent-color) 0%,
    var(--accent-hover) 60%,
    transparent 100%);
  border-radius: 1.5px;
  box-shadow: 0 0 14px var(--wave-glow-strong);
  flex-shrink: 0;
}

```

Delete this whole block, leaving `.settings-page { … }` followed directly by the `CONTENT AREA` section comment and `.settings-content { … }`.

- [ ] **Step 8: Delete the dead `.settings-detail-header` CSS and trim the combined selector**

In the same file, find:

```css
.settings-detail-header {
  max-width: 640px;
  margin: 0 auto 18px;
}

.settings-detail-header h2 {
  margin: 0 0 6px;
  font-family: var(--ui-font, 'Noto Sans JP', sans-serif);
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text-primary);
}

.settings-detail-header p,
.settings-detail-description {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
```

Replace it with:

```css
.settings-detail-description {
  margin: 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
```

(This deletes `.settings-detail-header` and `.settings-detail-header h2` entirely, and drops the now-dead `.settings-detail-header p,` line from the combined selector — the rule immediately below this one, `.settings-detail-description { width: 100%; max-width: 640px; margin: 0 auto 6px; box-sizing: border-box; }`, is untouched and still applies alongside it.)

- [ ] **Step 9: Delete the dead mobile `.settings-header` media blocks**

In the same file, find:

```css
/* Compact header on phone widths — matches the shared <PageHeader> breakpoint. */
@media (max-width: 767px) {
  .settings-header {
    padding: 14px 16px 12px;
  }

  .settings-header h1 {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
    gap: 10px;
  }

  .settings-header h1::before {
    height: 14px;
  }
}

/* On touch devices (iOS) there's no traffic-light window chrome to clear, and
   .app-content already reserves env(safe-area-inset-top) for the status bar/notch —
   so the header's own top padding only needs to be a small visual gap, not clearance. */
@media (max-width: 767px) and (hover: none), (max-width: 767px) and (pointer: coarse) {
  .settings-header {
    padding-top: 6px;
  }
}
```

Delete both blocks entirely (they're superseded by `PageHeader.css`'s own mobile block from Task 1).

- [ ] **Step 10: Drop `.settings-header` from the reduced-motion rule**

In the same file, find:

```css
@media (prefers-reduced-motion: reduce) {
  .settings-header,
  .settings-content,
  .settings-rail,
  .settings-detail {
    animation: none;
  }
}
```

Replace with:

```css
@media (prefers-reduced-motion: reduce) {
  .settings-content,
  .settings-rail,
  .settings-detail {
    animation: none;
  }
}
```

- [ ] **Step 11: Run the new tests and confirm they pass**

Run: `bun run test:e2e -- page-header-heights`
Expected: PASS — all tests in the file, including the three new "Settings header heights" tests.

- [ ] **Step 12: Run the full e2e suite, typecheck and lint**

Run: `bun run test:e2e && bunx tsc --noEmit && bun run lint`
Expected: all e2e tests pass — in particular `shortcut-editor.spec.ts` (goes straight to `/settings/shortcuts`, asserts on `.shortcuts-editor`/`.shortcut-editor-item`, unaffected by the header swap) and `product-tour.spec.ts` (asserts on `.driver-popover` content and `[data-tour="settings-instances"]`, both inside `SectionContent`, unaffected). Typecheck clean; only pre-existing lint warnings.

- [ ] **Step 13: Commit**

```bash
git add src/pages/Settings/index.tsx src/pages/Settings.css e2e/page-header-heights.spec.ts
git commit -m "refactor(settings): fold settings headers into shared PageHeader"
```

---

## Self-Review

**Spec coverage:**
- `.page-header` fixed height (60px desktop / 56px mobile), `align-items: center`, `box-sizing: border-box` → Task 1 Step 3. ✓
- `.page-header-title-group` gap `4px` → `12px` → Task 1 Step 3. ✓
- Touch-device `padding-top: 6px` override removed → Task 1 Step 3. ✓
- `PageHeader` gains `leading` prop → Task 1 Step 4. ✓
- MR List/My MRs/Pipelines/Issues need no source changes, inherit fix automatically → Task 1 Steps 1–2 (spec written against them directly, no `src/pages/*` changes in Task 1's file list). ✓
- Settings mobile category list uses `<PageHeader title="Settings" />` → Task 2 Step 4. ✓
- Settings mobile drill-in uses `<PageHeader title leading={<BackButton .../>} />` → Task 2 Step 5. ✓
- Settings desktop shows the active section's name instead of static "Settings" → Task 2 Step 6. ✓
- Desktop `.settings-detail-header` (h2 + description) deleted; description becomes `.settings-detail-description` paragraph in the content pane, matching mobile's existing pattern → Task 2 Steps 6, 8. ✓
- `.settings-header` (base, `::after`, `h1`, `h1::before`, both media blocks) deleted entirely → Task 2 Steps 7, 9. ✓
- `.settings-header` dropped from the reduced-motion selector list → Task 2 Step 10. ✓
- `BackButton` itself untouched → no task modifies `BackButton.tsx`/`.css`. ✓
- Resulting heights table (60/56 across all 5 screens) → verified by the full `e2e/page-header-heights.spec.ts`. ✓
- Out of scope: `BackButton` size, other in-content headers, Settings persistence/commands/routes/section content → none touched by either task. ✓

**Placeholder scan:** No TBD/TODO; every step shows complete code; no "similar to Task N" references — Task 2's Steps 4–6 each show the full before/after JSX inline even though the pattern repeats.

**Type consistency:** `PageHeaderProps.leading?: ReactNode` (Task 1 Step 4) is exactly the type `<BackButton to="/settings" title="Back to Settings" />` satisfies (a JSX element is a `ReactNode`) when consumed in Task 2 Step 5. `activeDef?.label ?? 'Settings'` (Task 2 Step 6) matches `activeDef: SectionDef | undefined` and `SectionDef.label: string` already defined in `Settings/index.tsx`. `title: string` is satisfied by both `"Settings"` and `activeDef.label`/`activeDef?.label ?? 'Settings'` in all three call sites.
