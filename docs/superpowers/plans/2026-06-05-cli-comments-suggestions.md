# CLI Comments & Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `ultra` CLI author general MR comments, inline line/range comments, and `$EDITOR`-driven suggestion comments, and read/reply/resolve discussion threads — sharing comment logic with the desktop via `core::comments`.

**Architecture:** The CLI has no sync engine, so comments post **directly** to GitLab (like `core::mr_actions` does for approve/merge) and the view re-fetches discussions live. Pure comment logic (suggestion-block math, diff line resolution) moves into `src-tauri/src/core/comments.rs`. The TUI diff renderer is refactored to emit per-row metadata so a cursor can target lines; `$EDITOR` is invoked by suspending and restoring the terminal.

**Tech Stack:** Rust (Tauri lib crate + `ultra` CLI bin), ratatui 0.29, crossterm 0.28, tokio, sqlx/SQLite. Package manager: `bun` (frontend only). Rust checks: `cargo check`, `cargo test` (run from `src-tauri/`).

**Spec:** `docs/superpowers/specs/2026-06-05-cli-comments-suggestions-design.md`

---

## File Structure

**Created:**
- `src-tauri/src/core/comments.rs` — shared pure logic (suggestion blocks, context-line resolution) + direct-API ops (`list_discussions`, `post_general_comment`, `post_inline_comment`, `reply`, `resolve`) + `DiffRefs`/`Thread` types.
- `src-tauri/cli/src/editor.rs` — suspend the TUI, run `$EDITOR` on a temp file, restore; return the edited body (or `None` to cancel).
- `src-tauri/cli/src/comments.rs` — CLI-side compose orchestration: the `PendingCompose` enum, position derivation from the diff cursor, suggestion seed extraction, and the post-dispatch helpers.

**Modified:**
- `src-tauri/src/core/mod.rs` — `pub mod comments;`.
- `src-tauri/src/commands/comments.rs` — delete the private `resolve_context_lines`, call `core::comments::resolve_context_lines`.
- `src-tauri/src/core/mr_actions.rs` — `get_live_diff` also returns the version SHAs.
- `src-tauri/cli/src/data.rs` — `DetailData` gains `diff_refs`; `FileDiff` keeps `old_path` for positions.
- `src-tauri/cli/src/ui/diff.rs` — `render_diff` returns a `DiffModel { text, rows }`.
- `src-tauri/cli/src/ui/detail.rs` — consume `DiffModel`, store rows + clamp cursor, draw cursor/range highlight + gutter markers, render overlays.
- `src-tauri/cli/src/ui/footer.rs` — advertise the new keys.
- `src-tauri/cli/src/app.rs` — cursor/range/overlay/pending state + key handling + run-loop editor handling.
- `src-tauri/cli/src/event.rs` — new `AppEvent` variants.
- `src-tauri/cli/src/main.rs` — `mod editor; mod comments;`.

---

## Conventions for every task

- Run all `cargo` commands from `/Users/jens/Sites/ultra-gitlab/src-tauri`.
- `cargo test -p ultra-gitlab` runs lib (core) tests; `cargo test -p ultra-gitlab-cli` runs CLI tests; `cargo check --workspace` checks everything.
- The pre-commit hook runs the frontend Playwright suite and is unrelated to Rust changes; if it blocks a Rust-only commit and fails on `__TAURI_INTERNALS__`, commit with `--no-verify` (note it in the commit body).

---

# Phase 1 — `core::comments`

## Task 1: Suggestion-block builder (pure)

**Files:**
- Create: `src-tauri/src/core/comments.rs`
- Modify: `src-tauri/src/core/mod.rs`

- [ ] **Step 1: Register the module**

In `src-tauri/src/core/mod.rs`, add to the existing `pub mod` list (next to `pub mod mr_actions;`):

```rust
pub mod comments;
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/core/comments.rs` with only the test module and the function signatures it calls:

```rust
//! Comment logic shared between the Tauri commands and the `ultra` CLI.
//!
//! Pure helpers (suggestion blocks, diff line resolution) are unit-tested here.
//! Direct-API operations post straight to GitLab; the CLI uses them because it
//! has no background sync engine.

/// Number of lines above/below the suggestion anchor that the replacement spans.
/// Mirrors the desktop `buildGitLabSuggestionBlock` math in
/// `src/utils/gitlabSuggestions.ts`.
pub fn suggestion_offsets(start_line: i64, end_line: i64, anchor_line: i64) -> (i64, i64) {
    let above = (anchor_line - start_line).max(0);
    let below = (end_line - anchor_line).max(0);
    (above, below)
}

/// Build a GitLab ```suggestion fenced block replacing `above` lines before and
/// `below` lines after the anchored line with `replacement` (no trailing newline
/// inside the fence is added beyond the one separating content from the fence).
pub fn build_suggestion_block(replacement: &str, above: i64, below: i64) -> String {
    format!("```suggestion:-{above}+{below}\n{replacement}\n```\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offsets_single_line_anchor_at_end() {
        // selection 13..=15, anchor 15 -> 2 above, 0 below (desktop default).
        assert_eq!(suggestion_offsets(13, 15, 15), (2, 0));
    }

    #[test]
    fn offsets_anchor_at_start() {
        assert_eq!(suggestion_offsets(13, 15, 13), (0, 2));
    }

    #[test]
    fn offsets_single_line() {
        assert_eq!(suggestion_offsets(20, 20, 20), (0, 0));
    }

    #[test]
    fn block_wraps_replacement() {
        assert_eq!(
            build_suggestion_block("const x = 2;", 0, 0),
            "```suggestion:-0+0\nconst x = 2;\n```\n"
        );
    }

    #[test]
    fn block_multiline_with_offsets() {
        let b = build_suggestion_block("a\nb", 0, 1);
        assert_eq!(b, "```suggestion:-0+1\na\nb\n```\n");
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test -p ultra-gitlab core::comments`
Expected: 5 tests pass (the functions are already implemented above — this task is the function plus its tests together; verifying green is the gate).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/core/comments.rs src-tauri/src/core/mod.rs
git commit -m "feat(core): suggestion-block builder for shared comment logic"
```

---

## Task 2: Move `resolve_context_lines` into `core::comments`

**Files:**
- Modify: `src-tauri/src/core/comments.rs`
- Modify: `src-tauri/src/commands/comments.rs:182-271`

- [ ] **Step 1: Add the function + tests to `core::comments`**

Append to `src-tauri/src/core/comments.rs` (above the `#[cfg(test)]` module, then add the tests inside it):

```rust
/// Resolve context line numbers from a unified diff.
///
/// Given a line number on one side, find the corresponding line on the other
/// side by parsing the unified diff hunk headers and counting lines. Returns
/// `(old_line, new_line)`. Ported verbatim from the desktop comment command so
/// both paths share one implementation.
pub fn resolve_context_lines(
    diff_content: &str,
    known_line: i64,
    is_old_side: bool,
) -> Option<(i64, i64)> {
    let mut old_line: i64 = 0;
    let mut new_line: i64 = 0;

    for line in diff_content.lines() {
        if line.starts_with("@@") {
            let parts: Vec<&str> = line.splitn(4, ' ').collect();
            if parts.len() >= 3 {
                if let Some(old_start) = parts[1].strip_prefix('-') {
                    old_line = old_start
                        .split(',')
                        .next()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0)
                        - 1;
                }
                if let Some(new_start) = parts[2].strip_prefix('+') {
                    new_line = new_start
                        .split(',')
                        .next()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0)
                        - 1;
                }
            }
            continue;
        }

        if line.starts_with("---")
            || line.starts_with("+++")
            || line.starts_with("diff ")
            || line.starts_with("index ")
        {
            continue;
        }

        if line.starts_with('-') {
            old_line += 1;
        } else if line.starts_with('+') {
            new_line += 1;
        } else {
            old_line += 1;
            new_line += 1;
            let target_matches = if is_old_side {
                old_line == known_line
            } else {
                new_line == known_line
            };
            if target_matches {
                return Some((old_line, new_line));
            }
        }
    }
    None
}
```

Add these tests inside the existing `mod tests`:

```rust
    #[test]
    fn resolve_context_new_side() {
        // context line 2 on the new side maps to old line 2.
        let diff = "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n";
        assert_eq!(resolve_context_lines(diff, 1, false), Some((1, 1)));
    }

    #[test]
    fn resolve_context_returns_none_for_changed_line() {
        let diff = "@@ -1,2 +1,2 @@\n-old\n+new\n";
        assert_eq!(resolve_context_lines(diff, 1, false), None);
    }
```

- [ ] **Step 2: Run the new tests**

Run: `cargo test -p ultra-gitlab core::comments`
Expected: 7 tests pass.

- [ ] **Step 3: Point the desktop command at the shared copy**

In `src-tauri/src/commands/comments.rs`, delete the private `fn resolve_context_lines(...)` (currently lines ~182-242) entirely. In `resolve_context_line_numbers` (~line 263) change the call site from:

```rust
            if let Some(pair) = resolve_context_lines(&diff, known_line, is_old_side) {
```

to:

```rust
            if let Some(pair) = crate::core::comments::resolve_context_lines(&diff, known_line, is_old_side) {
```

- [ ] **Step 4: Verify the desktop still builds and its tests pass**

Run: `cargo test -p ultra-gitlab commands::comments`
Expected: existing comment-command tests pass; no `unused function` warning for the deleted helper.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/comments.rs src-tauri/src/commands/comments.rs
git commit -m "refactor(core): share resolve_context_lines between desktop and CLI"
```

---

## Task 3: `DiffRefs`, thread view models, and direct-API operations

**Files:**
- Modify: `src-tauri/src/core/comments.rs`

- [ ] **Step 1: Add types and DB-backed refs lookup with a test**

Append to `src-tauri/src/core/comments.rs` (above the test module):

```rust
use crate::core::create_client;
use crate::core::mr_actions::mr_api_ids;
use crate::db::pool::DbPool;
use crate::error::AppError;

/// The three SHAs GitLab needs to position an inline note.
#[derive(Debug, Clone)]
pub struct DiffRefs {
    pub base_sha: String,
    pub head_sha: String,
    pub start_sha: String,
}

/// One discussion thread for the CLI overlay.
#[derive(Debug, Clone)]
pub struct Thread {
    pub id: String,
    pub resolvable: bool,
    pub resolved: bool,
    /// Present for inline threads.
    pub file_path: Option<String>,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
    pub notes: Vec<ThreadNote>,
}

/// One note within a thread.
#[derive(Debug, Clone)]
pub struct ThreadNote {
    pub author: String,
    pub body: String,
    pub system: bool,
}

/// Read cached diff SHAs for an MR from the `diffs` table. Returns `None` when
/// the MR has no cached diff (e.g. a live-only detail), in which case the caller
/// supplies refs from the live API version instead.
pub async fn diff_refs_from_cache(pool: &DbPool, mr_id: i64) -> Result<Option<DiffRefs>, AppError> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT base_sha, head_sha, start_sha FROM diffs WHERE mr_id = ?",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(base_sha, head_sha, start_sha)| DiffRefs {
        base_sha,
        head_sha,
        start_sha,
    }))
}
```

Add this test inside `mod tests` (it uses the same temp-DB pattern as `mr_actions`):

```rust
    #[tokio::test]
    async fn diff_refs_none_when_absent() {
        use crate::db;
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        assert!(diff_refs_from_cache(&pool, 1).await.unwrap().is_none());
    }
