# Unified Page Header — Design

**Date:** 2026-07-24
**Status:** Approved (scope, target heights, and Settings desktop title behavior confirmed by Jens)

## Problem

Measured header heights across the app are all slightly different, despite
several of them sharing the same component:

| Screen | Measured height |
| --- | --- |
| MR List (`MRListPage`) | 58px |
| My MRs (`MyMRsPage`) | 62px |
| Pipelines / Issues (identical) | 57px |
| Settings root (`settings-header`) | 41px |
| Settings drill-in (`settings-header--sub`) | 66px |

Root causes, found by inspection:

1. `MRListPage` / `MyMRsPage` / `PipelinesPage` / `IssuesPage` all render the
   shared `<PageHeader>` component (`src/components/PageHeader/`), whose CSS
   uses `align-items: baseline` with no explicit height. The rendered height
   falls out of whatever action buttons happen to be mounted (32px icon
   buttons vs. text-chip toggles vs. none), so it drifts a few px per page
   even though the component is identical.
2. Settings does not use `<PageHeader>` at all — it has a hand-duplicated
   `.settings-header` block in `Settings.css`, structurally near-identical to
   `.page-header` but forked, which is why it landed in its own range. Its
   `--sub` variant is taller because it also renders `BackButton`, which is
   40px square on mobile (`BackButton.css`): `40px + 26px padding = 66px`,
   exactly the measured value.
3. Desktop Settings additionally renders a *second*, separate header
   (`.settings-detail-header`, an in-content `h2` + description) inside the
   scrolling detail pane — a distinct piece of chrome that mobile's drill-in
   view doesn't have (mobile shows the section title in the top bar and the
   description as a plain paragraph in the content).

## Goal

One shared header component and CSS source, producing exactly two heights
used everywhere: **60px on desktop, 56px on mobile** (`≤767px`), across MR
List, My MRs, Pipelines, Issues, and all three Settings views (mobile
category list, mobile drill-in, desktop rail+detail). No more per-page
height drift, and no second in-content header competing with it.

## Approach

### `PageHeader` component (`src/components/PageHeader/PageHeader.tsx`)

Add one optional prop:

```tsx
interface PageHeaderProps {
  title: string;
  leading?: ReactNode; // NEW — e.g. a BackButton, rendered before the title
  refreshing?: boolean;
  actions?: ReactNode;
}
```

`leading` renders inside `.page-header-title-group`, before the `<h1>`.
Everything else (title, actions, refreshing/sync bar) is unchanged.

### `PageHeader.css`

- `.page-header`: `align-items: baseline` → `center`; add
  `box-sizing: border-box`; set `height: 60px`; `padding: 0 32px` (vertical
  padding dropped — a fixed height plus center alignment does that job, so
  the row height is a hard constant instead of a side effect of whichever
  action buttons are mounted).
- `.page-header-title-group`: `gap: 4px` → `12px` (breathing room for
  `leading`; invisible on today's single-child pages).
- Mobile (`max-width: 767px`) block: `height: 56px`, `padding: 0 16px`,
  vertical padding values removed. 56px comfortably fits the 40px
  `BackButton` used by Settings' mobile drill-in (8px clearance top/bottom)
  without clipping.
- Remove the touch-device `padding-top: 6px` override
  (`@media (max-width: 767px) and (hover: none) …`) — it existed only to
  shave asymmetric top padding on touch devices; moot once padding is
  horizontal-only and content is vertically centered.

`BackButton` itself is untouched (stays 32px desktop / 40px mobile) — it's
used on other detail pages outside this task's scope, so the header is
sized around it rather than the button being shrunk to fit.

### MR List / My MRs / Pipelines / Issues

No changes. They already render `<PageHeader>`; they inherit the new fixed
height automatically and become pixel-identical to each other by
construction.

### `Settings/index.tsx`

All three render sites switch from raw `<header className="settings-header …">`
markup to `<PageHeader>`:

1. **Mobile category list** (no section picked):
   `<PageHeader title="Settings" />`
2. **Desktop rail + detail** (a section is always active — `sections[0]` is
   auto-selected):
   `<PageHeader title={activeDef?.label ?? 'Settings'} />` — the top bar now
   shows the active section's name (e.g. "GitLab Instances") instead of a
   static "Settings" label, mirroring mobile's drill-in behavior. The
   `?? 'Settings'` fallback only matters if `sections` were ever empty.
3. **Mobile drill-in**:
   `<PageHeader title={activeDef.label} leading={<BackButton to="/settings" title="Back to Settings" />} />`

In both #2 and #3, the description that used to live in `.settings-detail-header`
(desktop) moves to a plain paragraph at the top of the scrolling content pane,
reusing the class already used by mobile drill-in today:

```tsx
<p className="settings-detail-description">{activeDef.description}</p>
```

placed inside `.settings-detail` (desktop) the same way it's already placed
inside `.settings-content` (mobile drill-in). The standalone
`.settings-detail-header` wrapper (`<header><h2>…</h2><p>…</p></header>`) is
deleted from desktop's render.

### `Settings.css` cleanup

- Delete `.settings-header` entirely: base rule, `::after` divider, `h1`,
  `h1::before`, and both `max-width: 767px` media blocks. Confirmed
  `--root`/`--sub` modifier classes carry no CSS of their own today — grepped
  the codebase, only the four render sites in `Settings/index.tsx` (all being
  replaced) reference these class names, no tests depend on them.
- Delete `.settings-detail-header` and `.settings-detail-header h2`.
- The combined selector `.settings-detail-header p, .settings-detail-description`
  loses its now-dead first selector, leaving just `.settings-detail-description`.

### Resulting heights

| Screen | Height |
| --- | --- |
| MR List, My MRs, Pipelines, Issues (desktop) | 60px |
| MR List, My MRs, Pipelines, Issues (mobile) | 56px |
| Settings — mobile category list | 56px |
| Settings — mobile drill-in (with back button) | 56px |
| Settings — desktop rail+detail | 60px |

One component (`PageHeader`), one CSS source, two height values total.

## Out of scope

- `BackButton`'s own size (used elsewhere, e.g. MR/Pipeline detail headers).
- Any other in-content headers not part of the top-level page chrome.
- Settings persistence, commands, routes, or section content — this is a
  header/layout-only change.

## Testing

- `bunx tsc --noEmit` clean.
- Visual check in browser/simulator at both a desktop width and a mobile
  (`≤767px`) width: MR List, My MRs, Pipelines, Issues, and all three
  Settings views, confirming equal header heights and no clipped
  `BackButton` or action buttons.
- Confirm the `page-header-refreshing` spinner and `page-header-sync-bar`
  still render correctly centered/positioned at the new fixed height.
