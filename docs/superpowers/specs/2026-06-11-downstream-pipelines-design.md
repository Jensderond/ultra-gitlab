# Downstream Pipelines (Bridge / Trigger Jobs)

**Date:** 2026-06-11
**Status:** Approved (user requested plan + implementation in one pass)

## Problem

Pipelines that fan out via `trigger:` jobs (e.g. `customers/life/webshop` triggering
`.ci/life.yml`, `.ci/belamo.yml`, and the multi-project `pipelines/docs` pipeline)
render incorrectly. The backend already fetches bridge jobs from
`GET /projects/:id/pipelines/:pipeline_id/bridges` and merges them into the job
list, but:

- The `downstream_pipeline` object in the bridge response is dropped during
  deserialization, so nothing knows which pipeline a bridge triggered.
- Bridges are indistinguishable from regular jobs in the desktop app and CLI.
- Clicking/entering a bridge tries to open a job log, which bridges don't have.
- There is no way to view the downstream pipeline's jobs at all.

## Design

### Backend (Rust lib)

1. `services/gitlab_client.rs`
   - New struct `GitLabDownstreamPipeline`: `id`, `project_id: Option<i64>`
     (older GitLab versions omit it), `status`, `ref` → `ref_name: Option<String>`,
     `web_url`.
   - `GitLabJob` gains `#[serde(default)] downstream_pipeline: Option<GitLabDownstreamPipeline>`
     and `#[serde(default)] is_bridge: bool`. Both default off for the regular
     jobs endpoint; `downstream_pipeline` may be `null` for bridges whose
     downstream pipeline failed to be created.
2. `core/pipelines.rs::pipeline_jobs` sets `is_bridge = true` on results of
   `get_pipeline_bridges` before merging. A bridge with `downstream_pipeline: null`
   still renders as a bridge (just without drill-down).
3. `commands/pipeline.rs`
   - New DTO `DownstreamPipeline` (camelCase): `id`, `projectId: Option<i64>`,
     `status`, `refName: Option<String>`, `webUrl`.
   - `PipelineJob` DTO gains `isBridge: bool` and
     `downstreamPipeline: Option<DownstreamPipeline>`.

No new Tauri commands: drilling into a downstream pipeline reuses
`get_pipeline_jobs(instance_id, downstream_project_id, downstream_pipeline_id)`,
which already supports arbitrary project ids (covers both child pipelines and
multi-project downstreams). No DB caching of downstream metadata — pipeline jobs
are not cached today either.

### Desktop app (React)

- `types/index.ts`: `DownstreamPipeline` interface + the two new fields on
  `PipelineJob`.
- `JobRow.tsx`: bridge rows render a "Trigger" badge and the downstream
  pipeline's status; the row click drills into the downstream pipeline instead
  of the job log. A bridge without a resolvable downstream (`null` or missing
  `projectId`) is not clickable.
- `PipelineDetailPage/index.tsx`: `handleSelectJob` branches on `isBridge` and
  navigates to `/pipelines/<downstreamProjectId>/<downstreamPipelineId>` with the
  downstream project path parsed from its `webUrl`
  (`{base}/{path}/-/pipelines/{id}`). A `back` search param carries the parent
  pipeline route so Esc/back returns to the parent rather than the dashboard.
- `PipelineDetailDialog.tsx`: bridge clicks swap the dialog to the downstream
  pipeline in place (same pattern as History selection); `projectId`/`projectName`
  become dialog state.
- `usePipelineJobsQuery`: a pipeline also counts as active while any bridge's
  downstream pipeline is running/pending, so polling continues until the
  downstream finishes.

### CLI (ratatui)

- `data.rs`: `JobRow` gains `is_bridge: bool` and
  `downstream: Option<DownstreamRef { pipeline_id, project_id: Option<i64>, status }>`.
- `pipelines.rs`: the Jobs view gets a drill-down stack
  `jobs_stack: Vec<JobsCtx { project_id, pipeline_id, label }>`. Entering jobs
  from the pipelines list seeds the stack with one entry; Enter on a bridge with
  a known downstream pushes a new context and loads its jobs; Esc pops one level
  and reloads, returning to the pipelines list when the stack empties.
  `reload_active_view` and job actions use the stack top's project id.
- `ui/pipelines.rs`: bridge rows render `»` plus the downstream status and a
  `trigger` tag; the Jobs panel title shows a breadcrumb of the stack labels.
- MR-detail pipelines panel: same Enter-to-drill on bridges with its own stack;
  Esc pops a level before closing the inline jobs panel (app.rs Esc handler).
- `has_inflight` also considers running/pending downstream statuses.

### Testing

- Rust: serde test deserializing a realistic bridges payload (incl.
  `downstream_pipeline`), and a CLI `JobRow::from` mapping test.
- e2e: seed a bridge job (stage `triggers`) with a downstream pipeline; mock
  `get_pipeline_jobs` to return downstream jobs for the downstream pipeline id;
  assert the trigger badge renders and clicking navigates to the downstream
  pipeline detail showing its jobs.