```

- [ ] **Step 2: Run the test**

Run: `cargo test -p ultra-gitlab core::comments::tests::diff_refs_none_when_absent`
Expected: PASS.

- [ ] **Step 3: Add the direct-API operations**

Append to `src-tauri/src/core/comments.rs` (above the test module). These wrap existing `GitLabClient` methods verified in `services/gitlab_client.rs`:

```rust
/// Fetch and flatten discussions for the CLI overlay (live from GitLab).
pub async fn list_discussions(pool: &DbPool, mr_id: i64) -> Result<Vec<Thread>, AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    let discussions = client.list_discussions(project_id, iid).await?;
    Ok(discussions
        .into_iter()
        .map(|d| {
            let first_pos = d.notes.iter().find_map(|n| n.position.clone());
            let resolvable = d.notes.iter().any(|n| n.resolvable);
            let resolved = d.notes.iter().any(|n| n.resolved.unwrap_or(false));
            Thread {
                id: d.id,
                resolvable,
                resolved,
                file_path: first_pos
                    .as_ref()
                    .and_then(|p| p.new_path.clone().or_else(|| p.old_path.clone())),
                old_line: first_pos.as_ref().and_then(|p| p.old_line),
                new_line: first_pos.as_ref().and_then(|p| p.new_line),
                notes: d
                    .notes
                    .into_iter()
                    .map(|n| ThreadNote {
                        author: n.author.username,
                        body: n.body,
                        system: n.system,
                    })
                    .collect(),
            }
        })
        .collect())
}

/// Post a general (MR-level) comment.
pub async fn post_general_comment(pool: &DbPool, mr_id: i64, body: &str) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.add_comment(project_id, iid, body).await?;
    Ok(())
}

/// Post an inline comment at a position. `old_line`/`new_line` follow the GitLab
/// convention: added lines set only `new_line`, deleted only `old_line`, context
/// both.
pub async fn post_inline_comment(
    pool: &DbPool,
    mr_id: i64,
    body: &str,
    file_path: &str,
    old_line: Option<i64>,
    new_line: Option<i64>,
    refs: &DiffRefs,
) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client
        .add_inline_comment(
            project_id,
            iid,
            body,
            file_path,
            old_line,
            new_line,
            &refs.base_sha,
            &refs.head_sha,
            &refs.start_sha,
        )
        .await?;
    Ok(())
}

/// Reply to an existing discussion thread.
pub async fn reply(
    pool: &DbPool,
    mr_id: i64,
    discussion_id: &str,
    body: &str,
) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client
        .reply_to_discussion(project_id, iid, discussion_id, body)
        .await?;
    Ok(())
}

/// Resolve or unresolve a discussion thread.
pub async fn resolve(
    pool: &DbPool,
    mr_id: i64,
    discussion_id: &str,
    resolved: bool,
) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client
        .resolve_discussion(project_id, iid, discussion_id, resolved)
        .await?;
    Ok(())
}
```

`mr_api_ids` is currently `pub` in `mr_actions.rs` — confirm with `grep -n "pub async fn mr_api_ids" src/core/mr_actions.rs`. It is.

- [ ] **Step 4: Build the workspace**

Run: `cargo check -p ultra-gitlab`
Expected: compiles clean (no network test for these ops — consistent with `mr_actions`, which only unit-tests its DB/pure logic).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/comments.rs
git commit -m "feat(core): direct-API comment ops + thread/diff-ref types"
```

---

# Phase 2 — DiffModel, cursor, and general comments

## Task 4: Refactor the diff renderer to emit row metadata

**Files:**
- Modify: `src-tauri/cli/src/ui/diff.rs`
- Modify: `src-tauri/cli/src/ui/detail.rs:110-136`

- [ ] **Step 1: Add `RowMeta`/`DiffModel` and the row-mapping test**

In `src-tauri/cli/src/ui/diff.rs`, add near the top (after the imports):

```rust
/// What a single rendered diff row represents, parallel to `DiffModel::text`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowKind {
    Hunk,
    Context,
    Add,
    Remove,
    Blank,
}

/// Per-row metadata so a cursor can target a line and derive its GitLab position.
#[derive(Debug, Clone, Copy)]
pub struct RowMeta {
    pub kind: RowKind,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
}

impl RowMeta {
    /// Selectable rows are the ones a comment can attach to.
    pub fn selectable(&self) -> bool {
        matches!(self.kind, RowKind::Context | RowKind::Add | RowKind::Remove)
    }
}

/// Rendered diff plus a parallel row-metadata vector (same length as `text.lines`).
pub struct DiffModel {
    pub text: Text<'static>,
    pub rows: Vec<RowMeta>,
}
```

- [ ] **Step 2: Change `render_diff` to populate and return `DiffModel`**

Replace the body of `render_diff` so every `lines.push(...)` is mirrored by a `rows.push(...)`. The full new function:

```rust
/// Build highlighted, scrollable diff plus per-row metadata.
/// `path` selects the syntax; `diff_content` is the raw unified diff.
pub fn render_diff(hl: &Highlighter, path: &str, diff_content: &str) -> DiffModel {
    let hunks = parse_unified_diff_public(diff_content);

    let mut lines: Vec<Line> = Vec::new();
    let mut rows: Vec<RowMeta> = Vec::new();
    for hunk in &hunks {
        lines.push(Line::from(Span::styled(
            format!("@@ -{},{} +{},{} @@", hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count),
            Style::default().fg(Color::Cyan),
        )));
        rows.push(RowMeta { kind: RowKind::Hunk, old_line: None, new_line: None });
        for dl in &hunk.lines {
            let (bg, sign, old_n, new_n, kind) = match dl.line_type.as_str() {
                "add" => (Some(ADD_BG), "+", None, dl.new_line_number, RowKind::Add),
                "remove" => (Some(DEL_BG), "-", dl.old_line_number, None, RowKind::Remove),
                _ => (None, " ", dl.old_line_number, dl.new_line_number, RowKind::Context),
            };
            let gutter = format!(
                "{:>4} {:>4} ",
                old_n.map(|n| n.to_string()).unwrap_or_default(),
                new_n.map(|n| n.to_string()).unwrap_or_default(),
            );
            let mut spans = vec![
                Span::styled(gutter, Style::default().fg(GUTTER)),
                Span::styled(sign.to_string(), line_style(bg)),
            ];
            let content = expand_tabs(&dl.content);
            for seg in hl.highlight(path, &content).into_iter().next().unwrap_or_default() {
                let mut style = Style::default().fg(seg.color);
                if let Some(bg) = bg {
                    style = style.bg(bg);
                }
                spans.push(Span::styled(seg.text, style));
            }
            lines.push(Line::from(spans));
            rows.push(RowMeta { kind, old_line: dl.old_line_number, new_line: dl.new_line_number });
        }
        lines.push(Line::from(""));
        rows.push(RowMeta { kind: RowKind::Blank, old_line: None, new_line: None });
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "(no textual diff — binary or empty)",
            Style::default().fg(Color::DarkGray),
        )));
        rows.push(RowMeta { kind: RowKind::Blank, old_line: None, new_line: None });
    }
    DiffModel { text: Text::from(lines), rows }
}
```

