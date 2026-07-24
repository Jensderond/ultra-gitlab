# Native Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle all nine Settings sections into native-feeling grouped
row cards (iOS Settings on mobile, macOS System Settings on desktop),
per `docs/superpowers/specs/2026-07-24-native-settings-ui-design.md`.

**Architecture:** Two shared primitives (`SettingsGroup`, `SettingsRow`)
render flat inset cards with divider-separated rows. Each section
component wraps its existing controls in these primitives — handlers,
queries, and save semantics are untouched. The old gradient
`.settings-section` wrapper is removed from the page orchestrator.

**Tech Stack:** React 19, TypeScript, plain CSS with theme tokens,
`@base-ui/react` Menu for instance row actions, Bun, Playwright e2e.

## Global Constraints

- No behavior changes: every control keeps its handler/query/save flow.
- Colors only via theme CSS variables — never hardcoded hex.
- No gradients, no glow/box-shadow accents on the new surfaces (standing
  design preference: quiet states).
- Preserve class names used by e2e specs: `.shortcuts-editor`,
  `.shortcut-key-display`, `.shortcut-input`, `.shortcut-reset-button`,
  `.reset-all-button`, `.loading`, `.error-message`, `.saving-indicator`,
  `.add-button`, `data-tour="settings-instances"`.
- Mobile (`max-width: 767px`): rows ≥44px min-height.
- Typecheck (`bunx tsc --noEmit`) and `bun run test:e2e` must pass at the
  end; each task runs the typecheck before committing.

---

### Task 1: SettingsGroup/SettingsRow primitives + base CSS

**Files:**
- Create: `src/pages/Settings/SettingsGroup.tsx`
- Modify: `src/pages/Settings.css` (append a `GROUPED ROWS` block)

**Interfaces:**
- Produces:
  - `SettingsGroup({ title?: string; footer?: ReactNode; children: ReactNode })`
  - `SettingsRow({ label?: ReactNode; description?: ReactNode; vertical?: boolean; htmlFor?: string; className?: string; children?: ReactNode })`
  - CSS classes: `.settings-group-wrap`, `.settings-group`,
    `.settings-group-footer`, `.settings-row`, `.settings-row--vertical`,
    `.settings-row-text`, `.settings-row-label`, `.settings-row-desc`,
    `.settings-row-control`

- [ ] **Step 1: Create the component**

```tsx
// src/pages/Settings/SettingsGroup.tsx
import type { ReactNode } from 'react';

interface SettingsGroupProps {
  /** Uppercase eyebrow rendered above the card. */
  title?: string;
  /** Muted footnote rendered below the card (hints, saving state). */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Native-style settings group: a flat inset card whose children are
 * SettingsRow items separated by hairline dividers.
 */
export function SettingsGroup({ title, footer, children }: SettingsGroupProps) {
  return (
    <section className="settings-group-wrap">
      {title && <span className="settings-group-eyebrow">{title}</span>}
      <div className="settings-group">{children}</div>
      {footer && <div className="settings-group-footer">{footer}</div>}
    </section>
  );
}

interface SettingsRowProps {
  label?: ReactNode;
  description?: ReactNode;
  /** Stack the control full-width under the label (wide content). */
  vertical?: boolean;
  /** Associate the label with a form control. */
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
}

/** One setting: label + description left, control right (or below). */
export function SettingsRow({
  label,
  description,
  vertical = false,
  htmlFor,
  className,
  children,
}: SettingsRowProps) {
  const LabelTag = htmlFor ? 'label' : 'span';
  return (
    <div className={`settings-row${vertical ? ' settings-row--vertical' : ''}${className ? ` ${className}` : ''}`}>
      {(label || description) && (
        <div className="settings-row-text">
          {label && (
            <LabelTag className="settings-row-label" htmlFor={htmlFor}>
              {label}
            </LabelTag>
          )}
          {description && <span className="settings-row-desc">{description}</span>}
        </div>
      )}
      {children && <div className="settings-row-control">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Append CSS** (theme tokens only; dividers inset 16px;
  44px rows on mobile; no gradients)

```css
/* ================================================
   GROUPED ROWS (native-style settings cards)
   ================================================ */

.settings-group-wrap {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-bottom: 22px;
}

.settings-group {
  background: var(--overlay-glass-light);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
}

