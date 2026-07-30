# MR List Tab Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable `⌃⌥←` / `⌃⌥→` shortcuts that step through the MR list's status tabs with wrap-around, and delete the hardcoded `Shift+H` binding they replace.

**Architecture:** Two new entries in the central `config/shortcuts.ts` array drive two `useHotkey` calls in `MRListPage`. Stepping is modular arithmetic over the existing `STATUS_TABS` array, so wrap-around is free and no tab ids are hardcoded. The hotkeys route through the page's existing `setActiveTab`, which keeps the tab in the URL via `navigate(..., { replace: true })`.

**Tech Stack:** React 19, TypeScript, `@tanstack/react-hotkeys` (`useHotkey` + `parseHotkey`), Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-07-30-mr-list-tab-shortcuts-design.md`

## Global Constraints

- **Package manager is `bun`**, never npm or yarn. Typecheck with `bunx tsc --noEmit`, lint with `bun run lint`.
- **Default key strings must use the library's canonical modifier name `Control`**, not `Ctrl` — exactly `'Control+Alt+ArrowLeft'` and `'Control+Alt+ArrowRight'`. This is what the Settings hotkey recorder serialises to on macOS, so defaults and rebindings must be the same string.
- **The only test framework in this repo is Playwright** (`bun run test:e2e`). There is no vitest/jest. All tests in this plan are e2e specs under `e2e/`.
- **The pre-commit hook runs `lint:fix`, `tsc --noEmit`, and the full e2e suite.** It also regenerates screenshot PNGs as a side effect. The working tree already contains unrelated modified files (four screenshots, three CSS files, `Info.plist`, `skills-lock.json`) — **stage only the files each task names**, never `git add -A`.
- **Do not touch** `MyMRDetailPage`'s `1`/`2`/`3` tab bindings or the `toggle-snoozed` (`Shift+Z`) shortcut. Both are explicitly out of scope.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/config/shortcuts.ts` | Modify | Add `prev-tab` / `next-tab` definitions. Sole source of default bindings; Settings editor and `?` help overlay both read from it. |
| `src/pages/MRListPage.tsx` | Modify | Add `stepTab` helper + two `useHotkey` calls; delete the `Shift+H` `useEffect`; add footer hint (Task 2). |
| `e2e/mr-list.spec.ts` | Modify | Add a `Status tab shortcuts` describe block. |

No new files. `MRListPage.tsx` is ~360 lines and stays well-bounded; the net change is roughly break-even since a 14-line raw-listener effect comes out.

---

### Task 1: Stepping shortcuts, replacing Shift+H

**Files:**
- Modify: `src/config/shortcuts.ts` (append to the MR List block, after `toggle-snoozed` at :172-178)
- Modify: `src/pages/MRListPage.tsx` (add helper after `parseTab` at :52-56; add hotkeys after the `toggle-snoozed` call at :207-209; delete :100-114)
- Test: `e2e/mr-list.spec.ts`

**Interfaces:**
- Consumes: `STATUS_TABS` and `MrTab` (already in `MRListPage.tsx:44-48`); `setActiveTab(next: MrTab | ((prev: MrTab) => MrTab)) => void` (:92); `filtering: boolean` (:132); `getKey(id: string) => string | undefined` from `useShortcuts()` (:206).
- Produces: shortcut ids `'prev-tab'` and `'next-tab'`; module-private `stepTab(current: MrTab, delta: number): MrTab`.

**Ordering constraint:** the two `useHotkey` calls read `filtering`, which is declared at :132, and `getKey`, declared at :206. They must therefore go **after** the existing `toggle-snoozed` `useHotkey` at :207-209 — not at :101 where the deleted effect lived.

- [ ] **Step 1: Write the failing tests**

Append this describe block inside the top-level `test.describe('MR List Page', ...)` in `e2e/mr-list.spec.ts`, after the existing `Search keyboard navigation` block (i.e. before the final closing `});`):