Update the existing tests in `diff.rs` that call `render_diff` to use `.text`:
- `renders_hunk_lines`: change `text.lines.len()` → `render_diff(...).text.lines.len()` (bind `let model = render_diff(...); assert!(model.text.lines.len() >= 4);`).
- `rendered_diff_has_no_literal_tabs`: iterate `model.text.lines`.
- `empty_diff_shows_placeholder`: use `model.text.lines[0]`.

- [ ] **Step 3: Add a row-mapping test**

Add to `diff.rs` `mod tests`:

```rust
    #[test]
    fn rows_parallel_text_and_mark_kinds() {
        let hl = Highlighter::new();
        let diff = "@@ -1,2 +1,2 @@\n context\n-old\n+new\n";
        let model = render_diff(&hl, "x.rs", diff);
        assert_eq!(model.rows.len(), model.text.lines.len());
        assert_eq!(model.rows[0].kind, RowKind::Hunk);
        assert_eq!(model.rows[1].kind, RowKind::Context);
        assert_eq!(model.rows[2].kind, RowKind::Remove);
        assert_eq!(model.rows[2].old_line, Some(2));
        assert_eq!(model.rows[3].kind, RowKind::Add);
        assert_eq!(model.rows[3].new_line, Some(2));
        assert!(!model.rows[0].selectable());
        assert!(model.rows[3].selectable());
    }
```

- [ ] **Step 4: Update the `detail.rs` call site**

In `src-tauri/cli/src/ui/detail.rs`, inside `render_diff` (the wrapper, ~line 110), change:

```rust
    let text = diff::render_diff(&app.highlighter, &file.new_path, &file.diff_content);
```

to:

```rust
    let model = diff::render_diff(&app.highlighter, &file.new_path, &file.diff_content);
    let text = model.text;
    app.diff_rows = model.rows;
```

