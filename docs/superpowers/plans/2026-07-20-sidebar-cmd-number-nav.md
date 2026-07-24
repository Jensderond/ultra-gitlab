# Cmd-Hold Sidebar Number Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While Cmd (or Ctrl) is held, show a numbered badge on each visible top-level sidebar nav icon; pressing that digit navigates there. This requires moving the existing (non-configurable) instance-switch shortcut from `Cmd+1..9` to `Cmd+Shift+1..9` to free up the plain digits.

**Architecture:** All sidebar-nav logic lives in `AppSidebar.tsx` (mounted once, outside the page `<Routes>`, already owns the nav-item list). It's implemented as two independent `window` keydown/keyup listeners (hold-tracking for badge display, digit-detection for navigation), matching the existing raw-listener pattern already used for instance switching in `App.tsx` — not the `@tanstack/react-hotkeys` lib, since this is fixed and non-configurable. The instance-switch handler in `App.tsx` gains a `Shift` requirement.

**Tech Stack:** React 19, TypeScript, Vite, Playwright (e2e only — this component has no unit tests today).

## Global Constraints

- Digit detection MUST use `KeyboardEvent.code` (`"Digit1"`..`"Digit9"`), never `.key` — confirmed empirically: pressing Shift+3 produces `e.key === '#'` (US layout) but `e.code === 'Digit3'`. Any handler that needs to work with or without Shift held must branch on `.code`.
- Skip both hold-tracking and digit-navigation when `e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement` — matches the existing convention in `App.tsx`'s instance-switch handler.
- No entry added to `src/config/shortcuts.ts` or the Settings shortcut editor — this shortcut is fixed and non-configurable by design.
- Numbering only ever covers `topItems` (Settings/bottom items are excluded).
- Cross-platform modifier check: `e.metaKey || e.ctrlKey`, matching the existing instance-switch handler — don't introduce a new abstraction for this.
- Package manager is bun. Typecheck with `bunx tsc --noEmit`. Run a single e2e spec fast during a task with `bunx playwright test e2e/navigation.spec.ts -g "<test name>" --project=chromium`; the full suite (`bun run test:e2e`) runs automatically as part of the pre-commit hook (along with `lint:fix` and `tsc --noEmit`) — don't run the full suite manually every step, just before committing if you want an early signal.

---

### Task 1: Move instance switching to `Cmd+Shift+Digit`

**Files:**
- Modify: `src/App.tsx:181-199` (the `handleInstanceSwitch` effect)
- Modify: `src/components/InstanceSwitcher/InstanceSwitcher.tsx:3` (header comment) and `:155` (rendered `kbd` hint)
- Test: `e2e/navigation.spec.ts` (new `test.describe` block appended at the end of the file)

**Interfaces:**
- Produces: nothing consumed by later tasks directly, but Task 3's digit-navigation handler MUST require `!e.shiftKey` so the two global handlers never both fire for the same keypress.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/navigation.spec.ts` (after the existing `test.describe('Navigation & Sidebar', ...)` block, as a sibling top-level block):

```ts
test.describe('Instance switch shortcut (Cmd+Shift+digit)', () => {
  test('Cmd+Shift+1 dispatches instance-switch; plain Cmd+1 does not', async ({ page }) => {
    await page.goto('/mrs');

    await page.evaluate(() => {
      (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes = [];
      window.addEventListener('instance-switch', (e) => {
        (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes.push(
          (e as CustomEvent<{ index: number }>).detail.index
        );
      });
    });

    await page.keyboard.press('ControlOrMeta+Shift+Digit1');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes))
      .toEqual([0]);

    await page.keyboard.press('ControlOrMeta+Digit2');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes))
      .toEqual([0]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bunx playwright test e2e/navigation.spec.ts -g "Cmd+Shift+1 dispatches instance-switch" --project=chromium`
Expected: FAIL on the first `expect.poll(...).toEqual([0])` — the current handler keys off `e.key`, and `e.key` for Shift+1 is `'!'` (not in the `'1'..'9'` range it checks), so `Cmd+Shift+1` currently dispatches nothing at all.

- [ ] **Step 3: Fix the handler in `src/App.tsx`**

Replace the effect at lines 181-199:

```tsx
  // Cmd+Shift+1..9 to switch instance (dynamic keys — not customizable)
  useEffect(() => {
    function handleInstanceSwitch(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.code.startsWith('Digit') &&
        e.code !== 'Digit0'
      ) {
        e.preventDefault();
        const digit = e.code.slice('Digit'.length);
        const index = parseInt(digit, 10) - 1;
        trackShortcut(`Mod+Shift+${digit}`, 'switch_instance', 'global');
        window.dispatchEvent(
          new CustomEvent('instance-switch', { detail: { index } })
        );
      }
    }
    window.addEventListener('keydown', handleInstanceSwitch);
    return () => window.removeEventListener('keydown', handleInstanceSwitch);
  }, []);
```