```ts
  test.describe('Status tab shortcuts', () => {
    test('⌃⌥→ steps forward through the tabs and wraps', async ({ page }) => {
      await page.goto('/mrs');
      await expect(page.locator('.mr-list-content')).toBeVisible();

      const needsReview = page.getByRole('tab', { name: /Needs review/ });
      const approved = page.getByRole('tab', { name: /Approved/ });
      const snoozed = page.getByRole('tab', { name: /Snoozed/ });

      await expect(needsReview).toHaveAttribute('aria-selected', 'true');

      await page.keyboard.press('Control+Alt+ArrowRight');
      await expect(approved).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(/\?tab=approved/);

      await page.keyboard.press('Control+Alt+ArrowRight');
      await expect(snoozed).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(/\?tab=snoozed/);

      // Wrapping lands on the default tab, which drops the query string entirely.
      await page.keyboard.press('Control+Alt+ArrowRight');
      await expect(needsReview).toHaveAttribute('aria-selected', 'true');
      await expect(page).toHaveURL(/\/mrs$/);
    });

    test('⌃⌥← steps backward, wrapping to the last tab', async ({ page }) => {
      await page.goto('/mrs');
      await expect(page.locator('.mr-list-content')).toBeVisible();

      await page.keyboard.press('Control+Alt+ArrowLeft');
      await expect(page.getByRole('tab', { name: /Snoozed/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page).toHaveURL(/\?tab=snoozed/);
    });

    test('tab shortcuts are inert while a search filter is live', async ({ page }) => {
      await page.goto('/mrs');
      await expect(page.locator('.mr-list-content')).toBeVisible();

      await page.keyboard.press('Control+f');
      await page.locator('.search-bar-input').fill('web-app');
      await expect(page.locator('.search-bar-count')).toHaveText('3 of 4');

      // Blur the input so the keypress isn't merely swallowed by useHotkey's
      // ignore-inputs default — this has to exercise the `enabled` guard itself.
      // The search bar has no blur handler, so the filter stays live.
      await page.locator('.search-bar-input').blur();
      await page.keyboard.press('Control+Alt+ArrowRight');

      await expect(page).toHaveURL(/\/mrs$/);

      // Closing the search must reveal the tab we started on, not one that an
      // invisible keypress moved us to while the strip was read-only.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tab', { name: /Needs review/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  });
```

Note on the seeded fixture: it has 4 MRs, none approved or snoozed, so Approved and Snoozed show a count of `0`. The tab buttons render regardless, so switching to an empty tab is valid and the assertions above hold.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bunx playwright test e2e/mr-list.spec.ts -g "Status tab shortcuts" --reporter=list
```

Expected: 3 failures. The forward/backward tests fail on the first `aria-selected` assertion (the keypress does nothing, so `Needs review` stays selected). The filtering test may *pass* already — that is expected and fine; it is a regression guard for Step 4.

- [ ] **Step 3a: Add the two config entries**

In `src/config/shortcuts.ts`, insert immediately after the `toggle-snoozed` entry (which ends at :178, before the `// Diff viewer shortcuts` comment):

```ts
  // The status tabs are a strip you step along, so they take arrow bindings
  // rather than a jump key per tab. Filed under `navigation` to sit with the
  // other tab-switching entries in Settings, not under `list`.
  {
    id: 'prev-tab',
    description: 'Previous status tab',
    defaultKey: 'Control+Alt+ArrowLeft',
    category: 'navigation',
    context: 'mr-list',
  },
  {
    id: 'next-tab',
    description: 'Next status tab',
    defaultKey: 'Control+Alt+ArrowRight',
    category: 'navigation',
    context: 'mr-list',
  },
```

- [ ] **Step 3b: Add the `stepTab` helper**

In `src/pages/MRListPage.tsx`, directly below the `parseTab` function (after :56):