(`app.diff_rows` is added in Task 5; this step will not compile until then — that is expected and covered by Task 5's check.)

- [ ] **Step 5: Run the diff unit tests**

Run: `cargo test -p ultra-gitlab-cli ui::diff`
Expected: the `diff.rs` tests (including `rows_parallel_text_and_mark_kinds`) pass. (`detail.rs` won't compile yet; run with `--lib`? The CLI is a bin — instead defer the full build to Task 5. Verify just the diff tests by temporarily commenting the `app.diff_rows` line is **not** needed: do Step 4 and Task 5 Step 1 together before building.)

- [ ] **Step 6: Commit (after Task 5 compiles)**

Combine with Task 5's commit — these two tasks form one compiling unit.

---

## Task 5: Cursor state, movement, and highlight

**Files:**
- Modify: `src-tauri/cli/src/app.rs`
- Modify: `src-tauri/cli/src/ui/detail.rs`

- [ ] **Step 1: Add cursor/rows state to `App`**

In `src-tauri/cli/src/app.rs`, add fields to `struct App` (after `diff_hscroll_max`):

```rust
    /// Per-row metadata for the current file's diff, refreshed each render.
    pub diff_rows: Vec<crate::ui::diff::RowMeta>,
    /// Cursor row index into `diff_rows` (the line a comment would target).
    pub diff_cursor: usize,
    /// Visual-range anchor row; `Some` while a range selection is active.
    pub diff_select_anchor: Option<usize>,
```

Initialize them in `App::new` (after `diff_hscroll_max: 0,`):

```rust
            diff_rows: Vec::new(),
            diff_cursor: 0,
            diff_select_anchor: None,
```

Reset on file/MR change: in `move_file` and `mark_viewed_and_advance` (after each `app.diff_scroll = 0;`) and in `AppEvent::Detail(Ok(d))` handling (after `app.diff_scroll = 0;`), add:

```rust
            app.diff_cursor = 0;
            app.diff_select_anchor = None;
```

- [ ] **Step 2: Add cursor-movement helpers with a test**

Add to `app.rs` (near `move_file`):

```rust
/// Move the diff cursor by `delta`, skipping non-selectable rows (hunk headers,
/// blanks). Returns the new cursor index. Pure over the rows so it is testable.
fn next_selectable(rows: &[crate::ui::diff::RowMeta], from: usize, delta: i32) -> usize {
    if rows.is_empty() {
        return 0;
    }
    let len = rows.len() as i32;
    let mut i = from as i32;
    loop {
        let n = i + delta;
        if n < 0 || n >= len {
            return i.clamp(0, len - 1) as usize;
        }
        i = n;
        if rows[i as usize].selectable() {
            return i as usize;
        }
    }
}

fn move_cursor(app: &mut App, delta: i32) {
    if app.diff_rows.is_empty() {
        return;
    }
    app.diff_cursor = next_selectable(&app.diff_rows, app.diff_cursor, delta);
    // Keep the cursor within the viewport by nudging the scroll offset.
    let cur = app.diff_cursor as u16;
    let top = app.diff_scroll;
    let h = app.diff_viewport.max(1);
    if cur < top {
        app.diff_scroll = cur;
    } else if cur >= top + h {
        app.diff_scroll = cur.saturating_sub(h - 1);
    }
}
```

Add a test in `app.rs` (add a `#[cfg(test)] mod tests` block if none exists):

```rust
#[cfg(test)]
mod tests {
    use super::next_selectable;
    use crate::ui::diff::{RowKind, RowMeta};

    fn r(kind: RowKind) -> RowMeta {
        RowMeta { kind, old_line: None, new_line: None }
    }

    #[test]
    fn cursor_skips_hunk_and_blank() {
        let rows = vec![
            r(RowKind::Hunk),
            r(RowKind::Context),
            r(RowKind::Add),
            r(RowKind::Blank),
            r(RowKind::Hunk),
            r(RowKind::Context),
        ];
        // from index 2 (Add), +1 skips Blank+Hunk to land on index 5 (Context).
        assert_eq!(next_selectable(&rows, 2, 1), 5);
        // moving up from 5 lands on 2.
        assert_eq!(next_selectable(&rows, 5, -1), 2);
        // at the top, moving up stays put.
        assert_eq!(next_selectable(&rows, 1, -1), 1);
    }
}
```

- [ ] **Step 3: Route `j`/`k` in Diff focus to the cursor**

In `handle_detail_key`, replace the `Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_add(1)` arm (and the matching `saturating_sub(1)` for `k`) with cursor movement:

```rust
        KeyCode::Char('j') | KeyCode::Down => match app.focus {
            Focus::Tree => move_file(app, 1),
            Focus::Diff => move_cursor(app, 1),
            Focus::Pipeline => crate::pipelines::handle_detail_key(app, KeyCode::Char('j')),
        },
        KeyCode::Char('k') | KeyCode::Up => match app.focus {
            Focus::Tree => move_file(app, -1),
            Focus::Diff => move_cursor(app, -1),
            Focus::Pipeline => crate::pipelines::handle_detail_key(app, KeyCode::Char('k')),
        },
```

- [ ] **Step 4: Draw the cursor highlight**

In `src-tauri/cli/src/ui/detail.rs` `render_diff`, after `let text = model.text; app.diff_rows = model.rows;` and before building the `Paragraph`, clamp the cursor and apply a highlight to the cursor row and any range rows. Replace the `Paragraph::new(text)...` block with:

```rust
    // Clamp the cursor to a selectable row after a re-render.
    if !app.diff_rows.is_empty() {
        if app.diff_cursor >= app.diff_rows.len()
            || !app.diff_rows[app.diff_cursor].selectable()
        {
            app.diff_cursor = crate::app::first_selectable(&app.diff_rows);
        }
    }
    let (lo, hi) = app.diff_selection_bounds();
    let mut text = text;
    for (i, line) in text.lines.iter_mut().enumerate() {
        if i >= lo && i <= hi {
            let bg = if i == app.diff_cursor { Color::Rgb(60, 60, 90) } else { Color::Rgb(40, 40, 60) };
            line.spans.iter_mut().for_each(|s| s.style = s.style.bg(bg));
        }
    }
    let inner_w = area.width.saturating_sub(2);
    let max_w = text.lines.iter().map(|l| l.width()).max().unwrap_or(0) as u16;
    app.diff_hscroll_max = max_w.saturating_sub(inner_w);
    let hscroll = app.diff_hscroll.min(app.diff_hscroll_max);
    app.diff_hscroll = hscroll;
    f.render_widget(
        Paragraph::new(text).block(block).scroll((app.diff_scroll, hscroll)),
        area,
    );
```

Add the two helpers to `app.rs`:

```rust
/// First selectable row index, or 0 if none.
pub fn first_selectable(rows: &[crate::ui::diff::RowMeta]) -> usize {
    rows.iter().position(|r| r.selectable()).unwrap_or(0)
}

impl App {
    /// Inclusive `(low, high)` highlight bounds: the visual range if active,
    /// else just the cursor row.
    pub fn diff_selection_bounds(&self) -> (usize, usize) {
        match self.diff_select_anchor {
            Some(a) => (a.min(self.diff_cursor), a.max(self.diff_cursor)),
            None => (self.diff_cursor, self.diff_cursor),
        }
    }
}
```

- [ ] **Step 5: Build and test**

Run: `cargo test -p ultra-gitlab-cli`
Expected: compiles; `cursor_skips_hunk_and_blank`, `rows_parallel_text_and_mark_kinds`, and all existing CLI tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/cli/src/ui/diff.rs src-tauri/cli/src/ui/detail.rs src-tauri/cli/src/app.rs
git commit -m "feat(cli): diff row metadata + line cursor"
```

---

## Task 6: `$EDITOR` module

**Files:**
- Create: `src-tauri/cli/src/editor.rs`
- Modify: `src-tauri/cli/src/main.rs:3-13`

- [ ] **Step 1: Register the module**

In `src-tauri/cli/src/main.rs`, add to the `mod` list (alphabetically near the others):

```rust
mod comments;
mod editor;
```

(`comments` module is created in Task 7; adding both now avoids a second edit. If `comments.rs` does not yet exist when you build this task, create an empty `src-tauri/cli/src/comments.rs` with `//! CLI comment orchestration.` as a placeholder header — Task 7 fills it.)

- [ ] **Step 2: Write the cancel-decision test**

Create `src-tauri/cli/src/editor.rs`:

```rust
//! Compose text in the user's $EDITOR by suspending and restoring the TUI.

use std::io::{self, Write};

/// Decide the result body from raw editor output: strip lines starting with `#`,
/// trim, and treat an empty result as a cancel (`None`). Pure so it is testable.
fn finalize_body(raw: &str) -> Option<String> {
    let kept: Vec<&str> = raw
        .lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .collect();
    let body = kept.join("\n").trim().to_string();
    if body.is_empty() {
        None
    } else {
        Some(body)
    }
}

#[cfg(test)]
mod tests {
    use super::finalize_body;

    #[test]
    fn strips_comment_lines_and_trims() {
        assert_eq!(
            finalize_body("# banner\nhello\n\n# tail\n").as_deref(),
            Some("hello")
        );
    }

    #[test]
    fn empty_is_cancel() {
        assert_eq!(finalize_body("# only banner\n   \n"), None);
    }

    #[test]
    fn keeps_code_with_hash_inside() {
        assert_eq!(finalize_body("let x = \"#fff\";").as_deref(), Some("let x = \"#fff\";"));
    }
}
```

- [ ] **Step 3: Run the test**

Run: `cargo test -p ultra-gitlab-cli editor`
Expected: 3 tests pass.

- [ ] **Step 4: Add `compose` (terminal suspend/restore + editor spawn)**

Append to `editor.rs`:

```rust
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};

/// Suspend the TUI, open `seed` in $EDITOR (temp file named with `ext`), restore
/// the TUI, and return the finalized body (`None` = cancelled / empty).
///
/// `strip_comments` controls whether `#`-prefixed lines are dropped: true for
/// comment/reply bodies (which carry a `#` banner), false for suggestion seeds
/// (which are real source that may legitimately start with `#`).
pub fn compose(seed: &str, ext: &str, strip_comments: bool) -> io::Result<Option<String>> {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    path.push(format!("ultra-comment-{pid}.{ext}"));
    {
        let mut f = std::fs::File::create(&path)?;
        f.write_all(seed.as_bytes())?;
    }

    // Leave the alternate screen so the editor owns the terminal.
    disable_raw_mode()?;
    crossterm::execute!(io::stdout(), LeaveAlternateScreen)?;

    let editor = std::env::var("VISUAL")
        .or_else(|_| std::env::var("EDITOR"))
        .unwrap_or_else(|_| if cfg!(windows) { "notepad".into() } else { "vi".into() });
    let status = std::process::Command::new(&editor).arg(&path).status();

    // Re-enter the alternate screen for the TUI.
    enable_raw_mode()?;
    crossterm::execute!(io::stdout(), EnterAlternateScreen)?;

    status?; // propagate spawn/wait errors after restoring the terminal

    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    Ok(if strip_comments {
        finalize_body(&raw)
    } else {
        let t = raw.trim_end_matches('\n').to_string();
        if t.trim().is_empty() { None } else { Some(t) }
    })
}
```

- [ ] **Step 5: Build**

Run: `cargo check -p ultra-gitlab-cli`
Expected: compiles (the `compose` fn is unused until Task 7 — allow the dead-code warning, it resolves next task).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/cli/src/editor.rs src-tauri/cli/src/main.rs src-tauri/cli/src/comments.rs
git commit -m "feat(cli): \$EDITOR compose helper with suspend/restore"
```

---

## Task 7: Wire general comments end-to-end

**Files:**
- Modify: `src-tauri/cli/src/comments.rs`
- Modify: `src-tauri/cli/src/app.rs`
- Modify: `src-tauri/cli/src/event.rs`
- Modify: `src-tauri/cli/src/ui/footer.rs`

- [ ] **Step 1: Define `PendingCompose` and the dispatch helper**

Replace the placeholder `src-tauri/cli/src/comments.rs` with:

```rust
//! CLI comment orchestration: what to compose, and posting the result.

use crate::app::App;
use crate::event::AppEvent;
use ultra_gitlab_lib::core::comments;

/// A compose request raised by a keypress, performed by the run loop (which owns
/// the terminal) after the key handler returns.
#[derive(Debug, Clone)]
pub enum PendingCompose {
    General { mr_id: i64 },
    Inline {
        mr_id: i64,
        file_path: String,
        old_line: Option<i64>,
        new_line: Option<i64>,
    },
    Reply { mr_id: i64, discussion_id: String },
}

/// Seed text + temp-file extension + comment-stripping flag for a compose.
pub fn seed_for(p: &PendingCompose, iid: i64) -> (String, &'static str, bool) {
    match p {
        PendingCompose::General { .. } => {
            (format!("# General comment on MR !{iid}\n# Lines starting with # are ignored.\n\n"), "md", true)
        }
        PendingCompose::Inline { file_path, new_line, old_line, .. } => {
            let line = new_line.or(*old_line).unwrap_or(0);
            (format!("# Inline comment on {file_path}:{line}\n# Lines starting with # are ignored.\n\n"), "md", true)
        }
        PendingCompose::Reply { .. } => {
            ("# Reply\n# Lines starting with # are ignored.\n\n".to_string(), "md", true)
        }
    }
}

/// Spawn the background task that posts a composed comment body.
pub fn post(app: &App, p: PendingCompose, body: String) {
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let result = run_post(&pool, p, body).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::CommentPosted(result));
    });
}

async fn run_post(
    pool: &ultra_gitlab_lib::db::pool::DbPool,
    p: PendingCompose,
    body: String,
) -> Result<i64, ultra_gitlab_lib::error::AppError> {
    match p {
        PendingCompose::General { mr_id } => {
            comments::post_general_comment(pool, mr_id, &body).await?;
            Ok(mr_id)
        }
        PendingCompose::Inline { mr_id, file_path, old_line, new_line } => {
            let refs = comments::diff_refs_from_cache(pool, mr_id)
                .await?
                .ok_or_else(|| ultra_gitlab_lib::error::AppError::not_found("diff refs"))?;
            comments::post_inline_comment(pool, mr_id, &body, &file_path, old_line, new_line, &refs).await?;
            Ok(mr_id)
        }
        PendingCompose::Reply { mr_id, discussion_id } => {
            comments::reply(pool, mr_id, &discussion_id, &body).await?;
            Ok(mr_id)
        }
    }
}
```

(The `Inline` cache-only refs lookup is replaced in Task 9 to also use live refs; this is the minimal version so general comments ship now.)

- [ ] **Step 2: Add the event variant**

In `src-tauri/cli/src/event.rs`, add to `enum AppEvent`:

```rust
    /// Result of posting a comment/reply (Ok(mr_id) to refresh, or error).
    CommentPosted(Result<i64, String>),
```

- [ ] **Step 3: Add `pending` state + run-loop handling**

In `app.rs`, add to `struct App` (after `diff_select_anchor`):

```rust
    /// A compose request to run after the current key handler returns.
    pub pending: Option<crate::comments::PendingCompose>,
```

Initialize in `App::new`: `pending: None,`.

In the `run` loop, after `handle_key(&mut app, key.code);` returns and before the redraw, drain the pending compose. Replace the key branch in the `tokio::select!`:

```rust
                if let Some(Ok(Event::Key(key))) = maybe_key {
                    if key.kind == KeyEventKind::Press {
                        handle_key(&mut app, key.code);
                        if let Some(p) = app.pending.take() {
                            run_compose(&mut terminal, &mut app, p)?;
                        }
                    }
                }
```

Add the `run_compose` function to `app.rs`:

```rust
/// Suspend the TUI, run the editor for a pending compose, and dispatch the post.
fn run_compose(
    terminal: &mut DefaultTerminal,
    app: &mut App,
    p: crate::comments::PendingCompose,
) -> anyhow::Result<()> {
    let iid = app.detail.as_ref().map(|d| d.row.iid).unwrap_or(0);
    let (seed, ext, strip) = crate::comments::seed_for(&p, iid);
    match crate::editor::compose(&seed, ext, strip)? {
        Some(body) => {
            crate::comments::post(app, p, body);
            app.busy = true;
            app.status = "Posting comment…".into();
        }
        None => app.status = "Cancelled".into(),
    }
    app.force_clear = true;
    terminal.clear()?;
    Ok(())
}
```

Handle the new event in `handle_event`:

```rust
        AppEvent::CommentPosted(Ok(_mr_id)) => {
            app.busy = false;
            app.status = "Comment posted".into();
        }
        AppEvent::CommentPosted(Err(e)) => {
            app.busy = false;
            app.status = format!("Comment failed: {e}");
        }
```

- [ ] **Step 4: Bind `c` (general comment) in Tree focus**

In `handle_detail_key`, add a `c` arm before the catch-all `other =>` branch:

```rust
        KeyCode::Char('c') if app.focus == Focus::Tree => {
            if let Some(d) = &app.detail {
                app.pending = Some(crate::comments::PendingCompose::General { mr_id: d.row.id });
            }
        }
```

- [ ] **Step 5: Update the footer hint**

In `src-tauri/cli/src/ui/footer.rs`, append ` · c comment` to the `Tab::Review` and `Tab::Mine` detail-screen hint strings (the two arms under `match app.tab` in the `Screen::Detail` non-pipeline branch).

- [ ] **Step 6: Build, test, and manually verify**

Run: `cargo test -p ultra-gitlab-cli`
Expected: compiles, all tests pass.

Manual check (uses real credentials per CLAUDE.md): `cargo run -p ultra-gitlab-cli`, open an MR, press `c` in the file tree, write a comment, `:wq`. Status shows "Comment posted". Verify the comment appears in GitLab.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/cli/src/comments.rs src-tauri/cli/src/app.rs src-tauri/cli/src/event.rs src-tauri/cli/src/ui/footer.rs
git commit -m "feat(cli): post general MR comments via \$EDITOR"
```

---

# Phase 3 — Inline comments

## Task 8: Visual-range toggle

**Files:**
- Modify: `src-tauri/cli/src/app.rs`
- Modify: `src-tauri/cli/src/ui/footer.rs`

- [ ] **Step 1: Bind `v` in Diff focus**

In `handle_detail_key`, add before the catch-all:

```rust
        KeyCode::Char('v') if app.focus == Focus::Diff => {
            app.diff_select_anchor = match app.diff_select_anchor {
                Some(_) => None,
                None => Some(app.diff_cursor),
            };
        }
```

Range highlight already renders via `diff_selection_bounds` (Task 5). Moving the cursor with `j`/`k` extends the range because the anchor stays fixed.

- [ ] **Step 2: Footer hint**

Append ` · v select` to the `Tab::Review`/`Tab::Mine` detail hints in `footer.rs`.

- [ ] **Step 3: Build + manual check**

Run: `cargo check -p ultra-gitlab-cli`
Expected: compiles. Manually: in Diff focus press `v`, move with `j`, see the range highlight grow; press `v` again to clear.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/app.rs src-tauri/cli/src/ui/footer.rs
git commit -m "feat(cli): visual range selection in the diff"
```

---

## Task 9: Inline comment posting + live diff refs

**Files:**
- Modify: `src-tauri/src/core/mr_actions.rs:130-175`
- Modify: `src-tauri/cli/src/data.rs`
- Modify: `src-tauri/cli/src/comments.rs`
- Modify: `src-tauri/cli/src/app.rs`

- [ ] **Step 1: Make `get_live_diff` also return the version SHAs**

In `src-tauri/src/core/mr_actions.rs`, change `get_live_diff` to return both files and refs. Replace its signature/return:

```rust
/// Fetch an MR's diff live from GitLab. Returns per-file unified diffs plus the
/// version SHAs (needed to position inline comments on a live-only diff).
pub async fn get_live_diff(
    pool: &DbPool,
    mr_id: i64,
) -> Result<(Vec<LiveDiffFile>, crate::core::comments::DiffRefs), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    let version = client.get_merge_request_diff(project_id, iid).await?;
    let refs = crate::core::comments::DiffRefs {
        base_sha: version.base_commit_sha.clone(),
        head_sha: version.head_commit_sha.clone(),
        start_sha: version.start_commit_sha.clone(),
    };
    let files = version
        .diffs
        .into_iter()
        .map(|d| LiveDiffFile {
            change_type: if d.new_file {
                "added"
            } else if d.deleted_file {
                "deleted"
            } else if d.renamed_file {
                "renamed"
            } else {
                "modified"
            }
            .to_string(),
            old_path: if d.old_path == d.new_path { None } else { Some(d.old_path) },
            new_path: d.new_path,
            diff_content: d.diff,
        })
        .collect();
    Ok((files, refs))
}
```

- [ ] **Step 2: Thread refs through `DetailData`**

In `src-tauri/cli/src/data.rs`:

Add to `struct DetailData`:

```rust
    /// SHAs needed to position inline comments (cache row or live version).
    pub diff_refs: Option<ultra_gitlab_lib::core::comments::DiffRefs>,
```

Update `load_detail` to populate it in both branches:

```rust
pub async fn load_detail(pool: &DbPool, mr_id: i64) -> Result<DetailData, AppError> {
    let detail = mr_query::get_detail(pool, mr_id).await?;
    let row = MrRow::from(detail.mr);
    if detail.diff_files.is_empty() {
        let (live, refs) = mr_actions::get_live_diff(pool, mr_id).await?;
        Ok(DetailData {
            row,
            files: live.into_iter().map(FileDiff::from).collect(),
            live: true,
            diff_refs: Some(refs),
        })
    } else {
        let diff_refs = detail.diff.as_ref().map(|d| ultra_gitlab_lib::core::comments::DiffRefs {
            base_sha: d.base_sha.clone(),
            head_sha: d.head_sha.clone(),
            start_sha: d.start_sha.clone(),
        });
        Ok(DetailData {
            row,
            files: detail.diff_files.into_iter().map(FileDiff::from).collect(),
            live: false,
            diff_refs,
        })
    }
}
```

Confirm `Diff` exposes `base_sha`/`head_sha`/`start_sha` as `String`: `grep -n "pub base_sha\|pub head_sha\|pub start_sha" src-tauri/src/models/*.rs`. If they are `Option<String>`, map with `.clone().unwrap_or_default()` and only build `DiffRefs` when all three are present.

- [ ] **Step 3: Use live-or-cache refs when posting inline**

In `src-tauri/cli/src/comments.rs`, change `PendingCompose::Inline` to carry the refs directly (the key handler has them from `app.detail`), removing the cache-only lookup. Update the enum variant:

```rust
    Inline {
        mr_id: i64,
        file_path: String,
        old_line: Option<i64>,
        new_line: Option<i64>,
        refs: comments::DiffRefs,
    },
```

In `run_post`, replace the `Inline` arm:

```rust
        PendingCompose::Inline { mr_id, file_path, old_line, new_line, refs } => {
            comments::post_inline_comment(pool, mr_id, &body, &file_path, old_line, new_line, &refs).await?;
            Ok(mr_id)
        }
```

Update `seed_for`'s `Inline` arm pattern to `PendingCompose::Inline { file_path, new_line, old_line, .. }` (already uses `..`, so it still matches).

- [ ] **Step 4: Add position derivation with a test**

Add to `comments.rs`:

```rust
use crate::ui::diff::{RowKind, RowMeta};

/// Derive the inline-comment position from a selected diff row. Suggestions and
/// comments attach to a single anchor row (the range's last row). Added/context
/// rows use `new_line`; deletion rows use `old_line`. Returns `None` for a
/// non-selectable row.
pub fn position_for(row: &RowMeta) -> Option<(Option<i64>, Option<i64>)> {
    match row.kind {
        RowKind::Add => Some((None, row.new_line)),
        RowKind::Context => Some((row.old_line, row.new_line)),
        RowKind::Remove => Some((row.old_line, None)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::position_for;
    use crate::ui::diff::{RowKind, RowMeta};

    #[test]
    fn added_line_uses_new_only() {
        let r = RowMeta { kind: RowKind::Add, old_line: None, new_line: Some(5) };
        assert_eq!(position_for(&r), Some((None, Some(5))));
    }

    #[test]
    fn deleted_line_uses_old_only() {
        let r = RowMeta { kind: RowKind::Remove, old_line: Some(7), new_line: None };
        assert_eq!(position_for(&r), Some((Some(7), None)));
    }

    #[test]
    fn context_line_uses_both() {
        let r = RowMeta { kind: RowKind::Context, old_line: Some(3), new_line: Some(4) };
        assert_eq!(position_for(&r), Some((Some(3), Some(4))));
    }
}
```

- [ ] **Step 5: Bind `c` in Diff focus**

In `app.rs` `handle_detail_key`, extend the `c` handling. Replace the Tree-only `c` arm from Task 7 with a focus-aware pair:

```rust
        KeyCode::Char('c') if app.focus == Focus::Tree => {
            if let Some(d) = &app.detail {
                app.pending = Some(crate::comments::PendingCompose::General { mr_id: d.row.id });
            }
        }
        KeyCode::Char('c') if app.focus == Focus::Diff => {
            start_inline_comment(app);
        }
```

Add the helper to `app.rs`:

```rust
/// Build a pending inline-comment compose from the cursor's anchor row.
fn start_inline_comment(app: &mut App) {
    let Some(d) = &app.detail else { return };
    let Some(refs) = d.diff_refs.clone() else {
        app.status = "No diff refs available for inline comments".into();
        return;
    };
    let sel = app.file_state.selected().unwrap_or(0);
    let Some(file) = d.files.get(sel) else { return };
    // Anchor is the last row of the selection (matches the desktop default).
    let (_, hi) = app.diff_selection_bounds();
    let Some(row) = app.diff_rows.get(hi) else { return };
    let Some((old_line, new_line)) = crate::comments::position_for(row) else {
        app.status = "Pick a code line to comment on".into();
        return;
    };
    app.pending = Some(crate::comments::PendingCompose::Inline {
        mr_id: d.row.id,
        file_path: file.new_path.clone(),
        old_line,
        new_line,
        refs,
    });
}
```

- [ ] **Step 6: Build, test, manual check**

Run: `cargo test -p ultra-gitlab-cli && cargo test -p ultra-gitlab core::comments`
Expected: all pass. Manual: open an MR, focus the diff, move the cursor to a changed line, press `c`, write a comment, `:wq`; confirm the inline comment lands on the right line in GitLab.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/core/mr_actions.rs src-tauri/cli/src/data.rs src-tauri/cli/src/comments.rs src-tauri/cli/src/app.rs
git commit -m "feat(cli): inline comments with live/cached diff refs"
```

---

# Phase 4 — Suggestions

## Task 10: Suggestion seed extraction

**Files:**
- Modify: `src-tauri/cli/src/comments.rs`

- [ ] **Step 1: Add new-side line extraction + guard with a test**

Add to `comments.rs`:

```rust
/// Extract the new-side source lines covered by the cursor/range, plus the
/// suggestion anchor's new line number. Returns `None` if the selection has no
/// new-side line (pure deletions — GitLab suggestions replace new-file content).
///
/// `rows` is the diff's row metadata; `lo`/`hi` are inclusive row indices.
pub fn suggestion_seed(rows: &[RowMeta], lo: usize, hi: usize) -> Option<SuggestionSeed> {
    let mut new_lines: Vec<i64> = Vec::new();
    for row in &rows[lo..=hi.min(rows.len().saturating_sub(1))] {
        if matches!(row.kind, RowKind::Add | RowKind::Context) {
            if let Some(n) = row.new_line {
                new_lines.push(n);
            }
        }
    }
    let start = *new_lines.first()?;
    let end = *new_lines.last()?;
    Some(SuggestionSeed { start_line: start, end_line: end, anchor_line: end })
}

/// New-side line span for a suggestion; anchor is the line GitLab attaches to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SuggestionSeed {
    pub start_line: i64,
    pub end_line: i64,
    pub anchor_line: i64,
}