.settings-group-footer {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
  padding: 0 16px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 16px;
  min-height: 44px;
  box-sizing: border-box;
}

.settings-row + .settings-row {
  border-top: 1px solid var(--overlay-divider);
}

.settings-row--vertical {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding-top: 13px;
  padding-bottom: 14px;
}

.settings-row-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.settings-row-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.settings-row-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.settings-row-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.settings-row--vertical .settings-row-control {
  flex-shrink: 1;
  align-items: stretch;
  flex-direction: column;
}

@media (max-width: 767px) {
  .settings-row {
    padding: 13px 16px;
    min-height: 48px;
  }
}
```

- [ ] **Step 3: Typecheck** — `bunx tsc --noEmit` → no errors
- [ ] **Step 4: Commit** — `feat(settings): add SettingsGroup/SettingsRow primitives`

### Task 2: Flatten page chrome

**Files:**
- Modify: `src/pages/Settings/index.tsx` (mobile drill-in ~line 290,
  desktop detail ~line 338: remove `<section className="settings-section">`
  wrappers, render `SectionContent` bare)
- Modify: `src/pages/Settings.css`:
  - `.settings-section` → delete gradient card styling (keep the class
    as a plain block only if still referenced; otherwise delete rule)
  - `.settings-detail-header` / `.settings-detail-description` /
    `.settings-detail` inner column max-width 960px → 640px
  - `.settings-mobile-card` → flat: `background: var(--overlay-glass-light)`,
    radius 12px (drop the gradient)
  - `.settings-content` on mobile drill-in pages: max-width 640px column

**Interfaces:**
- Consumes: nothing new. Sections still render fine inside the bare pane
  (they'll be converted task by task; interim look is flat-unboxed, acceptable).

- [ ] Remove both `settings-section` wrappers in `index.tsx`
- [ ] Update CSS per above; verify no other file uses `.settings-section`
  (grep first; `CliSection`/`UpdatesSection` already stopped using it)
- [ ] `bunx tsc --noEmit` → clean; quick visual check
- [ ] Commit — `feat(settings): flatten detail pane, drop gradient panel`

### Task 3: Simple sections — Sync, File Navigation, Generated Files, CLI, Updates

**Files:**
- Modify: `src/pages/Settings/SyncSettingsSection.tsx`
- Modify: `src/pages/Settings/NavigationSection.tsx`
- Modify: `src/pages/Settings/CollapsePatternsEditor.tsx`
- Modify: `src/pages/Settings/CliSection.tsx`
- Modify: `src/pages/Settings/UpdatesSection.tsx`
- Modify: `src/pages/Settings.css` (retire `.setting-row` select column
  styling in favor of row-scoped select styling; keep `select` visuals)

**Conversion shapes:**

Sync (same shape for NavigationSection with its single select):
```tsx
<SettingsGroup
  footer={saving ? <span className="saving-indicator">Saving…</span> : undefined}
>
  <SettingsRow label="Sync interval" htmlFor="sync-interval">
    <select id="sync-interval" …existing props… />
  </SettingsRow>
  <SettingsRow label="Issue sync interval" htmlFor="issue-sync-interval">
    <select id="issue-sync-interval" …existing props… />
  </SettingsRow>
</SettingsGroup>
```

Generated Files: description → `SettingsGroup footer`; each pattern row →
`SettingsRow vertical={false}` with the input filling the left side
(`className="settings-row--input"`, input flex:1) and remove button right;
"+ Add pattern" is a full-width row button (`.settings-row-action`).

CLI: intro text → group footer; status (`update-version-row` content) →
one row; install button → `SettingsRow` with button right.

Updates: version → row (label "Version", value + Check button right);
release notes → vertical row with the existing `pre`; install button,
progress, error → rows.

- [ ] Convert each file, keeping every handler and status class name
- [ ] `bunx tsc --noEmit` → clean
- [ ] Commit — `feat(settings): grouped rows for sync, navigation, patterns, CLI, updates`

### Task 4: Notifications (switches) + Appearance

**Files:**
- Modify: `src/pages/Settings/NotificationsSection.tsx`
- Modify: `src/pages/Settings/AppearanceSection.tsx`
- Modify: `src/pages/Settings.css` (permission banner flat restyle)

**Notifications:** each `label.checkbox-label` becomes
```tsx
<SettingsRow label="MR ready to merge" description="…existing description…">
  <button
    className={`companion-toggle ${settings.mrReadyToMerge ? 'active' : ''}`}
    role="switch" aria-checked={settings.mrReadyToMerge}
    onClick={…existing toggle handler…}
  >
    <span className="companion-toggle-knob" />
  </button>
