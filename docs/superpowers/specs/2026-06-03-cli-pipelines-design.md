# CLI Pipelines — Design

**Date:** 2026-06-03
**Status:** Approved (ready for implementation plan)
**Surface:** `ultra` CLI (ratatui TUI, `src-tauri/cli`)

## Summary

Bring GitLab pipelines to the `ultra` CLI. The desktop app already has a full
pipelines feature (pinned projects, statuses, jobs with play/retry/cancel) built
entirely inside Tauri commands. The CLI cannot call those commands (they need
Tauri `State`), so this work:

1. Extracts the pipeline orchestration into a new `core::pipelines` module that
   takes `&DbPool` and returns domain types — the reusable **primitive**.
2. Rewrites `commands/pipeline.rs` as thin DTO-mappers over `core::pipelines`
   (a pure move; no desktop behavior change).
3. Adds a **Pipelines tab** to the CLI with a Projects → Pipelines → Jobs drill
   and full pin management (search/add/pin/unpin/remove) plus job actions
   (play/retry/cancel) and pipeline cancel.
4. Adds a **third focusable pipelines panel** to the CLI's MR detail screen,
   showing the MR's pipelines with an inline jobs drill and the same job actions.

## Decisions

| Topic | Decision |
| --- | --- |
| Target surface | CLI (ratatui TUI) |
| Core strategy | Extract to `core::pipelines`; commands delegate (matches `mr.rs` → `core::mr_query`/`mr_actions`) |
| Pin management | Full — search GitLab, add, pin/unpin, remove |
| Drill depth | Projects → Pipelines → Jobs, with play/retry/cancel + pipeline cancel |
| MR detail integration | Third focusable panel (Files + Pipelines stacked left, Diff right) |

## Architecture context (existing code)

- CLI shares `ultra_gitlab_lib`; its `data.rs` calls `core::mr_query` /
  `core::mr_actions` directly against the shared SQLite DB.
- `core/mod.rs` provides `create_client(pool, instance_id)`,
  `default_instance_id`, `authenticated_username`.
- Pipeline building blocks already shared and `&pool`/`&self`-based:
  - `models::pipeline_project::{list_pipeline_projects, upsert_pipeline_project,
    toggle_pin, remove_pipeline_project, reorder_pinned}`
  - `models::project::{get_project, upsert_project}`
  - `services::gitlab_client` methods: `get_latest_pipeline`,
    `get_project_pipelines`, `get_pipeline_jobs`, `get_pipeline_bridges`,
    `get_mr_pipelines`, `play_job`, `retry_job`, `cancel_job`,
    `cancel_pipeline`, `search_projects`, `get_project`
  - `db::pipeline_cache::{upsert_pipeline_status, get_cached_pipeline_statuses}`
  - `core::mr_actions::mr_api_ids(pool, mr_id) -> (instance_id, project_id, mr_iid)`
- Domain types returned by the client: `GitLabPipeline`, `GitLabJob`
  (with `GitLabJobRunner`), plus `PipelineProject`, `Project` models.

## Section 1 — `core::pipelines` primitive

New file `src-tauri/src/core/pipelines.rs`, added as `pub mod pipelines;` in
`core/mod.rs`. All functions take `&DbPool` and return domain types (never Tauri
DTOs):

- `list_projects(pool, instance_id) -> Result<Vec<PipelineProject>>`
- `search_projects(pool, instance_id, query) -> Result<Vec<Project>>`
  (local cache LIKE match; if < 5 results, GitLab API search, cache results,
  dedup by id — same logic currently in the command)
- `add_project(pool, instance_id, project_id) -> Result<()>`
  (fetch+cache project metadata if missing, then `upsert_pipeline_project`)
- `toggle_pin(pool, instance_id, project_id) -> Result<()>`
- `remove_project(pool, instance_id, project_id) -> Result<()>`
- `reorder_pinned(pool, instance_id, project_ids) -> Result<()>`
- `latest_statuses(pool, instance_id, project_ids) -> Result<Vec<GitLabPipeline>>`
  (parallel `get_latest_pipeline` via `join_all`, then write `pipeline_cache`)