#[cfg(test)]
mod suggestion_tests {
    use super::suggestion_seed;
    use crate::ui::diff::{RowKind, RowMeta};

    fn add(n: i64) -> RowMeta { RowMeta { kind: RowKind::Add, old_line: None, new_line: Some(n) } }
    fn del() -> RowMeta { RowMeta { kind: RowKind::Remove, old_line: Some(9), new_line: None } }

    #[test]
    fn spans_new_lines_anchor_at_end() {
        let rows = vec![add(13), add(14), add(15)];
        let s = super::suggestion_seed(&rows, 0, 2).unwrap();
        assert_eq!((s.start_line, s.end_line, s.anchor_line), (13, 15, 15));
    }

    #[test]
    fn pure_deletion_has_no_seed() {
        let rows = vec![del(), del()];
        assert!(suggestion_seed(&rows, 0, 1).is_none());
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cargo test -p ultra-gitlab-cli comments`
Expected: suggestion tests + earlier `comments` tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/cli/src/comments.rs
git commit -m "feat(cli): suggestion seed extraction from diff selection"
```

---

## Task 11: Suggestion preview overlay + post

**Files:**
- Modify: `src-tauri/cli/src/app.rs`
- Modify: `src-tauri/cli/src/comments.rs`
- Modify: `src-tauri/cli/src/ui/detail.rs`
- Modify: `src-tauri/cli/src/ui/footer.rs`

- [ ] **Step 1: Add suggestion-preview state**

In `app.rs`, add a struct and an `App` field:

```rust
/// State for the suggestion preview overlay (after editing, before posting).
#[derive(Debug, Clone)]
pub struct SuggestionPreview {
    pub mr_id: i64,
    pub file_path: String,
    pub original: String,
    pub edited: String,
    pub above: i64,
    pub below: i64,
    pub anchor_old: Option<i64>,
    pub anchor_new: Option<i64>,
    pub refs: ultra_gitlab_lib::core::comments::DiffRefs,
    /// Optional accompanying message note typed via `m`.
    pub message: Option<String>,
}
```

Add to `struct App`: `pub suggestion: Option<SuggestionPreview>,` and init `suggestion: None,`.

- [ ] **Step 2: Raise a suggestion compose on `s` (Diff focus)**

`s` needs the editor first (to edit the seed), so add a `PendingCompose::Suggestion` variant carrying everything needed to build the preview after editing. In `comments.rs`:

```rust
    Suggestion {
        mr_id: i64,
        file_path: String,
        original: String,
        above: i64,
        below: i64,
        anchor_old: Option<i64>,
        anchor_new: Option<i64>,
        refs: comments::DiffRefs,
    },
```

In `seed_for`, add its arm (seed is the original code, extension = file's, **no** comment stripping):

```rust
        PendingCompose::Suggestion { original, file_path, .. } => {
            let ext = file_path.rsplit('.').next().unwrap_or("txt").to_string();
            // ext must be 'static for the return type; fall back to a small set.
            let ext: &'static str = match ext.as_str() {
                "rs" => "rs", "ts" => "ts", "tsx" => "tsx", "js" => "js", "jsx" => "jsx",
                "py" => "py", "go" => "go", "json" => "json", "css" => "css", "html" => "html",
                "md" => "md", "toml" => "toml", "yaml" | "yml" => "yaml",
                _ => "txt",
            };
            (original.clone(), ext, false)
        }
```

In `app.rs`, add the `s` key arm and helper:

```rust
        KeyCode::Char('s') if app.focus == Focus::Diff => start_suggestion(app),
```

```rust
fn start_suggestion(app: &mut App) {
    let Some(d) = &app.detail else { return };
    let Some(refs) = d.diff_refs.clone() else {
        app.status = "No diff refs available for suggestions".into();
        return;
    };
    let sel = app.file_state.selected().unwrap_or(0);
    let Some(file) = d.files.get(sel) else { return };
    let (lo, hi) = app.diff_selection_bounds();
    let Some(seed) = crate::comments::suggestion_seed(&app.diff_rows, lo, hi) else {
        app.status = "Suggestions need a new-side line (not a pure deletion)".into();
        return;
    };
    // Gather the original new-side text from the selected rows for the preview.
    let original = crate::comments::selection_text(&app.diff_rows, &file.diff_content, lo, hi);
    let (above, below) = ultra_gitlab_lib::core::comments::suggestion_offsets(
        seed.start_line, seed.end_line, seed.anchor_line,
    );
    app.pending = Some(crate::comments::PendingCompose::Suggestion {
        mr_id: d.row.id,
        file_path: file.new_path.clone(),
        original,
        above,
        below,
        anchor_old: None,
        anchor_new: Some(seed.anchor_line),
        refs,
    });
}
```

Add `selection_text` to `comments.rs` (pulls the new-side content for the rows; reuses the unified-diff parser already used by the renderer):

```rust
/// Concatenate the new-side content of rows `lo..=hi` from the file's unified
/// diff (added + context lines), for seeding the editor and the preview.
pub fn selection_text(rows: &[RowMeta], diff_content: &str, lo: usize, hi: usize) -> String {
    use ultra_gitlab_lib::commands::mr::parse_unified_diff_public;
    // Flatten the diff into the same row order the renderer used: hunk header,
    // body lines, trailing blank — so row indices line up with `rows`.
    let hunks = parse_unified_diff_public(diff_content);
    let mut flat: Vec<Option<String>> = Vec::new();
    for h in &hunks {
        flat.push(None); // hunk header row
        for dl in &h.lines {
            let is_new_side = dl.line_type == "add" || dl.line_type != "remove";
            flat.push(if is_new_side { Some(dl.content.clone()) } else { None });
        }
        flat.push(None); // trailing blank row
    }
    let hi = hi.min(flat.len().saturating_sub(1));
    let mut out: Vec<String> = Vec::new();
    for (i, cell) in flat.iter().enumerate() {
        if i >= lo && i <= hi {
            if let Some(text) = cell {
                // Only include rows that are selectable code lines.
                if rows.get(i).map(|r| r.selectable()).unwrap_or(false) {
                    out.push(text.clone());
                }
            }
        }
    }
    out.join("\n")
}
```

- [ ] **Step 3: After editing a suggestion, open the preview instead of posting**

In `app.rs` `run_compose`, special-case the suggestion variant:

```rust
fn run_compose(
    terminal: &mut DefaultTerminal,
    app: &mut App,
    p: crate::comments::PendingCompose,
) -> anyhow::Result<()> {
    let iid = app.detail.as_ref().map(|d| d.row.iid).unwrap_or(0);
    let (seed, ext, strip) = crate::comments::seed_for(&p, iid);
    let edited = crate::editor::compose(&seed, ext, strip)?;
    app.force_clear = true;
    terminal.clear()?;
    match (p, edited) {
        (_, None) => app.status = "Cancelled".into(),
        (crate::comments::PendingCompose::Suggestion {
            mr_id, file_path, original, above, below, anchor_old, anchor_new, refs,
        }, Some(edited)) => {
            app.suggestion = Some(crate::app::SuggestionPreview {
                mr_id, file_path, original, edited, above, below, anchor_old, anchor_new, refs, message: None,
            });
        }
        (p, Some(body)) => {
            crate::comments::post(app, p, body);
            app.busy = true;
            app.status = "Posting comment…".into();
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Render the preview overlay**

In `src-tauri/cli/src/ui/detail.rs`, at the end of `render`, draw the overlay if present:

```rust
    if let Some(prev) = app.suggestion.clone() {
        render_suggestion_preview(f, &prev, area);
    }
```

Add the function (a centered bordered box; before/after lines + the suggestion block):

```rust
fn render_suggestion_preview(f: &mut Frame, p: &crate::app::SuggestionPreview, area: Rect) {
    use ultra_gitlab_lib::core::comments::build_suggestion_block;
    let block_text = build_suggestion_block(&p.edited, p.above, p.below);
    let mut lines: Vec<Line> = Vec::new();
    for l in p.original.lines() {
        lines.push(Line::from(Span::styled(format!("- {l}"), Style::default().fg(Color::Red))));
    }
    for l in p.edited.lines() {
        lines.push(Line::from(Span::styled(format!("+ {l}"), Style::default().fg(Color::Green))));
    }
    lines.push(Line::from(""));
    if let Some(m) = &p.message {
        lines.push(Line::from(Span::styled(format!("message: {m}"), Style::default().fg(Color::Cyan))));
        lines.push(Line::from(""));
    }
    for l in block_text.lines() {
        lines.push(Line::from(Span::styled(l.to_string(), Style::default().fg(Color::DarkGray))));
    }
    let title = format!(" Suggestion preview · {} ", p.file_path);
    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .title_bottom(" p:post  e:edit  m:message  esc:cancel ")
        .border_style(Style::default().fg(Color::Cyan));
    // Centered popup covering most of the area.
    let w = area.width.saturating_sub(8).min(100);
    let h = (lines.len() as u16 + 2).min(area.height.saturating_sub(4));
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };
    f.render_widget(ratatui::widgets::Clear, popup);
    f.render_widget(Paragraph::new(lines).block(block).wrap(Wrap { trim: false }), popup);
}
```

- [ ] **Step 5: Handle preview keys**

In `app.rs` `handle_key`, intercept when the preview is open (place this near the top, after the pipeline/confirm interceptors):

```rust
    if app.suggestion.is_some() {
        handle_suggestion_key(app, code);
        return;
    }
```

Add the handler:

```rust
fn handle_suggestion_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Char('p') => {
            if let Some(p) = app.suggestion.take() {
                let body = build_suggestion_body(&p);
                let pending = crate::comments::PendingCompose::Inline {
                    mr_id: p.mr_id,
                    file_path: p.file_path,
                    old_line: p.anchor_old,
                    new_line: p.anchor_new,
                    refs: p.refs,
                };
                crate::comments::post(app, pending, body);
                app.busy = true;
                app.status = "Posting suggestion…".into();
            }
        }
        KeyCode::Char('e') => {
            // Re-open the editor on the edited content; rebuild the preview.
            if let Some(p) = app.suggestion.take() {
                app.pending = Some(crate::comments::PendingCompose::Suggestion {
                    mr_id: p.mr_id,
                    file_path: p.file_path,
                    original: p.edited, // edit again starts from the current edit
                    above: p.above,
                    below: p.below,
                    anchor_old: p.anchor_old,
                    anchor_new: p.anchor_new,
                    refs: p.refs,
                });
            }
        }
        KeyCode::Char('m') => {
            // Compose an accompanying message; reuse the General editor flow but
            // keep the preview by stashing it back after editing.
            app.suggestion_message_pending = true;
        }
        KeyCode::Esc => {
            app.suggestion = None;
            app.status = "Cancelled".into();
        }
        _ => {}
    }
}

