# CLI Comments & Suggestions — Design

**Date:** 2026-06-05
**Status:** Approved, ready for implementation planning
**Scope:** Add commenting to the `ultra` CLI (ratatui TUI): general MR comments, inline
line comments, `$EDITOR`-driven suggestion comments, and a read/reply/resolve threads
overlay. Shared logic moves to `src-tauri/src/core/comments.rs` so the desktop and CLI
can both use it.

## Goals

- Author **general** (MR-level) comments from the CLI.
- Author **inline** comments on a diff line or line range.
- Author **suggestion** comments via the user's `$EDITOR`: seed the selected lines into a
  temp file, let the user edit them, preview the resulting diff + GitLab `suggestion`
  block, then post.
- **Read** existing discussions (general + inline) in an overlay inside the MR detail
  screen, with **reply** and **resolve/unresolve**.
- Share pure comment logic between desktop and CLI via `core::comments`.

## Non-goals (this iteration)

- Refactoring the desktop's optimistic + `sync_queue` comment path. The desktop keeps its
  current behavior; it only re-uses the two pure helper functions moved into `core`.
- Editing or deleting other users' comments. (Deleting the user's own comment may be added
  later; not in this slice.)
- Rendering threads inline beneath diff lines (GitLab-web style). Threads live in an
  overlay; the diff only shows a gutter marker.

## Key architectural decision: direct-to-GitLab, no sync queue

The CLI runs as a standalone process and does **not** run the desktop's background sync
engine. This mirrors `core::mr_actions` (approve/merge/rebase), which already calls the
GitLab API directly and writes an optimistic local update.

Therefore CLI comments **post directly to the GitLab API** and the view **re-fetches the
discussions live** afterward. There is no `sync_queue` enqueue, no negative local-id
generation, and no dependency on the desktop being open. Discussions shown in the overlay
are fetched live via `client.list_discussions` (the same pattern as `get_live_diff`).

Rationale: enqueuing into `sync_queue` from the CLI would leave comments unsynced until the
desktop app happened to run (the same caveat the `auto-merge` CLI action carries). Direct
posting is immediate and self-contained, and re-fetch keeps the source of truth on GitLab.

## Module layout

### New: `src-tauri/src/core/comments.rs` (shared, `&DbPool`-based)

Pure logic (no I/O, unit-tested):

- `build_suggestion_block(seed: &str, lines_above: usize, lines_below: usize) -> String`
  — produces ` ```suggestion:-{above}+{below}\n{seed}\n``` `. Ported from
  `src/utils/gitlabSuggestions.ts`.
- `suggestion_offsets(start_line, end_line, anchor_line) -> (above, below)` — the
  `linesAbove`/`linesBelow` math from `buildGitLabSuggestionBlock`.
- `resolve_context_lines(diff_content: &str, known_line: i64, is_old_side: bool) -> Option<(i64, i64)>`
  — **moved** verbatim from `commands/comments.rs` so desktop and CLI share one copy.

Types:

- `DiffRefs { base_sha: String, head_sha: String, start_sha: String }`.
- `Thread` / `ThreadNote` view models for the overlay (discussion id, resolvable/resolved,
  optional file/line position, notes with author + body + system flag).

Direct-API operations (used by the CLI; each takes `&DbPool` + `mr_id`, looks up
`(instance_id, project_id, iid)` via the existing `mr_actions::mr_api_ids`, and builds a
client via `core::create_client`):

- `list_discussions(pool, mr_id) -> Vec<Thread>`
- `post_general_comment(pool, mr_id, body) -> ()`
- `post_inline_comment(pool, mr_id, body, file_path, old_line, new_line, refs) -> ()`
- `reply(pool, mr_id, discussion_id, body) -> ()`
- `resolve(pool, mr_id, discussion_id, resolved: bool) -> ()`

These wrap existing `GitLabClient` methods (`add_comment`, `add_inline_comment`,
`reply_to_discussion`, `resolve_discussion`, `list_discussions`).

`DiffRefs` lookup: `diff_refs_from_cache(pool, mr_id)` reads `base_sha/head_sha/start_sha`
from the `diffs` table. For the live path the refs come from the API diff-version response
(`base_commit_sha`/`head_commit_sha`/`start_commit_sha`), threaded through `DetailData`.