- `cached_statuses(pool, instance_id, project_ids) -> Result<Vec<GitLabPipeline>>`
- `project_pipelines(pool, instance_id, project_id, limit) -> Result<Vec<GitLabPipeline>>`
- `pipeline_jobs(pool, instance_id, project_id, pipeline_id) -> Result<Vec<GitLabJob>>`
  (jobs + bridges, bridges best-effort like today)
- `play_job(pool, instance_id, project_id, job_id) -> Result<GitLabJob>`
- `retry_job(pool, instance_id, project_id, job_id) -> Result<GitLabJob>`
- `cancel_job(pool, instance_id, project_id, job_id) -> Result<GitLabJob>`
- `cancel_pipeline(pool, instance_id, project_id, pipeline_id) -> Result<GitLabPipeline>`
- `mr_pipelines(pool, mr_id) -> Result<Vec<GitLabPipeline>>`
  (resolve `mr_api_ids`, create client, `get_mr_pipelines`)

`commands/pipeline.rs` is rewritten so each command calls the matching
`core::pipelines` function and maps the domain result into the **existing**
camelCase DTOs (`PipelineStatus`, `PipelineJob`, `ProjectSearchResult`,
`ResolvedProject`). Command names, signatures, and DTO shapes are unchanged, so
the React desktop app is untouched. The SHA-truncation-to-8-chars currently done
in the commands stays in the command mapping layer (DTO concern), not in core.
`resolve_project_by_path` and `visit_pipeline_project` (desktop-only) may keep
their bodies or delegate; not required by the CLI.

Use `core::create_client` instead of the command-local `create_gitlab_client`
helper.

### Testing (Section 1)

Unit tests in `core/pipelines.rs` with a temp DB (mirroring `mr_query` tests)
for the DB-backed, network-free functions: `add_project` (metadata-present
path), `toggle_pin`, `remove_project`, `reorder_pinned`, `list_projects`,
`cached_statuses`. Network-dependent functions are thin wrappers verified by
real-credential manual testing per CLAUDE.md.

## Section 2 — CLI Pipelines tab

### State

- `app::Tab` gains `Pipelines`. Tab bar renders `1 Review · 2 Mine · 3 Pipelines`.
  Key `3` selects it; `Tab` cycling includes it.
- New `PipelinesState` struct held on `App`, used only while `tab == Pipelines`
  and `screen == Screen::List`:

```
enum PipeView { Projects, Pipelines, Jobs }

struct PipelinesState {
    view: PipeView,
    projects: Vec<data::PipeProjectRow>,
    proj_state: ListState,
    selected_project: Option<i64>,      // project_id for the Pipelines view
    pipelines: Vec<data::PipeRow>,
    pipe_state: ListState,
    selected_pipeline: Option<i64>,     // pipeline_id for the Jobs view
    jobs: Vec<data::JobRow>,
    job_state: ListState,
    search: Option<SearchState>,
}

struct SearchState { query: String, results: Vec<data::ProjectHit>, state: ListState }
```

### Data adapters (`data.rs`)

- `PipeProjectRow { project_id, name, path_with_namespace, web_url, pinned,
  status: Option<PipeStatus> }` where `PipeStatus { status: String,
  ref_name, sha, web_url, duration }`.
- `PipeRow { id, project_id, status, ref_name, sha, web_url, created_at,
  duration }` (from `GitLabPipeline`).
- `JobRow { id, name, stage, status, web_url, allow_failure, duration }`
  (from `GitLabJob`).
- `ProjectHit { id, name_with_namespace, web_url }` (from `Project`).
- Loaders: `load_pipeline_projects`, `load_project_statuses`,
  `load_project_pipelines`, `load_pipeline_jobs`, `search_pipeline_projects`,
  and (Section 3) `load_mr_pipelines`. Each calls the matching `core::pipelines`
  function and maps to the row type.

### Keybindings

