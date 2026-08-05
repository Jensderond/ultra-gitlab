# Diff Edit Mode → GitLab Suggestions

**Date:** 2026-08-05
**Status:** Implemented — manual WKWebView gate passed 2026-08-05 (selection drift seen during the gate was root-caused to the "Geist Mono Variable" diffs font: pierre's canvas-measured overlay positions disagree with DOM rendering for variable fonts in WKWebView; static fonts are pixel-exact and the underlying selection is always correct)

## Summary

Upgrade `@pierre/diffs` from `^1.2.12` to `^1.3.3` and use its now-stable Edit mode to let users author GitLab suggestion comments by editing the diff in place. A floating "Suggest edit" button on the MRDetailPage diff pane enters edit mode; on confirm, the edited region is converted to a ```` ```suggestion:-N+M``` ```` block and reviewed in the existing CommentOverlay before posting via the existing `addInlineComment` path.

Desktop-only. iOS keeps the current select-lines + `s` flow.

## Decisions made during brainstorming

- **Finish flow:** review in CommentOverlay first (pre-filled suggestion block, optional rationale text); nothing posts without explicit submit.
- **Multi-edit sessions:** one suggestion per session. Disjoint edits collapse to the full span from first to last changed line as a single multi-line suggestion.
- **Entry UX:** floating pill bottom-right of the diff pane; in edit mode it becomes "Create suggestion" (primary) + "Cancel". Escape cancels.
- **Platforms:** desktop-only, gated on the existing `isIOS` check (`src/services/transport.ts`).
- **Approach:** in-place edit mode on the existing `MultiFileDiff` in `PierreDiffViewer` (chosen over a separate edit surface and over a CodeMirror overlay). CodeMirror overlay is the documented fallback if WKWebView editing proves broken again.

## UX flow

1. Floating **"Suggest edit"** pill sits bottom-right of `.mr-detail-main`. Hidden when: iOS, image file, no diff refs, file loading/error. Disabled until the highlighter preload resolves.
2. Click → edit mode: new-side lines become editable in place (pierre `edit` prop; deleted lines stay read-only by pierre's design). Pill is replaced by **"Create suggestion"** (disabled while content is unchanged) and **"Cancel"**.
3. Cancel, Escape, file switch, or view-mode switch discards edits and returns to read-only.
4. **Create suggestion** → compute changed region → exit edit mode → open `CommentOverlay` via the same `commentOverlayRef.current.open(position, selection, suggestionText)` call the `s`-hotkey uses, pre-filled with the suggestion block anchored at the region's end line. User adds optional text and submits through `addInlineComment`.

## Components & state

- **Dependency:** `@pierre/diffs` `^1.2.12` → `^1.3.3`. After install, verify bun.lock has no duplicate transitive entries (see the earlier `@codemirror/state` dedup incident).
- **`viewReducer.ts`:** add `editMode: boolean`; actions `ENTER_EDIT_MODE` / `EXIT_EDIT_MODE`; `SELECT_FILE` and `SET_VIEW_MODE` reset it to `false`.
- **`PierreDiffViewer`:** new optional props `editMode: boolean` and `onEditContentChange(contents: string)`. When editing: wrap `MultiFileDiff` in `EditProvider` (editor created with `persistState: false`), pass `edit`, gate the editable render on the `preloadHighlighter` promise, report the latest edited contents upward from the editor `onChange`. Line-selection and line-click handlers are disabled while editing.
- **New `SuggestEditControls`** (`src/pages/MRDetailPage/`): floating pill + confirm/cancel pair. Pure UI; state lives in MRDetailPage.
- **`MRDetailPage/index.tsx`:** holds edited-content state/ref, wires controls → reducer, runs the mapping on confirm, opens the overlay.
- **`useMRKeyboard`:** all MR hotkeys suspended while `editMode` is true (single guard at the top). This avoids the shadow-root retargeting trap: window-level handlers see `e.target` retargeted to the `DIFFS-CONTAINER` host, so `e.target.isContentEditable` is `false` while the user is typing in the editor.
- **Highlighter preload:** `preloadHighlighter({ themes: ['pierre-dark', 'pierre-light'], langs: [...] })` kicked off on MRDetailPage mount (desktop only). The pierre editor tokenizes on the main thread and drops keystrokes typed before its grammar loads — the edit button stays disabled until preload resolves.

## Edit → suggestion mapping

New pure function in `src/utils/gitlabSuggestions.ts`:

```ts
computeEditedRegion(original: string, edited: string):
  { startLine: number; endLine: number; replacement: string } | null
```

Lines are 1-based on the **new** side of the diff.

- Normalize `\r\n` → `\n`, split into lines. Trim the common prefix (top scan) and common suffix (bottom scan, clamped so scans never cross). Original span = `start..endOrig`; replacement = edited lines `start..endEdited` joined with `\n`.
- **No difference** → `null`. The confirm button computes this live from `onEditContentChange` to drive its disabled state.
- **Pure insertion** (empty original span): GitLab suggestions must replace at least one existing line, so expand the region to include the adjacent original line — the line above, or the line below when inserting at the very top — repeated unchanged in the replacement.
- **Pure deletion:** empty replacement; GitLab renders an empty suggestion as "remove these lines".
- Build the block with the existing `buildGitLabSuggestionBlock({ startLine, endLine, text: replacement })` anchored at `endLine`; the overlay is opened with position `{ line: endLine, isOriginal: false }` and the computed `{ startLine, endLine }` span as the selection argument — the same call shape as the `s`-hotkey flow in `useMRKeyboard.ts`.

Deliberately **not** accumulating pierre's incremental `EditorChangeEvent`s: replaying shifting line ranges across a session is error-prone; a final-state line diff is exact under the one-region-per-session contract.

## Error handling

- **Highlighter preload fails:** edit button stays disabled with a tooltip; diff remains fully usable read-only (fail-open to the current experience).
- **GitLab rejects the comment position** (e.g. span entirely in unchanged context far from any hunk — same limitation as today's manual flow): the overlay stays open (nothing is lost), but the mutation error is currently only logged to the console — visible error feedback and context-line (`isContext`) classification of edit anchors are ticketed fast-follows (see final review, 2026-08-05).
- **Discard on navigation:** file switch, view-mode switch, MR switch, breakpoint crossing, or unmount while editing discards silently. Implementation note (empirical, 1.3.3): `persistState: false` alone does NOT discard — pierre keeps the edited document rendered on an in-place `edit=false` transition and serves it from content caches keyed by `cacheKey`. Teardown therefore remounts the viewer via an edit-session key and folds a session nonce into the cache keys, synchronously with every exit path.

## Testing

- **Unit (vitest — `src/**/*.test.ts` is configured in vite.config.ts but currently empty):** `computeEditedRegion` — single-line change, multi-line block, pure insert at top/middle/bottom, pure delete, disjoint edits (full-span), no-op, trailing-newline cases.
- **E2E (Playwright, chromium):** extend `e2e/mr-detail-suggestions.spec.ts` — enter edit mode, type into the diff, confirm, assert the overlay opens pre-filled with the correct `suggestion:-N+M` header and body; cancel path; hotkeys suspended while editing.
- **Manual WKWebView gate (required before merge):** `bun run tauri dev`; verify caret and selection rendering while editing lines that wrap and lines containing emoji. This is what killed the previous editor attempt (issue description editing, June 2026) and Playwright chromium cannot catch it. If selection rendering is broken, stop and fall back to the CodeMirror-overlay approach.

## Known risks

- **WKWebView selection overlays.** The prior failure was observed with `disableLineNumbers: true` on wrapped prose; diff views keep line numbers and code rarely wraps, and 1.3 stable postdates the beta that failed — plausibly fine, but unproven until the manual gate passes.
- **Split view editing.** Edit mode targets the new side; if split view misbehaves in 1.3.3, restrict the button to unified view as a scope cut rather than blocking the feature.
