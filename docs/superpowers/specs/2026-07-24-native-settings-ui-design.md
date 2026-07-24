# Native Settings UI — Design

**Date:** 2026-07-24
**Status:** Approved (scope + instance-card replacement confirmed by Jens)

## Problem

Every settings detail pane wraps its content in one large `.settings-section`
card: a gradient background, border, and 960px width. Inside, each section
lays out controls ad-hoc (stacked forms, boxed sub-panels, fake-terminal
instance cards). On mobile — where Settings is a bottom-nav tab on the iOS
build — this reads as "a panel with a background", not as a settings screen.

## Goal

Settings detail panes look native: iOS Settings on narrow screens, macOS
System Settings on desktop. Same component system for both, themed with the
existing theme tokens (no hardcoded colors). No behavior changes — every
control keeps its current handler, query, and save semantics.

## Approach

Grouped-rows restructure of all nine sections (chosen over a CSS-only reskin
and over a partial conversion).

### New primitives — `src/pages/Settings/SettingsGroup.tsx`

```tsx
<SettingsGroup title="Fonts" footer="Fonts apply immediately.">
  <SettingsRow label="Page title font" description="…">
    <FontCombobox … />
  </SettingsRow>
  <SettingsRow label="Theme" vertical>
    {/* wide content renders under the label */}
  </SettingsRow>
</SettingsGroup>
```

- **`SettingsGroup`** — `props: { title?, footer?, children }`. Renders an
  uppercase eyebrow (reuses `.settings-group-eyebrow` styling) above a flat
  inset card (`.settings-group`), and a muted footnote (`.settings-group-footer`)
  below it. Children are rows; hairline dividers between rows come from CSS
  (`.settings-row + .settings-row`), inset from the left edge like native
  settings lists.
- **`SettingsRow`** — `props: { label?, description?, vertical?, htmlFor?,
  children }`. Horizontal by default: label + optional description left,
  control right. `vertical` stacks the control full-width under the label
  (theme swatches, release notes, pattern list, expanded editors).

### Visual language (all from theme tokens)

- Card: flat `--overlay-surface`-family background, 1px `--border-color`,
  12px radius. **No gradients, no glow.** (Matches the standing preference:
  quiet states, no gradients/accent bars.)
- Row: 12px 16px padding desktop, 13px 16px and ≥44px min-height on
  `max-width: 767px`. Divider: 1px `--overlay-divider`, `margin-left: 16px`.
- Detail column max-width drops 960px → 640px, centered.
- Page background stays `--bg-primary`; the old `.settings-section`
  gradient wrapper is deleted from `index.tsx` (desktop and mobile drill-in
  render `SectionContent` bare) and from `Settings.css`.
- The mobile root category list already uses a card/row pattern
  (`.settings-mobile-card`); it is restyled onto the same flat card tokens
  so root and detail screens match.

### Per-section conversion

| Section | Conversion |
| --- | --- |
| **Sync** | One group; "Sync interval" and "Issue sync interval" become select rows. Saving/error states render as group footer text. |
| **File Navigation** | One group with the jump-distance select row; hint text becomes the group footer. |
| **Generated Files** | Description becomes group footer; each pattern is a row holding its input + remove button; "+ Add pattern" is the last row (full-width tappable). |
| **Notifications** | Permission banner kept above the group (restyled flat). The three checkboxes become **switch rows** using the existing `.companion-toggle`; description moves under the label. "Test notification" is a button row. |
| **Appearance** | Three groups: *Theme* (swatches as a vertical row + custom-theme editor row), *Fonts* (three combobox rows — combobox stays full-width via vertical rows since it has a preview line), *Behavior* (condensed-list switch row, product-tour button row). Condensed highlight pulse is kept on the row. |
| **Shortcuts** | One `SettingsGroup` per shortcut category (title = category); each shortcut is a row with the `kbd` + reset control on the right. "Reset All" stays in the pane header area; recording/edit state unchanged. |
| **CLI** | Description as group footer; install-status row; install button row. |
| **Updates** | Version row (value text right + "Check for Updates"); release notes as a vertical row; install/progress/error rows. |
| **Instances** | Terminal cards (`InstanceItem.variant-terminal`) **replaced** by native rows: name + default badge, URL/token status as description, actions right (Set default / menu of Edit token, Set cookie, Refresh avatars, Delete). Token/cookie editing expands inline below the row (vertical). "+ Add Instance" becomes the last row of the group, opening the (restyled) `InstanceSetup` form. `InstanceSetup` form controls get the same flat input styling in its own group. |

### Files touched

- `src/pages/Settings/SettingsGroup.tsx` — new
- `src/pages/Settings/InstanceItem.tsx` — new (replaces
  `InstanceItem.variant-terminal.tsx` + its CSS, which are deleted)
- `src/pages/Settings/index.tsx` — drop `.settings-section` wrappers
- All nine section components — wrap content in groups/rows
- `src/pages/Settings.css` — new group/row block; delete gradient panel,
  terminal-card leftovers stay in their own deleted file
- `src/components/InstanceSetup/InstanceSetup.css` — flat inputs/buttons

### Error handling / states

- Loading (`p.loading`), saving (`p.saving-indicator`) and error
  (`.error-message`) elements keep their class names and semantics; they
  render as group footers or banner rows so specs keep passing.
- `data-tour="settings-instances"` and the condensed-highlight
  scroll/pulse behavior are preserved.

### Testing

- `bunx tsc --noEmit` clean.
- Existing e2e: `shortcut-editor.spec.ts` (uses `.shortcuts-editor`,
  `.shortcut-key-display`, …) and settings screenshots must pass; class
  names used by specs are kept.
- Visual verification in browser at 390px (iPhone width) and desktop.

## Out of scope

- No changes to settings persistence, commands, or routes.
- MR/issue/pipeline pages untouched.