/// Combine the optional message note and the suggestion block into one note body.
fn build_suggestion_body(p: &SuggestionPreview) -> String {
    use ultra_gitlab_lib::core::comments::build_suggestion_block;
    let block = build_suggestion_block(&p.edited, p.above, p.below);
    match &p.message {
        Some(m) if !m.is_empty() => format!("{m}\n\n{block}"),
        _ => block,
    }
}
```

For the `m` message step, add `pub suggestion_message_pending: bool,` to `App` (init `false`), and in the `run` loop, after handling a key, before draining `pending`, handle it:

```rust
                        if app.suggestion_message_pending {
                            app.suggestion_message_pending = false;
                            if let Some(mut p) = app.suggestion.take() {
                                match crate::editor::compose(
                                    "# Message to accompany the suggestion\n\n", "md", true,
                                )? {
                                    Some(m) => p.message = Some(m),
                                    None => {}
                                }
                                app.suggestion = Some(p);
                                app.force_clear = true;
                                terminal.clear()?;
                            }
                        }
```

- [ ] **Step 6: Footer hint**

Append ` · s suggest` to the `Tab::Review`/`Tab::Mine` detail hints in `footer.rs`.

- [ ] **Step 7: Build, test, manual check**

Run: `cargo test -p ultra-gitlab-cli`
Expected: compiles, all pass. Manual: select a changed line/range in the diff, press `s`, edit the code, `:wq`; the preview overlay shows before/after + the `suggestion` block; press `m` to add a message, then `p` to post; verify the suggestion renders on GitLab with an "Apply suggestion" button.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/cli/src/app.rs src-tauri/cli/src/comments.rs src-tauri/cli/src/ui/detail.rs src-tauri/cli/src/ui/footer.rs
git commit -m "feat(cli): \$EDITOR suggestion flow with preview overlay"
```

