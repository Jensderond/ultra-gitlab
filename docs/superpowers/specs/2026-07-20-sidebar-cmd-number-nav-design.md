# Cmd-hold sidebar number hints

**Date:** 2026-07-20
**Status:** Approved (design)

## Problem

The sidebar (`AppSidebar.tsx`) has a fixed set of top-level nav destinations (Reviews,
My MRs, Pipelines, Issues — Settings sits separately at the bottom). Navigation between
them today is mouse-only, or via the user-configurable letter shortcuts in
`src/config/shortcuts.ts` (`Mod+L`/`Mod+M`/`Mod+P`/`Mod+I`).

We want a second, always-on way to jump between sidebar pages by position: hold Cmd
(or Ctrl on non-Mac) and each visible top nav icon shows its position as a number
(1, 2, 3, …); pressing that digit while the modifier is held navigates there
immediately. This must work regardless of whether the user has remapped the letter
shortcuts, and must not appear in the shortcut editor as a configurable binding.

## Conflict: `Cmd+1..9` already switches GitLab instances

`App.tsx` (lines ~181–199) has a non-configurable global handler: holding Cmd/Ctrl and
pressing 1–9 dispatches an `instance-switch` event that `InstanceSwitcher.tsx` listens
for, switching the active GitLab instance. The instance dropdown even displays the
binding inline as `⌘1`, `⌘2`, etc.

Decision: **instance switching moves to `Cmd+Shift+1..9`**, freeing `Cmd+1..9` for
sidebar navigation. This is the only viable option once we require "just Cmd + digit"
for the sidebar (any other split still collides for someone with 4+ instances).

## Design

### Sidebar nav hints (`AppSidebar.tsx`)

All new logic lives here, since it is mounted once outside the page `<Routes>` for the
whole app lifetime and already owns the nav-item list and its `isTauri`-based visibility
filtering (`navItems`, `topItems`).

1. **Modifier-held state.** Track a `cmdHeld` boolean via `window` `keydown`/`keyup`
   listeners on `Meta`/`Control`. Add a `blur` listener that forces `cmdHeld` false —
   OS-level focus steals (e.g. Cmd+Tab) can swallow the `keyup`, and without this the
   badges could get stuck visible.
2. **Ignore text input contexts.** If `e.target` is an `HTMLInputElement` or
   `HTMLTextAreaElement`, skip both the hold-tracking and the digit-navigation handler
   below — matches the existing convention in `App.tsx`'s instance-switch handler and
   `useKeyboardNav.ts`.
3. **Digit navigation.** A `keydown` handler: when the modifier is held (`e.metaKey ||
   e.ctrlKey`) and `e.key` is a digit from `1` to `topItems.length`, `preventDefault()`,
   `navigate()` to `topItems[digit - 1].path`, and call `trackShortcut` for analytics
   parity with the other global nav shortcuts in `App.tsx`. `bottomItems` (Settings) are
   never part of the numbering.
4. **Badge rendering.** When `cmdHeld` is true, render a small numbered badge on each
   `topItems` button, numbered by on-screen position (1-based, following visible-item
   order — the same order `isTauri` filtering already produces). Visually this reuses
   the existing corner-badge pattern already in this file (`approved-dot`, `update-dot`)
   — a small circle anchored to the icon — just swapped for a digit. Exact visual
   treatment (size, color, placement) is a follow-up design pass; this spec only commits
   to "a numbered badge appears on the icon."

No `ShortcutDefinition` entry is added for this — it is intentionally not listed in
`config/shortcuts.ts` or surfaced in the Settings shortcut editor, since it is fixed and
purely positional (renumbers itself if the visible item set changes, e.g. browser mode
hiding Settings/Pipelines).

### Instance switching move (`App.tsx`, `InstanceSwitcher.tsx`)

5. **`App.tsx`** `handleInstanceSwitch`: add an `e.shiftKey` requirement to the existing
   `(e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9'` condition. Update the
   `trackShortcut` call's key label from `` `Mod+${e.key}` `` to `` `Mod+Shift+${e.key}` ``.
6. **`InstanceSwitcher.tsx`**: update the rendered `kbd` hint from `⌘{index+1}` to
   `⇧⌘{index+1}`.

## Scope decisions (YAGNI)

- No new entries in `config/shortcuts.ts` / `KeyboardHelp` — this shortcut is fixed,
  not customizable, and self-explanatory via the on-screen badges while held. (It's
  reasonable to mention it in the keyboard help overlay's "Global" section as a static
  line later, but that's not required for this spec.)
- Numbering only ever covers `topItems`; Settings is never numbered.
- Cross-platform: reuse the existing `e.metaKey || e.ctrlKey` pattern already used for
  instance switching, rather than introducing a new "Mod key" abstraction just for this.
- No isTauri gate on the new hold/nav logic — matches the existing instance-switch
  handler, which is also ungated.

## Testing

- **E2e:** holding Cmd shows numbered badges only on visible top items (not Settings);
  releasing hides them; `Cmd+2` navigates to the second visible item; typing in a text
  input suppresses both the badges and the navigation.
- **E2e:** `Cmd+Shift+1` switches instance (not sidebar nav); plain `Cmd+1` navigates
  sidebar (not instance switch).
- **Manual:** verify numbering in both Tauri desktop mode (5 items incl. Settings,
  Settings unnumbered → badges 1-4) and browser mode (Settings + Pipelines hidden →
  badges renumber to 1-3).

## Files touched

- `src/components/AppSidebar/AppSidebar.tsx` — hold-tracking, digit navigation, badge
  rendering
- `src/components/AppSidebar/AppSidebar.css` — badge styling
- `src/App.tsx` — instance-switch handler gains `Shift` requirement
- `src/components/InstanceSwitcher/InstanceSwitcher.tsx` — updated kbd hint display
