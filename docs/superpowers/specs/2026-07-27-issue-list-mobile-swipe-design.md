# Issue list mobile layout + swipe-to-favorite — Design

Date: 2026-07-27
Status: Approved

## Problem

On mobile, `IssueListItem` wastes horizontal space: a leading 28px star
button + 12px flex gap inside 32px side padding puts ~72px of chrome before
the content. Vertical padding (14px) is also too generous on mobile and
slightly too generous on desktop. Starring should instead be a swipe gesture
on touch devices.

## Decisions (from brainstorming)

- **Mobile star**: remove the star button column on touch devices; starred
  issues show a small filled star inline in the header row next to `#iid`.
  Swiping left toggles starred on/off.
- **Swipe style**: iOS-Mail style — dragging left reveals a star action
  behind the row; releasing past a threshold (~72px) toggles favorite and
  the row snaps back. Nothing stays open, no tap needed.
- **Gating**: touch capability (`@media (hover: none)` for CSS, touch events
  for JS), same convention as MRListItem's snooze button — not `isIOS`.
- **Padding scope**: both IssueListItem and MRListItem, so the lists keep
  one rhythm.

## Design

### 1. Layout & padding (CSS only)

- Desktop, both lists: `padding: 14px 32px` → `12px 32px`.
- Touch (`@media (hover: none)`), both lists: `padding: 10px 16px`; the
  `::after` divider inset drops from 32px to 16px to match.
- Touch, issue list: `.issue-star-button { display: none; }`.
- Inline starred indicator: rendered in the header row when
  `issue.starred`; hidden on hover-capable devices via CSS so desktop keeps
  only the button and mobile keeps only the inline star.

### 2. `useSwipeAction` hook — `src/hooks/useSwipeAction.ts`

Mirrors `usePullToRefresh` conventions: raw touch listeners, ref-callback
with React 19 cleanup return, mutable gesture state in a ref (not React
state) for synchronous reads in handlers.

- **API**: `useSwipeAction<T>({ onTrigger, disabled? })` →
  `{ containerRef, offset, pastThreshold }`.
- **Intent lock**: arms only when horizontal movement dominates
  (`|dx| > |dy|` and `dx < -8`); once armed, `touchmove` calls
  `preventDefault()`. Never fights vertical scrolling.
- **Behavior**: row translates left with the finger, rubber-band damping
  capped near 96px. Release past ~72px → `onTrigger()`, row animates back.
  Below threshold → snap back, no action.
- **No JS platform gate**: touch events don't fire on desktop; the hook
  stays generic for future reuse (e.g. MR snooze swipe).

### 3. Component wiring — `IssueListItem.tsx`

A relative wrapper (receives the forwarded ref) contains:

1. an absolutely-positioned action layer on the right showing a star icon —
   revealed as the row translates; switches to the filled/active color when
   `pastThreshold`, so the commit point is visible before release;
2. the existing row content, translated by `offset`.

Swipe trigger calls the existing `onToggleStar` prop. No service, type, or
backend changes.

## Rejected alternatives

- Gesture library (react-swipeable / framer-motion): new dependency for one
  gesture; codebase already hand-rolls touch in `usePullToRefresh`.
- Inline gesture code in the component: not reusable; MR list will
  plausibly want swipe actions next.
- Persistent revealed button (swipe-then-tap): extra open/close state and
  edge cases for little benefit.

## Verification

- `bunx tsc --noEmit`
- Extend the Playwright mobile spec: star button hidden on touch/mobile
  viewport, inline star visible for a starred issue, reduced padding.
- Manual swipe check in the iOS simulator.
