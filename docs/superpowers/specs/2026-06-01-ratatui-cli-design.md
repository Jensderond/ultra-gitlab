# Ultra GitLab ratatui CLI — Design

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan

## Goal

A terminal UI (ratatui) frontend for Ultra GitLab that reuses the existing Rust
backend (`ultra_gitlab_lib`). It lets a user browse merge requests, read
syntax-highlighted diffs, and manage their own MRs (rebase / merge / undraft /
auto-merge) plus approve others' MRs — all from the terminal, sharing state with
the desktop app.

## Architecture decision: shared library + shared SQLite DB (Option A)

The desktop sync engine is an in-process tokio task driven by an in-memory
channel; two OS processes cannot literally share one running engine. Instead the
CLI **shares the backend library and the SQLite database the engine maintains**:

- The CLI is a standalone binary linking the same `ultra_gitlab_lib` and opening
  the **same SQLite file**.
- **Reads** (lists, detail, diffs) query SQLite directly — instant, reusing the
  exact queries the desktop uses.
- **Actions** call `GitLabClient` directly and write an optimistic update to the
  shared DB — exactly what the desktop's command handlers already do.
- **Convergence:** GitLab is the source of truth. The running desktop's sync
  engine re-fetches on its next tick and emits its own `mr-updated` events, so
  the desktop UI converges automatically. The desktop is assumed to be running
  to keep the cache fresh; the CLI degrades gracefully (stale-but-usable, with a
  hint) if it is not.

SQLite is opened in WAL mode with a 30s busy-timeout — the correct configuration
for safe concurrent access between two processes at this low write volume.

## Scope (v1)

In scope — four screens and the following actions:

| Screen | Source tab | Contents | Actions |
| --- | --- | --- | --- |
| MRList | Review | MRs **not** authored by me | open detail |
| MRDetail | Review | header + filetree + diff | `a` approve / unapprove |
| MyMrList | Mine | my **open** MRs (+ draft & auto-merge status) | open detail |
| MyMrDetail | Mine | header + filetree + diff | `R` rebase, `M` merge, `U` undraft, `A` auto-merge toggle |

Out of scope for v1 (easy to add later): comments / discussions, pipeline
drill-down, multi-instance selection.

## Crate layout & backend reuse

- New crate at `src-tauri/cli/` — package `ultra-gitlab-cli`, binary `ultra` —
  added as a **workspace member** of `src-tauri`. This keeps the TUI
  dependencies (ratatui, crossterm, syntect) out of the desktop app's dependency
  tree and build.
- Depends on `ultra_gitlab_lib` by path. Reuses `db::pool::create_pool`,
  `services::gitlab_client::GitLabClient`, and all models.
- **Lib refactor (no behavior change):** extract the core logic currently inline
  in the Tauri command handlers into plain `pub async fn`s taking `&DbPool`:
  - `list_merge_requests`, `list_my_merge_requests`
  - `get_merge_request_detail`, `get_diff_files`
  - `merge_mr`, `rebase_mr`, `undraft_mr`
  - `approve_mr`, `unapprove_mr` (CLI variant: direct API call + optimistic DB
    write, not the queue-then-flush path that needs the in-process engine kick)
  - `claim_auto_merge`, `unclaim_auto_merge`, `get_auto_merge_claim`

  The existing Tauri commands become thin wrappers that call these functions, so
  the desktop app is unaffected.

## DB path resolution

The CLI must open the same database file the desktop app uses (its Tauri
app-data directory, derived from the bundle identifier). Resolution order:

1. `--db <path>` flag.
2. `ULTRA_GITLAB_DB` environment variable.
3. The default desktop app-data path, mirrored from the lib's own path
   construction.

**Open item to confirm during planning:** the exact path-construction the lib
uses for the desktop DB, so the mirrored default points at the identical file.
This is the one load-bearing detail to verify.

If the default instance is missing → friendly "run the desktop app to sign in"
message. If the cache is empty → a hint that the desktop app keeps it fresh.

## Navigation & key bindings

- **Two top-level tabs**, switched with `Tab` / `1` / `2`:
  - **Review** → MRList (MRs not authored by me).
  - **Mine** → MyMrList (my open MRs).
- List view: `j`/`k` move, `/` filters, `Enter` opens detail, `r` refreshes from
  cache, `q` quits.
- Detail view: header (title / author / branches / approvals / pipeline) plus two
  panes — left **filetree** of changed files with `+`/`-` counts, right
  **syntax-highlighted diff** (hunks, line numbers, scrollable). `Tab` toggles
  pane focus; `j`/`k` scroll; `Esc` returns to the list.
- Action keys are shown in a footer per screen (see scope table). `M` (merge)
  prompts for confirmation. Action results and errors render in a status line.

## Diff loading & highlighting

- Detail reads cached `diff` / `diff_files`. **If absent for the opened MR,
  fetch live** via `GitLabClient.get_merge_request_diff` and write back, reusing
  the lib's caching path. This guarantees diffs even for MRs not yet opened in
  the desktop.
- Syntax highlighting via `syntect`, keyed off file extension, layered under the
  `+`/`-` diff tint. The hunk / line-number / scroll model is borrowed from
  gitui's `diff.rs` structure (not its code wholesale).

## Async & event loop

- Tokio runtime. The main loop `select!`s over the crossterm `EventStream` (key
  events) and an mpsc channel carrying async results (fetches, action outcomes).
  Long-running calls run as spawned tasks; the UI shows a spinner and never
  blocks on the network.

## Error handling

- All paths return `AppError`; errors surface in the status line and never panic.
  Network/action failures are non-fatal and revert optimistic state where
  relevant.

## Testing

- Unit-test the extracted lib core functions against a temporary SQLite database,
  following the existing backend test pattern.
- Diff parsing and syntax highlighting are pure functions tested on sample diffs.
- TUI widgets rendered to ratatui's `TestBackend` buffer and asserted.
- Manual end-to-end run against the real credentials from `credentials.md` per
  `CLAUDE.md`.
