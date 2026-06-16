# Issue Description Editor Polish — Design

**Date:** 2026-06-16
**Component:** `src/pages/IssueDetailPage/IssueDescriptionEditor.tsx`
**Status:** Approved

## Goal

Make the CodeMirror 6 markdown editor for issue descriptions feel finished by adding
three capabilities: emoji-safe selection rendering, in-editor search, and an essential
markdown formatting toolbar.

## Scope

- `src/pages/IssueDetailPage/IssueDescriptionEditor.tsx` — editor extensions, toolbar, handlers.
- `src/pages/IssueDetailPage/IssueDetailPage.css` — toolbar, search panel theme, selection styling.
- `package.json` — add `@codemirror/search` dependency.

No change to existing save (`⌘Enter` / Save button), cancel (`Escape` / Cancel button),
or busy/read-only behavior beyond the Escape-vs-search guard described below.

## Feature 1 — Emoji-safe selection

**Problem:** The editor uses native browser selection. Native `::selection` renders patchily
over emojis and wide glyphs, so it is unclear whether an emoji is included in a selection.

**Solution:** Add the `drawSelection()` extension from `@codemirror/view`. It paints a custom
selection layer (`.cm-selectionLayer` / `.cm-selectionBackground`) behind the glyphs and
suppresses native `::selection`, producing a uniform highlight across all glyphs including emoji.

**Styling:** Theme `.cm-selectionBackground` with an accent-tinted background. Use a brighter
tint when the editor is focused (`&.cm-focused .cm-selectionBackground`) and a dimmer one when not,
so the selection reads clearly without overwhelming the text.

## Feature 2 — In-editor search

**Need:** Find text within long descriptions (e.g. locating a row in a big markdown table).

**Solution:** Add `@codemirror/search`:
- `search({ top: true })` — panel anchored at the top of the editor.
- `highlightSelectionMatches()` — highlight other occurrences of the selected word.
- `keymap.of(searchKeymap)` — `⌘F` open, `⌘G` / `⇧⌘G` next/prev, `Esc` close, find & replace.

**Panel appearance:** Keep CodeMirror's built-in search panel (retains full find/replace wiring)
and restyle it via `EditorView.theme` to match the app. Target the `.cm-panel.cm-search` element
and its inputs/buttons using the same CSS variables as the mention dropdown
(`--bg-secondary`, `--border-color`, `--text-primary`, `--accent-color`). The result looks native
without re-implementing search behavior.

**Escape conflict:** `handleKeyDown` currently calls `onCancel()` on `Escape`. When a search panel
is open, `Escape` must close the panel instead. Guard: if `containerRef.current` contains a
`.cm-panel`, do not call `onCancel()` — let CodeMirror handle the key. Otherwise behave as today.

## Feature 3 — Formatting toolbar (Essential set, always-visible)

A `.issue-description-editor-toolbar` strip rendered above the CodeMirror container, inside the
existing editor card so it reads as one control. Icon buttons (inline SVG, matching the app's
existing icon convention — no icon library):

| Button | Action |
| --- | --- |
| Bold | Wrap selection in `**…**`; with no selection, insert `****` and place caret between. |
| Italic | Wrap selection in `_…_`; caret between when empty. |
| Inline code | Wrap selection in `` `…` ``; caret between when empty. |
| Link | Replace selection with `[selection](url)`, caret in the URL slot (or `[text](url)` when empty). |
| Bulleted list | Prefix `- ` on each selected line; toggle off if every selected line already has it. |
| Search (right-aligned) | Calls `openSearchPanel(view)` — discoverability for Feature 2. |

**Implementation:**
- Helper functions operate on `viewRef.current` and apply changes via `view.dispatch({ changes, selection })`.
- After every action, return focus to the editor (`view.focus()`).
- All formatting buttons are `disabled` when `busy`.
- Wire `Mod-B` / `Mod-I` / `Mod-K` in the keymap to the bold / italic / link handlers (highest-prec
  keymap, alongside the existing `Mod-Enter` handler) so shortcuts and buttons share one code path.

**Styling:** Use existing tokens — `--border-color` divider, `--bg-secondary` background,
`--text-secondary` icons with `--accent-color` / `--text-primary` on hover. Round the top corners
to sit flush atop the editor; the editor border-radius adjusts so the two form a single card.

## Testing (manual, `bun run tauri dev`)

1. Select a range that spans an emoji — the emoji shows the same clear highlight as text.
2. `⌘F` opens the themed panel; searching in a long table highlights and navigates matches.
3. Each toolbar button works both with a selection and with an empty selection (caret placement).
4. Bulleted-list button toggles on and off across a multi-line selection.
5. `Esc` closes the search panel when open; `Esc` cancels editing when the panel is closed.
6. `⌘Enter` save and Cancel button still work; buttons disabled while saving.
7. `bunx tsc --noEmit` passes.

## Out of scope

- Extended/full markdown toolbar (headings, quote, tables, images) — only the Essential set.
- Floating/bubble selection toolbar.
- Applying these changes to `IssueCommentComposer` (separate component; can follow later).