```ts
/** Step `delta` places along the tab strip, wrapping at either end. */
function stepTab(current: MrTab, delta: number): MrTab {
  const index = STATUS_TABS.findIndex((tab) => tab.id === current);
  const count = STATUS_TABS.length;
  return STATUS_TABS[(index + delta + count) % count].id;
}
```

- [ ] **Step 3c: Delete the hardcoded Shift+H effect**

Remove this entire block from `src/pages/MRListPage.tsx` (:100-114) — the comment, the `useEffect`, its nested `handleKeyDown`, and the listener add/remove:

```ts
  // Shift+H jumps to the Approved tab (and back to Needs review).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (e.shiftKey && e.key === 'H') {
        e.preventDefault();
        setActiveTab(t => (t === 'approved' ? 'needs-review' : 'approved'));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTab]);
```

`useEffect` is still used elsewhere in the file (:156, :211), so leave the import alone.

- [ ] **Step 3d: Add the two hotkeys**

In `src/pages/MRListPage.tsx`, immediately after the existing `toggle-snoozed` `useHotkey` call (which ends at :209):

```ts
  // ⌃⌥←/→ walks the status tabs tmux-style, wrapping at both ends. Disabled
  // while filtering: the strip is a read-only match breakdown then, so stepping
  // would move `?tab=` with nothing on screen reading as active. Note the
  // absence of `ignoreInputs: false` — unlike its neighbours, this binding must
  // stay out of text fields, where ⌥← is macOS word-jump.
  useHotkey(parseHotkey(getKey('prev-tab') ?? 'Control+Alt+ArrowLeft'), () => {
    setActiveTab(t => stepTab(t, -1));
  }, { enabled: !filtering });
  useHotkey(parseHotkey(getKey('next-tab') ?? 'Control+Alt+ArrowRight'), () => {
    setActiveTab(t => stepTab(t, 1));
  }, { enabled: !filtering });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bunx playwright test e2e/mr-list.spec.ts -g "Status tab shortcuts" --reporter=list
```

Expected: 3 passed.

- [ ] **Step 5: Verify nothing else regressed**

```bash
bunx tsc --noEmit && bun run lint && bunx playwright test e2e/mr-list.spec.ts e2e/shortcut-editor.spec.ts e2e/mr-list-back-restore.spec.ts --reporter=list
```

Expected: clean typecheck, clean lint, all tests pass. `shortcut-editor.spec.ts` matters because Task 1 adds two rows to the Settings editor; it has no count assertions, so it should be unaffected — confirm that.

- [ ] **Step 6: Commit**

```bash
git add src/config/shortcuts.ts src/pages/MRListPage.tsx e2e/mr-list.spec.ts
git commit --no-verify -m "feat(mr-list): step status tabs with configurable ⌃⌥←/→"
```

`--no-verify` is deliberate: Step 5 already ran typecheck, lint and the affected specs, and the hook's full-suite run rewrites screenshot PNGs that are already dirty in this tree from unrelated work.

---

### Task 2: Footer hint

Separate from Task 1 because it is a standalone judgement call — the footer bar already carries four items, and this is rejectable on its own without touching the working shortcut.

**Files:**
- Modify: `src/pages/MRListPage.tsx:30-35` (the page-local `defaultShortcuts` array)
- Modify: `docs/superpowers/specs/2026-07-30-mr-list-tab-shortcuts-design.md` (§6 glyph string)
- Test: `e2e/mr-list.spec.ts`

**Interfaces:**
- Consumes: `ShortcutDef { key: string; label: string }` from `../components/ShortcutBar`.
- Produces: nothing consumed downstream.

**Glyph string:** use `'⌃⌥←/→'`, **not** `'⌃⌥←→'`. The spec's §6 wrote the latter, but the page's own `searchShortcuts` array already uses the `'↑/↓'` slash convention for a key pair, and `renderKeyGlyphs` wraps every glyph char in an `aria-hidden` span — so an unseparated run of four glyphs reads as one key. Step 3 corrects the spec to match.

- [ ] **Step 1: Write the failing test**

