# PRD: Monaco Diff Viewer Collapse/Expand Unchanged Lines

## Introduction

The Monaco diff viewer currently loads and displays entire files to ensure proper syntax highlighting. However, reviewers typically only care about the lines that changed. This feature collapses unchanged lines into fold zones — showing only 5 lines of context around each change — while letting users expand sections incrementally (+20 lines) or fully to get more context when needed. This mirrors the experience of reviewing diffs on GitHub/GitLab but with full Monaco syntax highlighting.

## Goals

- Collapse unchanged lines by default so reviewers focus on what changed
- Show 5 lines of context above and below each changed region
- Allow incremental expansion (+20 lines) and full expansion of collapsed sections
- Integrate with Monaco's native fold/decoration system for a seamless look
- Preserve full syntax highlighting (the entire file is still loaded, just visually collapsed)
- Persist expand/collapse state per file during a review session

## User Stories

### US-001: Compute Collapse Regions from Diff Changes
**Description:** As a developer, I need to calculate which line ranges should be collapsed based on the diff's changed regions so the viewer knows what to hide.

**Acceptance Criteria:**
- [ ] After Monaco diff editor mounts and computes line changes, extract changed line ranges from `editor.getLineChanges()`
- [ ] Calculate visible regions: each changed range plus 5 lines of context above and below
- [ ] Merge overlapping/adjacent visible regions (e.g., two changes 8 lines apart share context)
- [ ] Everything outside visible regions becomes a collapse region
- [ ] Handle edge cases: changes at line 1 (no context above), changes at last line (no context below)
- [ ] Handle files with no changes (show fully collapsed with option to expand)
- [ ] Typecheck passes

### US-002: Apply Hidden Regions via Monaco Fold API
**Description:** As a reviewer, I want unchanged lines to be automatically collapsed when I open a diff so I can focus on what changed.

**Acceptance Criteria:**
- [ ] On diff editor mount, apply computed collapse regions as hidden/folded ranges on both original and modified editors
- [ ] Folded regions display as a styled fold zone (Monaco native fold decoration) showing the number of hidden lines
- [ ] The fold zone is visually distinct — styled to match the Kanagawa theme
- [ ] Collapsed regions do not break line number alignment between original and modified sides
- [ ] Syntax highlighting remains correct on all visible lines (the full file content is preserved underneath)
- [ ] Folding applies in split view mode (unified view handled in US-007)
- [ ] Typecheck passes

### US-003: Expand 20 Lines Above or Below a Collapsed Region
**Description:** As a reviewer, I want to incrementally reveal more context around a change so I can understand the surrounding code without seeing the entire file.