- **Projects view:** `j/k` move · `enter` drill to Pipelines (loads project
  pipelines) · `p` pin/unpin · `x` remove · `n` open add-search overlay ·
  `o` open project in browser · `r` refresh statuses · `q` quit.
- **Search overlay:** printable chars + backspace edit `query` · `enter` run
  search · `j/k` pick result · `enter` (on result) add project then close +
  reload projects · `esc` close.
- **Pipelines view:** `j/k` · `enter` drill to Jobs (loads jobs) · `c` cancel
  pipeline (y/N via existing `Confirm`) · `o` browser · `esc` back to Projects.
- **Jobs view:** `j/k` · `p` play · `R` retry · `c` cancel job (confirm) ·
  `o` browser · `esc` back to Pipelines.

### Rendering & helpers

- New `ui/pipelines.rs` renders the active `PipeView` and the search overlay.
- Extract a shared `status_style(status: &str) -> (char_glyph, Color)` helper
  (replaces the inline `pipeline_glyph` in `ui/list.rs`); reused by list,
  pipelines, and the MR-detail panel for consistent colored status dots.
- Add a small cross-platform `open_url(url)` helper (`open` on macOS,
  `xdg-open` on Linux, `cmd /C start` on Windows) for the `o` key.

### Async + auto-refresh

- New `AppEvent` variants carry each async result:
  `PipeProjects`, `PipeStatuses`, `PipeList`, `PipeJobs`, `PipeSearch`,
  `PipeActionDone(Result<String>)` (post play/retry/cancel/pin/remove/add →
  triggers the appropriate reload), and (Section 3) `MrPipes`, `MrPipeJobs`.
- The event loop gains a 10s interval tick. On tick, if the active pipelines
  view (or MR-detail panel) contains any `running`/`pending` item, re-fetch its
  statuses/jobs; otherwise do nothing. Mirrors the desktop's 10s poll.

## Section 3 — Pipelines in MR detail (third panel)

### Layout & focus

- Detail left column splits vertically: **Files** (top) + **Pipelines**
  (bottom); **Diff** stays on the right.
- `app::Focus` gains `Pipeline`. `Tab` cycles `Tree → Diff → Pipeline → Tree`.
  `←/→` and `h/l` continue to jump Files (`Tree`) ↔ Diff.

### State & data

- New `DetailPipelines` struct on `App`, reset per MR (like `viewed`):

```
struct DetailPipelines {
    pipelines: Vec<data::PipeRow>,
    pipe_state: ListState,
    jobs: Option<Vec<data::JobRow>>,   // Some => panel in inline-jobs mode
    job_state: ListState,
}
```

- When detail opens, alongside the diff load, fire
  `core::pipelines::mr_pipelines(mr_id)` → `AppEvent::MrPipes`. Head pipeline
  first (API returns newest first).

### Keybindings (panel focused)

- Pipeline list mode: `j/k` move · `enter` load + show that pipeline's jobs
  inline (`jobs = Some(...)`) · `o` browser.
- Inline jobs mode: `j/k` move · `p` play · `R` retry · `c` cancel (confirm) ·
  `o` browser · `esc` back to pipeline list (`jobs = None`).
- Reuses `core::pipelines` job functions and `JobRow` rendering from Section 2.

### Footer

Footer hints update per tab and per focus (including the new `Pipeline` focus
and the pipelines-tab views).

## Out of scope

- Multi-instance pipeline views (CLI already operates on one `instance_id`).
- Job log/trace viewing in the CLI (desktop has `get_job_trace`; not requested).
- Reordering pinned projects from the CLI UI (the `reorder_pinned` core fn
  exists and is exposed, but no CLI keybinding in this iteration).
- Any change to desktop React UI.

## Build sequence

1. Section 1: `core::pipelines` + command delegation + unit tests. Verify
   `cargo check`, `cargo test`, and that desktop commands still compile.
2. Section 2: Pipelines tab (state, data adapters, events, rendering, keys,
   helpers, auto-refresh).
3. Section 3: MR-detail third panel.

Each section is independently compilable and testable, suitable for
subagent-driven development.