- [ ] **Step 4: Update the displayed shortcut hint in `InstanceSwitcher.tsx`**

Change the header comment at line 3 from:
```ts
 * Supports Cmd+1/2/3... keyboard shortcuts for quick switching.
```
to:
```ts
 * Supports Cmd+Shift+1/2/3... keyboard shortcuts for quick switching.
```

Change the rendered hint at line 155 from:
```tsx
                <kbd className="instance-switcher-shortcut">{'\u2318'}{index + 1}</kbd>
```
to (prepend a Shift-glyph escape before the existing Cmd-glyph escape):
```tsx
                <kbd className="instance-switcher-shortcut">{'\u21e7'}{'\u2318'}{index + 1}</kbd>
```

Also update the comment above it (line 49) from `// Listen for global instance-switch events (from Cmd+1/2/3 shortcuts)` to `// Listen for global instance-switch events (from Cmd+Shift+1/2/3 shortcuts)`.

- [ ] **Step 5: Run the test again and confirm it passes**

Run: `bunx playwright test e2e/navigation.spec.ts -g "Cmd+Shift+1 dispatches instance-switch" --project=chromium`
Expected: PASS (1 passed)

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no output (no errors)

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/InstanceSwitcher/InstanceSwitcher.tsx e2e/navigation.spec.ts
git commit -m "fix: move instance-switch shortcut to Cmd+Shift+digit"
```

---

### Task 2: Cmd-hold badge display in the sidebar

**Files:**
- Modify: `src/components/AppSidebar/AppSidebar.tsx`
- Modify: `src/components/AppSidebar/AppSidebar.css`
- Test: `e2e/navigation.spec.ts`

**Interfaces:**
- Produces: a module-level helper `isEditableTarget(target: EventTarget | null): boolean` in `AppSidebar.tsx`, reused by Task 3.
- Produces: badges rendered with class `app-sidebar-number-hint` and text content equal to the item's 1-based position among `topItems`, visible only while a `cmdHeld` boolean state is `true`.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/navigation.spec.ts`, as another new top-level `test.describe` block:

```ts
test.describe('Cmd-hold sidebar number hints', () => {
  test('holding Cmd shows numbered badges on top nav items only, hidden on release', async ({ page }) => {
    await page.goto('/mrs');

    const badges = page.locator('.app-sidebar-number-hint');
    await expect(badges).toHaveCount(0);

    await page.keyboard.down('ControlOrMeta');
    await expect(badges).toHaveCount(4);
    await expect(badges).toHaveText(['1', '2', '3', '4']);
    await expect(page.locator('button[title="Settings"] .app-sidebar-number-hint')).toHaveCount(0);

    await page.keyboard.up('ControlOrMeta');
    await expect(badges).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bunx playwright test e2e/navigation.spec.ts -g "holding Cmd shows numbered badges" --project=chromium`
Expected: FAIL — `expect(badges).toHaveCount(4)` never satisfied, no `.app-sidebar-number-hint` elements exist yet.

- [ ] **Step 3: Implement in `AppSidebar.tsx`**

Change the React import line (currently `import { useRef, useLayoutEffect, useEffect, useCallback } from 'react';`) to add `useState`:

```tsx
import { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
```

Add this module-level helper right after the `isBottomPath` function (which currently ends the module-scope declarations just above `export function AppSidebar`):

```tsx
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
```

Inside the `AppSidebar` component, add the hold-tracking state and effect. Place it near the other `useEffect` calls (after the "Clear animation timeout on unmount only" effect):

```tsx
  const [cmdHeld, setCmdHeld] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Meta' || e.key === 'Control') setCmdHeld(true);
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === 'Meta' || e.key === 'Control') setCmdHeld(false);
    }
    function handleBlur() {
      setCmdHeld(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);
```

Update the `topItems.map` in the JSX (in the `app-sidebar-top` div) to take an `index` and render the badge. Change:

```tsx
        {topItems.map(item => (
          <button
            key={item.path}
            data-path={item.path}
            className={`app-sidebar-item ${isActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            {item.icon}
            {item.path === '/my-mrs' && hasApprovedMRs && (
              <span className="approved-dot" />
            )}
          </button>
        ))}
