# Auto-merge card redesign (MyMRDetailPage MergeSection)

**Date:** 2026-07-17
**Status:** Approved

## Problem

The auto-merge control in `src/pages/MyMRDetailPage/MergeSection.tsx` is visually
unpolished: a bare native checkbox with a yellowish label and a floating hint line
(off state), and a separate blue banner with a "Cancel auto-merge" button (on state).
The two states look unrelated and the layout jumps when toggling.

## Design

Replace both states with a single **auto-merge card** rendered below the merge
status/actions. The rest of the Merge section (heading, status pills, Merge /
Rebase / Mark ready buttons) is unchanged.

### Card

- Container: 1px `var(--border-color)` border, 8px radius, ~12px × 14px padding,
  `var(--bg-secondary)` background, 14px top margin.
- Header row: title **Auto-merge** (13px, weight 600, `--text-primary`) left;
  toggle switch right.
- Toggle switch: reuses the visual language of the Settings `companion-toggle`
  (44×24 pill, sliding knob, accent fill when on). Implemented as
  `<button role="switch" aria-checked>` for keyboard accessibility.
- Body (off): one 12px `--text-tertiary` line — "Rebases and merges automatically
  once GitLab reports the MR as mergeable."
- Body (on): pulsing accent dot + live status label from `autoMergeStatusLabel`
  (e.g. "Waiting for approval"); `lastError` shown below in `--error-color` when
  present. Card border/background tint accent (`--accent-color` / `--accent-bg`).

### Interaction

- The switch is the single control; flipping it off replaces the previous
  "Cancel auto-merge" button.
- All behavior (`useAutoMerge`, claim/unclaim, status labels, background sync)
  is untouched — presentational change only.

## Files

- `src/pages/MyMRDetailPage/MergeSection.tsx` — replace checkbox + active-panel
  JSX with the card.
- `src/pages/MyMRDetailPage.css` — replace `.my-mr-auto-merge-toggle` and
  `.my-mr-auto-merge-active` rules with card/switch rules.

## Testing

- `bunx tsc --noEmit`
- Visual verification in the running app against a real MR, both toggle states.