**Acceptance Criteria:**
- [ ] Each collapsed fold zone has an "expand up" control (reveal 20 lines above)
- [ ] Each collapsed fold zone has an "expand down" control (reveal 20 lines below)
- [ ] Clicking expand reveals exactly 20 more lines (or remaining lines if fewer than 20 are hidden)
- [ ] After expanding, the fold zone updates its "N lines hidden" count
- [ ] If all lines in a collapsed region are revealed, the fold zone disappears
- [ ] Expansion applies symmetrically to both original and modified editors
- [ ] Scroll position remains stable during expansion (the viewport doesn't jump)
- [ ] Typecheck passes

### US-004: Expand Entire Collapsed Region
**Description:** As a reviewer, I want a way to reveal all hidden lines in a section at once when I need to see the full context.

**Acceptance Criteria:**
- [ ] Each collapsed fold zone has a "show all" control to fully expand that region
- [ ] Clicking "show all" reveals every hidden line in that specific collapsed section
- [ ] The fold zone is removed after full expansion
- [ ] Both original and modified editors expand in sync
- [ ] Scroll position remains stable during expansion
- [ ] Typecheck passes

### US-005: Collapse All / Expand All Controls
**Description:** As a reviewer, I want quick actions to collapse everything back to just the changes, or expand the entire file.

**Acceptance Criteria:**
- [ ] Add "Collapse unchanged" button to the diff viewer toolbar/header area
- [ ] Add "Expand all" button to the diff viewer toolbar/header area
- [ ] "Collapse unchanged" resets to the initial state (5 lines context around changes)
- [ ] "Expand all" removes all fold zones, showing the complete file
- [ ] Buttons reflect current state (disable when already fully collapsed/expanded)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Persist Expand/Collapse State Per File
**Description:** As a reviewer, I want my expand/collapse state remembered when I switch between files so I don't lose my place.

**Acceptance Criteria:**
- [ ] When switching away from a file, store which regions are expanded/collapsed
- [ ] When returning to a previously viewed file, restore the exact expand/collapse state
- [ ] State is stored in memory (not persisted across app restarts)
- [ ] If the diff data changes (e.g., MR updated), reset the stored state for that file
- [ ] Typecheck passes

### US-007: Unified View Collapse Support
**Description:** As a reviewer, I want collapse/expand to also work in unified (inline) diff view mode so I get the same focused experience regardless of view preference.

**Acceptance Criteria:**
- [ ] Collapse regions are computed and applied in unified view mode (single editor pane)
- [ ] The same 5-line context, +20 expand, and show-all controls work in unified view
- [ ] Fold zone widgets render correctly in the single-pane layout
- [ ] Switching between split and unified view preserves the current expand/collapse state
- [ ] Collapse All / Expand All toolbar buttons work in unified view
- [ ] No visual glitches when toggling view mode while regions are partially expanded
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-008: Style Fold Zones to Match Kanagawa Theme
**Description:** As a reviewer, I want the collapse indicators to look polished and consistent with the existing dark theme.

**Acceptance Criteria:**
- [ ] Fold zone background uses a subtle theme-appropriate color (e.g., slightly different from editor background)
- [ ] "N lines hidden" text is readable but not distracting (muted color, smaller font)
- [ ] Expand controls (up/down/all) are visible on hover, subtle when not hovered
- [ ] Fold zone has a thin top/bottom border to visually separate it from code
- [ ] Styling integrates with existing `monaco.css` conventions
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: Compute collapse regions from `editor.getLineChanges()`, keeping 5 lines of context above/below each change
- FR-2: Merge overlapping context regions when changes are close together (gap <= 10 lines)
- FR-3: Apply collapse regions as Monaco hidden/fold ranges on both editor panes simultaneously
- FR-4: Display a styled fold zone widget for each collapsed region showing "N lines hidden"
- FR-5: Provide expand-up control on each fold zone that reveals 20 additional lines above
- FR-6: Provide expand-down control on each fold zone that reveals 20 additional lines below
- FR-7: Provide expand-all control on each fold zone that reveals all hidden lines in that region
- FR-8: Keep original and modified editor fold states synchronized at all times
- FR-9: Maintain stable scroll position when expanding/collapsing regions
- FR-10: Provide toolbar buttons for "Collapse unchanged" (reset) and "Expand all" (show everything)
- FR-11: Store expand/collapse state per file path in component state; restore on file re-selection
- FR-12: Feature applies in both split and unified diff view modes
- FR-13: Recompute collapse regions when diff content changes (new file loaded, MR updated)
- FR-14: Collapse/expand works in unified (inline) diff view mode with the single editor pane
- FR-15: Switching between split and unified view preserves the current expand/collapse state

## Non-Goals

- No persistence of collapse state across app restarts or sessions
- No user-configurable context line count (fixed at 5)
- No collapsing within the legacy DiffViewer component (Monaco only)
- No keyboard shortcuts for expand/collapse (can be added later)
- No integration with the comment system (comments on collapsed lines don't auto-expand)

## Design Considerations

- Use Monaco's `IEditorHiddenAreaProvider` or `setHiddenAreas()` API for hiding line ranges — this preserves the full document model and syntax highlighting while visually hiding lines
- Fold zone widgets should be implemented as Monaco `ViewZone` or zone widgets to render inline between code lines
- The expand controls (up chevron, down chevron, "show all" text) should appear within the fold zone widget
- Reuse existing Kanagawa theme color tokens from `kanagawaTheme.ts` for consistent styling
- The fold zone should look like a subtle separator bar, not a code line

## Technical Considerations

- Monaco's `setHiddenAreas()` on `ICodeEditor` hides line ranges without removing them from the model — this is the key API for preserving syntax highlighting
- Both `getOriginalEditor()` and `getModifiedEditor()` need coordinated hidden area updates
- `editor.getLineChanges()` returns `ILineChange[]` with `originalStartLineNumber`, `originalEndLineNumber`, `modifiedStartLineNumber`, `modifiedEndLineNumber` — use these to compute regions for each side independently
- Monaco `ViewZone` API allows injecting custom DOM elements between lines — use for the fold zone widget
- Line mapping between original and modified sides must account for added/removed lines when computing fold regions
- The diff editor's built-in `enableSplitViewResizing` and side-by-side layout must not be broken by hidden areas
- Performance: `setHiddenAreas()` is efficient even for large files since it's a view-layer operation
- In unified view mode (`renderSideBySide: false`), Monaco uses a single editor pane — hidden areas only need to be applied once, but the line mapping differs from split mode since original and modified lines are interleaved

## Success Metrics

- Diff viewer opens with only changed lines + 5 lines context visible by default
- Incremental expand (+20 lines) responds in under 50ms
- Switching between files restores collapse state without visible flicker
- No regression in diff viewer open time (< 100ms target maintained)
- Full syntax highlighting preserved on all visible lines after any expand/collapse operation

## Open Questions

- Should expanding a region also expand the corresponding region on the other side proportionally, or should each side track its own hidden areas independently?
- If a comment exists on a currently-hidden line, should we auto-expand to show it? (Listed as non-goal for now, but worth revisiting)
- Should the minimap reflect hidden areas or show the full file?