### Desktop touch-point

`commands/comments.rs` deletes its private `resolve_context_lines` and calls
`core::comments::resolve_context_lines` instead. No other desktop behavior changes.

## CLI changes

### Data model (`cli/src/data.rs`)

- `DetailData` gains `diff_refs: Option<core::comments::DiffRefs>`.
  - Cache path: populated from `MrDetail.diff` (which already carries the SHAs).
  - Live path: `get_live_diff` is extended to also return the version SHAs so the live
    `DetailData` carries refs (today they are dropped).

### Diff renderer (`cli/src/ui/diff.rs`)

Refactor `render_diff` to return a **`DiffModel`** instead of bare `Text`:

```text
struct DiffModel {
    text: Text<'static>,            // rendered, syntax-highlighted lines (as today)
    rows: Vec<RowMeta>,             // one entry per visual row, parallel to text.lines
}
struct RowMeta {
    kind: RowKind,                  // Hunk | Context | Add | Remove | Blank
    old_line: Option<i64>,
    new_line: Option<i64>,
}
```

- The cursor and range selection operate on `rows`. `Hunk` and `Blank` rows are
  non-selectable; cursor movement skips them.
- Gutter markers: given the set of `(old_line, new_line)` pairs that have threads for the
  current file, the renderer draws a `●` in the gutter on matching rows.
- The cursor row gets a highlight background; rows inside the active visual range get a
  selection background.

### App state (`cli/src/app.rs`)

New fields on `App`:

- `diff_cursor: usize` — selected row index in the current `DiffModel`.
- `diff_select_anchor: Option<usize>` — visual-range start (None = no range active).
- `discussions: Option<Vec<core::comments::Thread>>` — last fetched threads for the MR.
- `overlay: Option<CommentsOverlay>` — overlay open-state (list `ListState`, scroll, and
  the discussion currently targeted for reply/resolve).
- A derived per-file set of thread-anchored `(old_line, new_line)` pairs for gutter markers
  (recomputed when the selected file or `discussions` changes).

Reset `diff_cursor`, `diff_select_anchor` on file switch / MR open (alongside the existing
`diff_scroll` resets).

### Keybindings (Detail screen)

Context-sensitive, consistent with the existing focus-dependent meaning of `j/k/h/l`:

| Focus  | Key      | Action |
|--------|----------|--------|
| Diff   | `j`/`k`  | Move cursor (auto-scrolls at viewport edges). PgUp/PgDn still page. |
| Diff   | `v`      | Toggle visual range (anchor at cursor). |
| Diff   | `c`      | Inline comment on cursor line (or range). |
| Diff   | `s`      | Suggestion on cursor line/range. Disabled on pure-deletion rows. |
| Tree   | `c`      | General MR comment. |
| any    | `C`      | Open Discussions overlay. |
| Overlay| `j`/`k`  | Navigate threads/notes. |
| Overlay| `r`      | Reply to selected thread (→ `$EDITOR`). |
| Overlay| `R`      | Resolve / unresolve selected thread (toggle). |
| Overlay| `esc`    | Close overlay. |

No collision with existing keys: `c` means "cancel" only under `Focus::Pipeline`; our `c`
fires under `Focus::Tree`/`Focus::Diff`. Footer hints (`ui/footer.rs`) are updated per focus
to advertise the new keys.

### `$EDITOR` module (`cli/src/editor.rs`)

```text
fn compose(seed: &str, ext: &str) -> io::Result<Option<String>>
```

- Writes `seed` to a temp file in `std::env::temp_dir()` named with `ext` (e.g. `.md` for
  comment bodies; the target file's extension for suggestion seeds, so the editor highlights
  syntax).
- Suspends the TUI: leave alternate screen + disable raw mode.
- Runs `$EDITOR` (fallback order: `$VISUAL`, `$EDITOR`, then `vi`/`nano`; `notepad` on
  Windows) via `std::process::Command`, inheriting stdio, and waits.
- Re-enters the alternate screen + raw mode and requests `force_clear`.
- Returns `Ok(None)` if the resulting body is empty/whitespace (or, for replies/comments,
  unchanged from a comment-template seed) — the git-commit "abort on empty message"
  convention. Otherwise `Ok(Some(body))`.