Add inside the `Status tab shortcuts` describe block created in Task 1:

```ts
    test('the footer advertises the tab shortcut', async ({ page }) => {
      await page.goto('/mrs');

      const bar = page.locator('.shortcut-bar');
      await expect(bar).toContainText('tabs');
      await expect(bar.locator('kbd[aria-label="⌃⌥←/→"]')).toBeVisible();
    });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bunx playwright test e2e/mr-list.spec.ts -g "footer advertises" --reporter=list
```

Expected: FAIL — `toContainText('tabs')` times out, since the footer has no such item yet.

- [ ] **Step 3: Add the footer item and fix the spec**

In `src/pages/MRListPage.tsx`, change the page-local `defaultShortcuts` array (:30-35) to insert the new entry after `open`:

```ts
const defaultShortcuts: ShortcutDef[] = [
  { key: 'j/k', label: 'navigate' },
  { key: 'Enter', label: 'open' },
  { key: '⌃⌥←/→', label: 'tabs' },
  { key: '⌘F', label: 'search' },
  { key: '?', label: 'help' },
];
```

Then in `docs/superpowers/specs/2026-07-30-mr-list-tab-shortcuts-design.md`, under `### 6. Discoverability`, change the code block from `{ key: '⌃⌥←→', label: 'tabs' }` to:

```ts
{ key: '⌃⌥←/→', label: 'tabs' }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
bunx playwright test e2e/mr-list.spec.ts --reporter=list
```

Expected: all pass. The whole file runs here, not just the new test, because two existing tests assert on `.shortcut-bar` contents (`shows keyboard hints in footer` at :48 and `keyboard hints update when search is open` at :150) and must still pass with a fifth item present.

- [ ] **Step 5: Check the footer still fits**

```bash
bunx playwright test e2e/page-header-heights.spec.ts --reporter=list
```

Expected: pass. Then look at the bar at a narrow width — if the five items wrap or overflow, report it rather than silently shipping a broken footer:

```bash
bunx playwright test e2e/screenshots.spec.ts --reporter=list
```

This regenerates `e2e/screenshots/mr-list.png`; open it and confirm the footer reads cleanly on one line.

- [ ] **Step 6: Commit**

```bash
git add src/pages/MRListPage.tsx e2e/mr-list.spec.ts docs/superpowers/specs/2026-07-30-mr-list-tab-shortcuts-design.md
git commit --no-verify -m "feat(mr-list): advertise the tab shortcut in the footer bar"
```

Stage `e2e/screenshots/mr-list.png` **only** if Step 5 changed it in a way that reflects this feature; otherwise leave the screenshot churn out of the commit.

---

## Manual verification (after both tasks)

The e2e suite runs Chromium via CDP-synthesised key events, which bypasses macOS system shortcut handling. It therefore **cannot** prove the combo reaches the real app. Confirm by hand:

```bash
bun run tauri dev
```

On the MR list, press `⌃⌥→` and `⌃⌥←` and check the tabs step. `⌃←/→` alone is the macOS Mission Control "move between spaces" shortcut; adding Option should take the combo out of that namespace, but this is the one assumption in the design the automated tests can't check. If macOS does swallow it, report back rather than picking a replacement unilaterally — the binding is configurable, so the fallback is a defaults question, not a code question.

## Self-review notes

Spec coverage checked section by section: §1 config entries → Task 1 Step 3a; §2 canonical `Control` spelling → Global Constraints + Step 3a; §3 wrap-around → Step 3b; §4 both guards → Step 3d (`enabled: !filtering`, and the deliberate omission of `ignoreInputs: false`), tested in Task 1 Step 1 test 3; §5 `Shift+H` removal → Step 3c; §6 discoverability → Task 2; Testing section → Task 1 Step 1 plus the manual check above. The spec's §6 glyph string is the one place the plan knowingly deviates, and Task 2 Step 3 corrects the spec rather than leaving the two out of sync.
