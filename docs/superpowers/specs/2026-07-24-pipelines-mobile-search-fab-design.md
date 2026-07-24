# Pipelines Mobile Search: Floating Button + Full-Screen Overlay

## Problem

On mobile, `PipelinesPage` renders `ProjectSearch` as a persistent inline
search bar above the grid (`.pipelines-search-container`), the same as on
desktop. It permanently occupies vertical space on a screen where space is
scarce, for a "search to add a project" action that's used occasionally, not
continuously.

## Approach

Replace the persistent inline bar with a floating action button (FAB) in the
bottom-right corner on mobile only, which opens a full-screen search overlay.
Desktop is unaffected.

Scope: `src/pages/PipelinesPage/ProjectSearch.tsx` and
`src/pages/PipelinesPage.css`. Mobile is defined as viewport width < 768px,
matching the existing `useSmallScreen` hook (`src/hooks/useSmallScreen.ts`)
and the `max-width: 767px` breakpoint already used for every other
mobile-specific layout change in `PipelinesPage.css` (e.g. the card kebab
menu). This is a CSS/viewport-width distinction, not a runtime `isIOS` check
— consistent with how the rest of this page already draws the desktop/mobile
line.

### Why fork one component instead of splitting into two

`ProjectSearch` is a single 152-line component whose real complexity is the
search state (debounced query, results, loading, select handling) — that
logic is identical on desktop and mobile. Only the chrome around it differs.
Forking the returned JSX on `useSmallScreen()` inside the existing component
keeps the state and handlers in one place; splitting into a shared hook plus
two presentational components would be over-abstraction for a component this
size and with no other consumers.

### Component behavior

`ProjectSearch` gains one new piece of state: `overlayOpen` (mobile only).
All existing state (`searchQuery`, `searchResults`, `searchLoading`) and the
debounce effect are unchanged and shared between desktop and mobile render
paths.

- **Desktop** (`!isSmallScreen`): renders exactly as today — inline bar,
  `/`-to-focus shortcut, click-outside-to-close dropdown.
- **Mobile, closed** (`isSmallScreen && !overlayOpen`): renders only a
  circular FAB button (magnifying-glass icon) — no inline bar. Tapping it
  sets `overlayOpen = true`.
- **Mobile, open** (`isSmallScreen && overlayOpen`): renders a full-screen
  overlay: a header row with a close (✕) button and the search input
  (auto-focused so the keyboard opens immediately), and the results list
  filling the remaining screen height below it.
  - Selecting a result calls the existing `handleSelectResult` (adds the
    project, clears the query) and additionally sets `overlayOpen = false`.
  - The ✕ button and the `Escape` key both clear the query/results and set
    `overlayOpen = false`, mirroring the existing desktop close behavior.

No changes to `usePipelinesData`, `PipelinesPage/index.tsx`, or the
`searchProjects` service call — this is presentation-only.

## Styling

Added to the existing `@media (max-width: 767px)` block in
`PipelinesPage.css`:

- `.pipelines-page` gets `position: relative` (mobile only) so the FAB can be
  positioned against it with `position: absolute`.
- `.pipelines-search-fab`: ~56px circle, `bg-secondary` + `border-color`
  (matching existing card/button surface conventions), drop shadow,
  centered icon, `position: absolute; bottom: 16px; right: 16px;`. No extra
  safe-area math is needed — `.app-content` already reserves
  `--mobile-tabbar-height` below itself (see `App.css`), so the FAB floats
  clear of the bottom tab bar for free.
- `.pipelines-search-overlay`: `position: fixed; inset: 0; z-index: 1000`
  (same z-index convention as `CommandPalette`), `background: var(--bg-primary)`,
  flex column, `padding-top: env(safe-area-inset-top, 0)`.
- `.pipelines-search-overlay-header`: flex row, close button + input,
  reusing `.pipelines-search-input-wrapper` styling for the input itself.
- Results list reuses the existing `.pipelines-search-result` /
  `.pipelines-search-empty` row styles, just full-bleed instead of in a
  bounded dropdown.

## Caveats

- The inline bar's `/`-to-focus keyboard shortcut has no equivalent on
  mobile (no hardware keyboard in the common case); it simply doesn't apply
  since the inline bar isn't rendered there. No code path needs to guard
  against it — the shortcut effect only does anything when the (unrendered)
  input ref is attached.
- Removing the persistent bar means the mobile grid content now starts
  immediately below the header, with no reserved search-bar row — this is
  the intended space reclaim, not a layout gap to fix.

## Testing

Manual verification on the iOS Simulator and a narrow desktop browser
window (< 768px):
1. Confirm the inline search bar is gone on mobile and a floating button
   appears bottom-right, clear of the bottom tab bar.
2. Tap the button → full-screen overlay opens with the keyboard focused.
3. Type a query → results appear; tap a result → project is added and the
   overlay closes.
4. Tap ✕ → overlay closes, query clears.
5. Resize back to desktop width (or check the desktop browser) → original
   inline bar behavior (`/` shortcut, dropdown, click-outside-to-close) is
   unchanged.