Called inline from the event loop. It blocks for the editor's lifetime; acceptable because
the interaction is modal and the runtime is multi-threaded. The key `EventStream` is not
polled while the editor owns the terminal.

### Compose templates

- **General / inline comment**: seed is an empty body with a leading comment-line banner
  (`# Comment on MR !<iid>` / `# Inline comment on <file>:<line>`), `#`-prefixed lines
  stripped before posting.
- **Suggestion seed**: the selected **new-side** source lines only (no banner), so the user
  edits real code with correct syntax highlighting.

## Suggestion flow (detail)

1. In Diff focus, place the cursor (optionally `v` + `j/k` to extend a range), press `s`.
2. Guard: if the selection includes only deletion rows (no new-side line), refuse with a
   status-bar message (GitLab suggestions replace new-file content).
3. Determine `start_line`/`end_line` on the new side and an `anchor_line` (the line GitLab
   attaches the note to — the last new-side line of the range, matching the desktop default).
4. Seed the selected new-side lines into a temp file with the target file's extension;
   `compose`.
5. On non-cancel return, restore the TUI and show the **preview overlay**:
   ```
   ┌ Suggestion preview ─ src/x.rs:13-15 ┐
   │ - <original lines>                  │
   │ + <edited lines>                    │
   │                                     │
   │ ```suggestion:-{above}+{below}      │
   │ <edited lines>                      │
   │ ```                                 │
   └ p:post  e:edit  m:message  esc ─────┘
   ```
   - `above`/`below` from `suggestion_offsets(start, end, anchor)`.
   - `p` posts. `e` re-opens `$EDITOR` on the edited content. `m` opens `$EDITOR` for an
     accompanying message note (prepended above the suggestion block in the same note body).
     `esc` cancels (edited text discarded).
6. Post via `post_inline_comment` with body = optional message + `build_suggestion_block(...)`,
   positioned at `anchor_line`. Re-fetch discussions on success.

## Edge cases & error handling

- **Context line**: needs both old and new line numbers → `resolve_context_lines` on the
  file's stored diff. **Deletion** row: `old_line` only. **Added** row: `new_line` only.
  `RowMeta` already carries both numbers, so the position is derived directly from the
  cursor row without re-parsing in the common case; `resolve_context_lines` is the fallback.
- **Live diff without cached SHAs**: refs come from the live version response, carried on
  `DetailData.diff_refs`. If refs are somehow absent, inline/suggestion actions are disabled
  with a status message; general comments still work (no position needed).
- **Post failure** (network / API): status-bar error; for suggestion/reply the user's text
  is preserved via the preview/retry path (we do not discard the buffer on a failed post).
- **Consistency**: after any successful post/reply/resolve, re-fetch discussions so the
  overlay list and the diff gutter markers reflect server state.
- **Empty body**: `compose` returns `None` → action cancelled, status "Cancelled".

## Testing

- `core::comments` pure logic:
  - `build_suggestion_block` / `suggestion_offsets`: port the cases from
    `gitlabSuggestions.ts` (single line, multi-line above/below, anchor at start/end).
  - `resolve_context_lines`: context line on each side, across multiple hunks, fallback.
  - Deletion-line suggestion guard.
- `DiffModel` row-meta mapping: cursor row → correct `(old_line, new_line, kind)` across
  multiple hunks, including hunk-header and blank rows being non-selectable.
- `editor::compose` cancel-on-empty logic (the side-effect-free decision part).

Per project convention: Rust `cargo check` + tests; existing CLI tests stay green.

## Implementation phasing (one spec, incremental commits)

1. **`core::comments`** — move `resolve_context_lines`, add suggestion-block logic, add
   direct-API ops + `DiffRefs`. Wire desktop to the moved helper. Unit tests.
2. **`DiffModel` + cursor + general comment** — renderer refactor, cursor state/movement,
   `editor.rs`, `c` in Tree focus posts a general comment end-to-end.
3. **Inline comment** — `v` visual range, `c` in Diff focus, position derivation, gutter
   plumbing (without markers yet).
4. **Suggestion flow** — seed → editor → preview overlay (`p`/`e`/`m`/`esc`) → post.
5. **Discussions overlay + gutter markers** — `C` opens overlay, `r` reply, `R` resolve;
   live fetch on detail open; `●` markers on threaded lines.