---

# Phase 5 — Threads overlay & gutter markers

## Task 12: Fetch and display discussions

**Files:**
- Modify: `src-tauri/cli/src/event.rs`
- Modify: `src-tauri/cli/src/app.rs`
- Modify: `src-tauri/cli/src/ui/detail.rs`
- Modify: `src-tauri/cli/src/ui/footer.rs`

- [ ] **Step 1: Add the event + state**

In `event.rs`, add:

```rust
    /// Live-fetched discussions for the open MR detail.
    Discussions(Result<Vec<ultra_gitlab_lib::core::comments::Thread>, String>),
```

In `app.rs` `struct App`, add:

```rust
    pub discussions: Option<Vec<ultra_gitlab_lib::core::comments::Thread>>,
    pub overlay: Option<CommentsOverlay>,
```

Add the overlay struct and init (`discussions: None, overlay: None,`):

```rust
/// State for the discussions overlay.
#[derive(Debug, Clone)]
pub struct CommentsOverlay {
    pub state: ratatui::widgets::ListState,
}
```

- [ ] **Step 2: Fetch discussions when opening a detail**

In `open_detail` (app.rs), after the pipelines spawn, add a discussions spawn:

```rust
    let pool3 = app.pool.clone();
    let tx3 = app.tx.clone();
    tokio::spawn(async move {
        let r = ultra_gitlab_lib::core::comments::list_discussions(&pool3, mr_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx3.send(AppEvent::Discussions(r));
    });
```

Handle it in `handle_event`:

```rust
        AppEvent::Discussions(Ok(threads)) => {
            app.discussions = Some(threads);
        }
        AppEvent::Discussions(Err(e)) => {
            app.status = format!("Discussions: {e}");
        }
```

Reset on leaving detail: in the `Esc`/`q` detail arm where `app.detail = None;`, add `app.discussions = None; app.overlay = None;`.

- [ ] **Step 3: Open/close the overlay with `C`**

In `handle_detail_key`, add (works in any focus):

```rust
        KeyCode::Char('C') => {
            if app.overlay.is_some() {
                app.overlay = None;
            } else {
                let mut state = ratatui::widgets::ListState::default();
                state.select(Some(0));
                app.overlay = Some(CommentsOverlay { state });
            }
            app.force_clear = true;
        }
```

When the overlay is open, route `j`/`k`/`esc` to it first. At the top of `handle_detail_key`, add:

```rust
    if app.overlay.is_some() {
        match code {
            KeyCode::Esc | KeyCode::Char('C') => { app.overlay = None; app.force_clear = true; }
            KeyCode::Char('j') | KeyCode::Down => overlay_move(app, 1),
            KeyCode::Char('k') | KeyCode::Up => overlay_move(app, -1),
            _ => {}
        }
        return;
    }
```