```

to:

```tsx
        {topItems.map((item, index) => (
          <button
            key={item.path}
            data-path={item.path}
            className={`app-sidebar-item ${isActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            {item.icon}
            {item.path === '/my-mrs' && hasApprovedMRs && (
              <span className="approved-dot" />
            )}
            {cmdHeld && (
              <span className="app-sidebar-number-hint">{index + 1}</span>
            )}
          </button>
        ))}
```

- [ ] **Step 4: Add the badge style to `AppSidebar.css`**

Add after the existing `.approved-dot { ... }` rule:

```css
.app-sidebar-number-hint {
  position: absolute;
  bottom: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 2px;
  border-radius: 4px;
  background: var(--accent-color);
  color: var(--bg-secondary);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}
```

- [ ] **Step 5: Run the test again and confirm it passes**

Run: `bunx playwright test e2e/navigation.spec.ts -g "holding Cmd shows numbered badges" --project=chromium`
Expected: PASS (1 passed)

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no output

- [ ] **Step 7: Commit**

```bash
git add src/components/AppSidebar/AppSidebar.tsx src/components/AppSidebar/AppSidebar.css e2e/navigation.spec.ts
git commit -m "feat: show numbered badges on sidebar while Cmd is held"
```

---

### Task 3: `Cmd+Digit` navigates to the matching sidebar item

**Files:**
- Modify: `src/components/AppSidebar/AppSidebar.tsx`
- Test: `e2e/navigation.spec.ts`

**Interfaces:**
- Consumes: `isEditableTarget` (from Task 2, same file), `topItems` and `navigate` (already defined earlier in the component), `trackShortcut` from `../../services/analytics` (new import).

- [ ] **Step 1: Write the failing e2e tests**

Add these three tests inside the `test.describe('Cmd-hold sidebar number hints', ...)` block added in Task 2 (as additional `test(...)` entries alongside the existing one):

```ts
  test('Cmd+2 navigates to the second visible sidebar item', async ({ page }) => {
    await page.goto('/mrs');
    await page.keyboard.press('ControlOrMeta+Digit2');
    await expect(page).toHaveURL(/\/my-mrs/);
  });

  test('Cmd+Shift+1 does not trigger sidebar navigation', async ({ page }) => {
    await page.goto('/my-mrs');
    await page.keyboard.press('ControlOrMeta+Shift+Digit1');
    await expect(page).toHaveURL(/\/my-mrs/);
  });

  test('typing in an input suppresses Cmd+2 sidebar navigation', async ({ page }) => {
    await page.goto('/mrs');
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'scratch-input';
      document.body.appendChild(input);
      input.focus();
    });
    await page.keyboard.press('ControlOrMeta+Digit2');
    await expect(page).toHaveURL(/\/mrs/);
  });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `bunx playwright test e2e/navigation.spec.ts -g "sidebar item|sidebar navigation" --project=chromium`
Expected: `'Cmd+2 navigates to the second visible sidebar item'` FAILS (URL stays `/mrs`, no navigation handler exists yet). The other two currently pass vacuously (nothing navigates yet), which is fine — they'll stay meaningful once Step 3 lands.

- [ ] **Step 3: Implement in `AppSidebar.tsx`**

Add the import at the top of the file (alongside the existing imports):

```tsx
import { trackShortcut } from '../../services/analytics';
```

Add a new effect in the component, after the hold-tracking effect added in Task 2:

```tsx
  useEffect(() => {
    function handleDigitNav(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.repeat) return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (!e.code.startsWith('Digit') || e.code === 'Digit0') return;

      const digit = e.code.slice('Digit'.length);
      const index = parseInt(digit, 10) - 1;
      if (index < 0 || index >= topItems.length) return;

      e.preventDefault();
      trackShortcut(`Mod+${digit}`, 'navigate_sidebar', 'global');
      navigate(topItems[index].path);
    }
    window.addEventListener('keydown', handleDigitNav);
    return () => window.removeEventListener('keydown', handleDigitNav);
  }, [topItems, navigate]);
```

- [ ] **Step 4: Run the tests again and confirm they pass**

Run: `bunx playwright test e2e/navigation.spec.ts -g "sidebar item|sidebar navigation" --project=chromium`
Expected: 3 passed

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no output

- [ ] **Step 6: Run the full navigation spec file once for a broader regression check**

Run: `bunx playwright test e2e/navigation.spec.ts --project=chromium`
Expected: all tests in the file pass (the pre-existing tests plus all tests added in Tasks 1-3)

- [ ] **Step 7: Commit**

```bash
git add src/components/AppSidebar/AppSidebar.tsx e2e/navigation.spec.ts
git commit -m "feat: Cmd+digit navigates sidebar pages"
```
