# Ultra GitLab — GPUI frontend experiment

A native Rust desktop frontend for Ultra GitLab, built with
[GPUI](https://github.com/zed-industries/zed) (Zed's UI framework) and
[longbridge/gpui-component](https://github.com/longbridge/gpui-component).

This crate **shares the same Rust backend and sync engine as the Tauri
app in `../src-tauri/`** — same SQLite cache, same scheduled sync loop,
same GitLab API client. The only thing that changes is the UI layer.

## Status

Proof-of-concept. Implemented:

- Sidebar listing GitLab instances from the shared SQLite cache.
- Merge-request data table (IID, title, project, author, branch, updated)
  fed by the same `merge_requests` table the Tauri app populates.
- "Refresh" button that calls `SyncHandle::trigger_sync` on the
  background sync engine (instead of waiting for the periodic tick).
- **MR detail view**: double-click a row to open it. Renders the MR
  header (title, branches, author, state badge), a left-hand changed-
  file list, and a Zed-inspired inline unified diff (dual line-number
  gutters, subtle tinted backgrounds for adds / removes, hunk header
  separator bars). Reads `diff_files.diff_content` from the same cache
  the Tauri app populates.
- **Tree-sitter syntax highlighting** inside diff lines. Grammars for
  rust / typescript / tsx / javascript / python / go / ruby / json /
  bash / html / css / markdown / c / cpp / toml are statically linked
  into the binary (nothing is installed at runtime). The highlighter
  runs per-hunk: it reconstructs the old-side and new-side text from
  the unified diff, parses each side with tree-sitter, then folds the
  captured byte ranges back onto individual diff lines and hands them
  to `gpui::StyledText`. See `src/highlight.rs` for the captures-to-
  color map (One-Dark-ish palette) and the `Language` enum for the
  full list of bundled grammars.

  > Why tree-sitter and not auto-installed LSPs? Zed itself uses tree-
  > sitter (not LSP semantic tokens) for the coloring you see in its
  > editor. LSPs are for *semantic* features (completion, go-to-def);
  > they round-trip through a subprocess, need a full file on disk,
  > and cost hundreds of ms to spin up — wrong shape for diff hunks.
  > Tree-sitter is a pure parser, runs in-process, and tolerates
  > broken syntax, which is what we always have inside a hunk.

Not yet implemented (deliberately out of scope for the experiment):

- Pipelines, issues, comments, approvals, auto-merge.
- Side-by-side diff mode — only inline / unified is wired up.
- Auth setup flow — the experiment expects credentials to already exist
  in the SQLite DB (set up via the Tauri app once).
- Reactive UI updates from sync events — the GPUI side currently
  re-queries after a fixed delay. Wiring a custom `EventEmitter` that
  pipes `mr-updated` into a GPUI signal is the obvious next step.

## How the wiring works

```text
┌────────────────────────────┐        ┌──────────────────────────────┐
│ GPUI executor (UI thread)  │        │ Tokio runtime (bg thread)    │
│                            │        │                              │
│  MrListView ──── refresh ──┼──spawn─▶  SyncHandle::trigger_sync    │
│                            │        │     │                        │
│  oneshot::Receiver ◀───────┼────────┤  sqlx::query_as              │
│       │                    │        │     │                        │
│       ▼                    │        │  Sync engine ── background ──┤
│  Table re-render           │        │  ticker / EventEmitter       │
└────────────────────────────┘        └──────────────────────────────┘
```

`Backend::start` creates a multi-thread Tokio runtime, opens the DB,
starts the sync engine, then **leaks the runtime** so the background
tasks survive for the process lifetime. The GPUI side gets a clone of
the `tokio::runtime::Handle` and the `DbPool` and uses
`tokio::sync::oneshot` to deliver query results back to the UI — the
GPUI executor polls oneshot receivers without needing a Tokio context.

## How it shares the backend

The root `Cargo.toml` defines a workspace. `src-tauri/Cargo.toml` makes
`tauri` and the companion-server stack optional under the `tauri-app`
feature (which is on by default — the Tauri build is unaffected). This
crate consumes `ultra-gitlab` with `default-features = false`:

```toml
ultra-gitlab = { path = "../src-tauri", default-features = false }
```

That pulls in `db`, `models`, `services::{sync_engine, gitlab_client,
sync_queue, sync_processor, sync_events, avatar, gitattributes}` —
everything you need to drive a sync — without dragging in Tauri's
WebView, IPC commands, or the axum-based companion server.

## Running

```bash
# From repo root
cargo run -p ultra-gitlab-gpui
```

By default the app opens
`$HOME/Library/Application Support/com.jens.ultra-gitlab/ultra-gitlab.db`
on macOS, or `$HOME/.local/share/com.jens.ultra-gitlab/ultra-gitlab.db`
on Linux. Override with `ULTRA_GITLAB_DB=/path/to/db.sqlite`.

The first build pulls Zed (gpui) and gpui-component as git deps — it's
slow. Subsequent builds are incremental.

### Linux

The same X11/Wayland/font deps Zed itself needs apply:

```bash
apt install libfontconfig-dev libxcb-randr0-dev libxcb-shape0-dev \
            libxcb-xfixes0-dev libxkbcommon-dev libwayland-dev libssl-dev
```

### Bumping the GPUI revision

`gpui-component` floats on `zed-industries/zed`'s `main`. To keep
trait/type identity consistent across `gpui`, `gpui_platform`, and
`gpui-component`, this crate leaves them all unpinned and lets Cargo
resolve them transitively. If a future `gpui-component` bump breaks the
build, pin all three to whatever rev `gpui-component`'s `Cargo.lock`
locks against.