Add `overlay_move`:

```rust
fn overlay_move(app: &mut App, delta: i32) {
    let len = app.discussions.as_ref().map(|d| d.len()).unwrap_or(0);
    if len == 0 { return; }
    if let Some(o) = app.overlay.as_mut() {
        let cur = o.state.selected().unwrap_or(0) as i32;
        let next = (cur + delta).clamp(0, len as i32 - 1) as usize;
        o.state.select(Some(next));
    }
}
```

- [ ] **Step 4: Render the overlay**

In `detail.rs` `render`, after the suggestion-preview block:

```rust
    if app.overlay.is_some() {
        render_discussions(f, app, area);
    }
```

Add:

```rust
fn render_discussions(f: &mut Frame, app: &mut App, area: Rect) {
    let threads = app.discussions.clone().unwrap_or_default();
    let items: Vec<ListItem> = if threads.is_empty() {
        vec![ListItem::new("No discussions")]
    } else {
        threads
            .iter()
            .map(|t| {
                let loc = match (&t.file_path, t.new_line.or(t.old_line)) {
                    (Some(f), Some(l)) => format!("{f}:{l}"),
                    _ => "General".to_string(),
                };
                let status = if t.resolvable {
                    if t.resolved { "  [resolved]" } else { "  [unresolved]" }
                } else { "" };
                let mut lines = vec![Line::from(vec![
                    Span::styled(loc, Style::default().fg(Color::Blue)),
                    Span::styled(status.to_string(), Style::default().fg(Color::DarkGray)),
                ])];
                for n in t.notes.iter().filter(|n| !n.system) {
                    let first = n.body.lines().next().unwrap_or("");
                    lines.push(Line::from(format!("  @{}: {}", n.author, first)));
                }
                ListItem::new(lines)
            })
            .collect()
    };
    let w = area.width.saturating_sub(6).min(110);
    let h = area.height.saturating_sub(4);
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };
    let block = Block::default()
        .borders(Borders::ALL)
        .title(format!(" Discussions ({}) ", threads.len()))
        .title_bottom(" j/k move · r reply · R resolve · esc close ")
        .border_style(Style::default().fg(Color::Cyan));
    f.render_widget(ratatui::widgets::Clear, popup);
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    if let Some(o) = app.overlay.as_mut() {
        f.render_stateful_widget(list, popup, &mut o.state);
    }
}
```

- [ ] **Step 5: Footer hint**

Append ` · C threads` to the `Tab::Review`/`Tab::Mine` detail hints in `footer.rs`.

- [ ] **Step 6: Build + manual check**

Run: `cargo test -p ultra-gitlab-cli`
Expected: compiles, tests pass. Manual: open an MR with discussions, press `C`; the overlay lists general + inline threads; `j`/`k` navigate; `esc` closes.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/cli/src/event.rs src-tauri/cli/src/app.rs src-tauri/cli/src/ui/detail.rs src-tauri/cli/src/ui/footer.rs
git commit -m "feat(cli): discussions overlay in MR detail"
```

---

## Task 13: Reply and resolve from the overlay

**Files:**
- Modify: `src-tauri/cli/src/app.rs`
- Modify: `src-tauri/cli/src/comments.rs`

- [ ] **Step 1: Reply (`r`) raises a compose for the selected thread**

In `handle_detail_key`'s overlay branch (Task 12 Step 3), add `r` and `R` arms:

```rust
            KeyCode::Char('r') => {
                if let (Some(d), Some(o)) = (&app.detail, &app.overlay) {
                    if let Some(threads) = &app.discussions {
                        if let Some(t) = threads.get(o.state.selected().unwrap_or(0)) {
                            app.pending = Some(crate::comments::PendingCompose::Reply {
                                mr_id: d.row.id,
                                discussion_id: t.id.clone(),
                            });
                        }
                    }
                }
            }
            KeyCode::Char('R') => resolve_selected_thread(app),
```

- [ ] **Step 2: Resolve toggle posts directly and re-fetches**

Add to `app.rs`:

```rust
fn resolve_selected_thread(app: &mut App) {
    let (Some(d), Some(o)) = (&app.detail, &app.overlay) else { return };
    let Some(threads) = &app.discussions else { return };
    let Some(t) = threads.get(o.state.selected().unwrap_or(0)) else { return };
    if !t.resolvable {
        app.status = "Thread is not resolvable".into();
        return;
    }
    let mr_id = d.row.id;
    let discussion_id = t.id.clone();
    let resolved = !t.resolved;
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    app.busy = true;
    app.status = if resolved { "Resolving…".into() } else { "Unresolving…".into() };
    tokio::spawn(async move {
        let result = ultra_gitlab_lib::core::comments::resolve(&pool, mr_id, &discussion_id, resolved)
            .await
            .map(|_| mr_id)
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::CommentPosted(result));
    });
}
```

- [ ] **Step 3: Re-fetch discussions after any comment/reply/resolve**

Change the `CommentPosted(Ok(mr_id))` handler to refresh both the lists and discussions:

```rust
        AppEvent::CommentPosted(Ok(mr_id)) => {
            app.busy = false;
            app.status = "Done".into();
            let pool = app.pool.clone();
            let tx = app.tx.clone();
            tokio::spawn(async move {
                let r = ultra_gitlab_lib::core::comments::list_discussions(&pool, mr_id)
                    .await
                    .map_err(|e| e.to_string());
                let _ = tx.send(AppEvent::Discussions(r));
            });
        }
```

- [ ] **Step 4: Build + manual check**

Run: `cargo test -p ultra-gitlab-cli`
Expected: compiles, tests pass. Manual: in the overlay, select a thread, press `r`, write a reply, `:wq` → reply appears after refresh; press `R` on a resolvable thread → status flips between `[resolved]`/`[unresolved]`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/cli/src/app.rs src-tauri/cli/src/comments.rs
git commit -m "feat(cli): reply and resolve from the discussions overlay"
```

---

## Task 14: Gutter markers for threaded lines

**Files:**
- Modify: `src-tauri/cli/src/ui/detail.rs`

- [ ] **Step 1: Compute threaded lines for the current file and mark the gutter**

In `detail.rs` `render_diff`, after `app.diff_rows = model.rows;`, build the set of `(side, line)` pairs that have a thread on the current file and overwrite the gutter cell's text with a marker. Insert before the cursor-clamp block:

```rust
    // Lines (new-side or old-side) that have a discussion on this file.
    let marks: std::collections::HashSet<(bool, i64)> = app
        .discussions
        .as_ref()
        .map(|threads| {
            threads
                .iter()
                .filter(|t| t.file_path.as_deref() == Some(file.new_path.as_str()))
                .filter_map(|t| {
                    t.new_line
                        .map(|n| (false, n))
                        .or_else(|| t.old_line.map(|o| (true, o)))
                })
                .collect()
        })
        .unwrap_or_default();
    if !marks.is_empty() {
        for (i, line) in text.lines.iter_mut().enumerate() {
            let Some(meta) = app.diff_rows.get(i) else { continue };
            let has = meta
                .new_line
                .map(|n| marks.contains(&(false, n)))
                .unwrap_or(false)
                || meta.old_line.map(|o| marks.contains(&(true, o))).unwrap_or(false);
            if has {
                if let Some(first) = line.spans.first_mut() {
                    // The gutter span is "{:>4} {:>4} " (10 chars); place a ● at col 0.
                    let mut g: String = first.content.to_string();
                    if !g.is_empty() {
                        g.replace_range(0..1, "●");
                        first.content = g.into();
                        first.style = first.style.fg(Color::Yellow);
                    }
                }
            }
        }
    }
```

- [ ] **Step 2: Build + manual check**

Run: `cargo check -p ultra-gitlab-cli`
Expected: compiles. Manual: open an MR with an inline discussion; the line with a thread shows a yellow `●` in the diff gutter; opening `C` shows the matching thread.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/cli/src/ui/detail.rs
git commit -m "feat(cli): gutter markers for lines with discussions"
```

---

## Final verification

- [ ] **Step 1: Full workspace check + tests**

Run: `cargo test --workspace` and `cargo check --workspace`
Expected: all tests pass, no warnings introduced by these changes (besides pre-existing ones).

- [ ] **Step 2: End-to-end manual pass (real credentials per CLAUDE.md)**

`cargo run -p ultra-gitlab-cli`, then verify each capability against a real MR:
- `c` in file tree → general comment posts.
- `c` in diff (cursor on a changed line) → inline comment posts on the correct line.
- `v` + `j` then `s` → suggestion preview → `m` message → `p` posts a working `suggestion` block.
- `C` → overlay lists threads; `r` replies; `R` resolves/unresolves; gutter `●` appears.

- [ ] **Step 3: Update the CLI README keybindings**

In `src-tauri/cli/README.md`, add `c`, `v`, `s`, `C` (and overlay `r`/`R`) to the documented detail-screen keys, matching the footer hints.

```bash
git add src-tauri/cli/README.md
git commit -m "docs(cli): document comment & suggestion keybindings"
```
```