</SettingsRow>
```
Permission banner stays above the group, restyled flat (border +
`--warning-light` background, no gradient). "Test Notification" becomes a
row with the button on the right.

**Appearance:** three groups —
- *Theme*: vertical row containing the existing `.theme-swatches` and the
  custom-theme editor/controls.
- *Fonts*: three vertical rows, one per `FontCombobox` (label moves to the
  row; drop `.font-selector` wrapper markup, keep combobox classes).
- *Behavior*: condensed switch row (keep `condensedRowRef` + pulse class on
  the row) and product-tour row ("Replay" button right).

- [ ] Convert both files; `bunx tsc --noEmit` → clean
- [ ] Run `bunx playwright test e2e/product-tour.spec.ts` → PASS
- [ ] Commit — `feat(settings): switch rows for notifications, grouped appearance`

### Task 5: Shortcut editor

**Files:**
- Modify: `src/pages/Settings/ShortcutEditor.tsx`
- Modify: `src/pages/Settings.css` (`.shortcut-editor-item` restyle to row
  metrics; keep the class name for specs)

Each category (`div.shortcut-category-section`) becomes a
`SettingsGroup title={category}`; each `div.shortcut-editor-item` keeps its
class but adopts row layout inside the group (CSS: remove its own
background/radius, add divider via `+` selector). `kbd.shortcut-key-display`,
edit controls, reset button unchanged. "Reset All" + hint → pane-level
(hint as final group footer).

- [ ] Convert; `bunx tsc --noEmit` → clean
- [ ] Run `bunx playwright test e2e/shortcut-editor.spec.ts` → PASS
- [ ] Commit — `feat(settings): grouped shortcut editor`

### Task 6: Instances — native rows + InstanceSetup restyle

**Files:**
- Create: `src/pages/Settings/InstanceItem.tsx`
- Delete: `src/pages/Settings/InstanceItem.variant-terminal.tsx`,
  `src/pages/Settings/InstanceItem.variant-terminal.css`
- Modify: `src/pages/Settings/InstancesSection.tsx`
- Modify: `src/components/InstanceSetup/InstanceSetup.css` (flat inputs,
  quiet buttons; keep all class names/structure)
- Modify: `src/pages/Settings.css` (instance row styles, replacing the old
  `.instance-*` block)

**Interfaces:**
- Consumes: `InstanceItemProps { inst, tokenInfo, onDelete, onSetDefault,
  onTokenUpdated }` — same props as the terminal variant (see
  `InstancesSection.tsx:104-111`).

**InstanceItem row:** name + `DEFAULT` badge, description line = URL ·
token status (warn/error pills preserved as text tints); right side:
`Set default` text button (non-default only) + Base UI `Menu` (`⋯`) with
Edit token / Set or update cookie / Refresh avatars / Delete (destructive
tint). Token/cookie editing renders an expanded vertical area under the
row reusing the existing edit-token form classes. Port handler logic
(save token, save cookie, refresh avatars, rename) from the terminal
variant verbatim — only presentation changes. Rename: pencil-on-hover next
to the name, same input flow.

**InstancesSection:** wrap list in `SettingsGroup`; each `InstanceItem` is
a row; "+ Add Instance" becomes the last row (full-width action,
keeps `.add-button` class for specs); `InstanceSetup` renders in a
vertical row when open. Keep `data-tour="settings-instances"`.

- [ ] Build `InstanceItem.tsx`, port logic, delete terminal variant files
- [ ] Update `InstancesSection.tsx` + CSS; restyle `InstanceSetup.css`
- [ ] `bunx tsc --noEmit` → clean
- [ ] Commit — `feat(settings): native instance rows, retire terminal cards`

### Task 7: Full verification

- [ ] `bunx tsc --noEmit` → clean
- [ ] `bun run test:e2e` → all pass (screenshot specs will refresh
  settings screenshots — expected diff)
- [ ] Visual check via Vite + Playwright browser at 390×844 and 1280×800:
  root list, Instances, Appearance, Shortcuts, Notifications
- [ ] Commit any screenshot refreshes — `test: refresh settings screenshots`
