# MR list: configurable prev/next status-tab shortcuts

**Date:** 2026-07-30
**Scope:** `MRListPage` status tabs (Needs review / Approved / Snoozed), `config/shortcuts.ts`

## Problem

The MR list's three status tabs can only be reached by clicking, or by two ad-hoc
jump shortcuts:

- `Shift+Z` (`toggle-snoozed`) — configurable, toggles between Snoozed and Needs review.
- `Shift+H` — **hardcoded** in a raw `window.addEventListener('keydown')` effect in
  `MRListPage.tsx`, toggles between Approved and Needs review. It is the last shortcut in
  the page that bypasses the `config/shortcuts.ts` → `getKey()` → `useHotkey()` pipeline,
  so it appears in neither Settings nor the `?` help overlay.

Neither is a *step* through the strip. The wanted interaction is the tmux one: hold
`Ctrl+Alt` and press left/right to walk the tabs — and, like every other binding in the
app, be able to rebind it in Settings.

## Non-goals

- **Other tabbed surfaces.** `MyMRDetailPage` (Overview / Comments / Code) keeps its
  `1`/`2`/`3` direct-jump bindings and gains nothing here. It is the only other tabbed
  surface in the app; with the MR list as the sole consumer, a shared `useTabHotkeys`
  abstraction would be premature. Revisit if MR detail ever joins.
- **`Shift+Z`.** Stays exactly as is. It is already configurable and is a jump-to-tab,
  not a step, so it does not overlap with the new bindings.
- No change to tab ordering, counts, the URL scheme (`?tab=`), or the replace-not-push
  history behaviour.

## Design

### 1. Two config entries

`src/config/shortcuts.ts` gains two entries, category `navigation`, context `mr-list` —
matching the existing `tab-overview` / `tab-comments` / `tab-code` precedent of filing
tab switching under Navigation:

```ts
{ id: 'prev-tab', description: 'Previous status tab',
  defaultKey: 'Control+Alt+ArrowLeft',  category: 'navigation', context: 'mr-list' },
{ id: 'next-tab', description: 'Next status tab',
  defaultKey: 'Control+Alt+ArrowRight', category: 'navigation', context: 'mr-list' },
```

Settings (`ShortcutEditor`) and the `?` overlay both read from this array, so both pick
the entries up with no further work.

### 2. Why arrow keys, and why `Control` spelled out

On macOS, Option rewrites `event.key` for printable characters — `Ctrl+Alt+K` arrives as
`˚`, which is what makes modifier+letter bindings unreliable there. Arrow keys are
unaffected: `event.key` stays `ArrowLeft` with any modifier combination. So `⌃⌥←/→`
matches reliably on the platform this app actually ships on.

`Control` (not `Ctrl`) is `@tanstack/hotkeys`' canonical modifier name. It matters that
the default string uses the canonical spelling because the Settings recorder emits
canonical strings too: `formatHotkeyFromEvent` only collapses to `Mod` when the platform's
Mod key is the one held, and on macOS that is Meta — so a recorded `Ctrl+Alt+←` serialises
to the literal `Control+Alt+ArrowLeft`. Default and recorded bindings are therefore the
same string, and a rebinding round-trips correctly.

### 3. Stepping with wrap-around

`STATUS_TABS` is already the ordering source of truth. Stepping is modular arithmetic over
its indices, so wrap is free and the helper needs no knowledge of individual tab ids:

```ts
function stepTab(current: MrTab, delta: number): MrTab {
  const i = STATUS_TABS.findIndex((t) => t.id === current);
  const n = STATUS_TABS.length;
  return STATUS_TABS[(i + delta + n) % n].id;
}
```

Right on Snoozed lands on Needs review; left on Needs review lands on Snoozed. No
keypress is ever a no-op.

The two hotkeys call the existing `setActiveTab` with an updater, which already routes
through `navigate(..., { replace: true })` — so the tab stays in the URL and survives an
iOS swipe-back history POP, unchanged from today.

### 4. Two guards

**Inert while filtering.** When a live search query spans all statuses, `filtering` is
true, the tab buttons are `disabled`, and the strip stops being a selector — it becomes a
read-only breakdown of where the matches are. Both hotkeys therefore take
`{ enabled: !filtering }`. Without this, `⌃⌥→` would silently change `?tab=` while no tab
renders as active, and the change would only become visible on clearing the search.

**Inert in text fields.** `useHotkey` ignores input and textarea targets by default. These
two calls deliberately do *not* pass `ignoreInputs: false` — unlike the neighbouring calls
in this file, which opt out to stay live in text fields. `⌥←` is macOS word-jump, so
staying out of the way inside the search box and comment editors is required, not
incidental.

### 5. Removing `Shift+H`

The `useEffect` at `MRListPage.tsx:101-114` — the raw `keydown` listener, its
input-target check, and the `Shift+H` branch — is deleted outright. The stepping shortcut
covers reaching the Approved tab. Nothing else in `src/` or `e2e/` references `Shift+H`;
the only other mention is `tasks/plan-centralize-shortcuts.md`, a completed planning doc
which is left alone as a historical record.

With this gone, every keyboard binding on the page flows through `getKey()` + `useHotkey()`.

### 6. Discoverability

The page's local `defaultShortcuts` array (the footer `ShortcutBar`, distinct from the
config module's export of the same name) gains a fifth item:

```ts
{ key: '⌃⌥←→', label: 'tabs' }
```

## Testing

E2E, in `e2e/mr-list.spec.ts` (the specs are Playwright against the dev server):

1. **Step and wrap.** From Needs review, `Control+Alt+ArrowRight` → Approved
   (`aria-selected` moves, URL becomes `?tab=approved`). Again → Snoozed. Again → back to
   Needs review with the URL cleared to `/mrs`.
2. **Reverse.** From Needs review, `Control+Alt+ArrowLeft` → Snoozed.
3. **Inert while filtering.** Type a query that matches across statuses, press
   `Control+Alt+ArrowRight`, assert the active tab and URL are unchanged.

Manual verification in the real Tauri window: confirm macOS delivers `⌃⌥←/→` to the
webview. `⌃←/→` alone is the Mission Control "move between spaces" shortcut; adding Option
should take the combo out of that namespace, but this is the one assumption in the design
that the browser-based e2e suite cannot check.
