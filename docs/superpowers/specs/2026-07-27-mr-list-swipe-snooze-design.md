# MR list: condensed touch padding + swipe-to-snooze — Design

Date: 2026-07-27
Status: Approved
Follow-up to: 2026-07-27-issue-list-mobile-swipe-design.md

## Problem

Two gaps after the issue-list mobile work:

1. On touch devices, condensed MR rows keep `8px 24px` padding while regular
   rows tightened to `10px 16px` — the side edges don't line up.
2. Snoozing an MR on touch still requires the 44px clock button; the issue
   list's swipe gesture should cover snooze the same way, winning that space
   back.

## Decisions (from brainstorming)

- **Condensed touch padding**: `8px 16px` — condensed keeps its tighter
  vertical rhythm, side padding/divider insets align to 16px.
- **Swipe release action**: unsnoozed row opens the existing `SnoozeMenu`
  preset sheet (already a bottom sheet on touch); an already-snoozed row
  unsnoozes immediately, no menu.
- **Snooze button on touch**: hidden — swipe is the affordance, matching the
  issue-star pattern. Snoozed state stays visible (existing badge in the
  full layout; new touch-only inline clock in the condensed row).

## Design

### 1. Condensed padding on touch (CSS)

In `MRListItem.css`'s `@media (hover: none)` block, add:

- `.mr-list-item--condensed { padding: 8px 16px; }`
- `.mr-list-item--condensed::after { left: 16px; right: 16px; }`

The existing `:not(--condensed)` rules stay as they are.

### 2. Shared `SwipeActionRow` component

The swipe wrapper (clipping wrapper, action layer, opaque-row swipe/settle
classes, click guard, forwarded ref) is now needed identically by two list
rows. Extract `src/components/SwipeActionRow/SwipeActionRow.tsx` + `.css`:

- Props: `{ icon, armedIcon?, onTrigger, disabled?, children, className?,
  rowClassName?, rowProps }` — exact shape settled in the plan; it wraps
  `useSwipeAction` and renders
  `<div .swipe-row> <div .swipe-row-action/> <div .swipe-row-item …>children</div> </div>`
  with generic class names.
- `IssueListItem` migrates to it; the `.issue-swipe*` rules and
  `is-swiping`/`is-settling` row rules move into the shared CSS
  (generalized). Issue-specific bits (star icons, thresholds via the hook)
  are unchanged.
- The `:last-child` divider rework pattern (wrapper is now the `:last-child`)
  lands in `MRListItem.css` the same way it did in `IssueListItem.css`.

### 3. Swipe-left on MR rows (both layouts)

- Unsnoozed + snoozable → release past threshold calls
  `onSnoozeMenuOpenChange(true)`.
- Snoozed → release calls `onUnsnooze()` immediately.
- Approved-and-not-snoozed (`canSnooze` false) or missing handlers → the
  gesture is `disabled` (the hook resets cleanly on dynamic disable).
- Action layer icon: Clock (same glyph as the button), warning color when
  armed.
- **Fixed-position caveat**: the touch `SnoozeMenu` is a `position: fixed`
  bottom sheet; a mid-settle `transform` on the row would become its
  containing block. The menu therefore opens only after the row finishes
  settling (drive off the hook's `settling` state).

### 4. Snooze button on touch

- `@media (hover: none) { .mr-snooze-button { display: none; } }` replaces
  the current touch enlargement rule (opacity/44px sizing).
- `SnoozeMenu` rendering must not depend on the button's visibility — it
  stays mounted (menu is a sibling within the snooze control span; only the
  button hides).
- Condensed rows gain a touch-only inline clock indicator when snoozed
  (mirrors `.issue-star-inline`); the full layout already shows the
  "Snoozed until …" badge.

## Rejected alternatives

- Instant default-preset snooze on swipe: loses duration control, needs an
  undo affordance.
- Keeping the snooze button visible on touch alongside swipe: no space won,
  duplicated affordance.
- Duplicating the swipe wrapper markup/CSS in MRListItem instead of
  extracting `SwipeActionRow`: same abstraction in two places, third
  consumer plausible.

## Verification

- `bunx tsc --noEmit`; existing issue-list mobile spec stays green after the
  `SwipeActionRow` migration.
- New/extended e2e (touch viewport): swipe unsnoozed MR row → preset sheet
  opens → pick preset → row snoozed; swipe snoozed row → unsnoozed; approved
  row → swipe does nothing; condensed touch padding `8px 16px`; snooze
  button hidden on touch. Verify `snooze_mr`/`unsnooze_mr` (exact command
  names checked during planning) are mocked in the e2e fixtures; add
  handlers if missing.
- Manual iOS simulator check alongside the pending one for the issue list.
