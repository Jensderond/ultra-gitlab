# Auto-run Manual Pipeline Jobs — Design

**Date:** 2026-06-11
**Status:** Approved

## Problem

Tag pipelines end in a `when: manual` "Deploy production" job. The user tags a
release, the pipeline runs, and the manual deploy job sits waiting — and is
sometimes forgotten, so the production release never happens.

## Solution Overview

A one-shot **arm** on any manual job in a pipeline's job list. An armed job is
played automatically by the app once the rest of the pipeline has completed
successfully. If the pipeline fails first, the arm is dropped and the user is
notified. Arms persist in SQLite and survive app restarts.

Decisions made during brainstorming:

- **Scope:** one-shot arm per pipeline (not a standing per-project rule).
- **Trigger:** play only when all prior stages succeeded.
- **On failure:** disarm and notify; no auto-deploy after retries.
- **Architecture:** DB-backed claims processed by the sync engine, mirroring
  the existing auto-merge feature.

## Data Model

New migration `src-tauri/src/db/migrations/0023_auto_run_claims.sql`:

```sql
CREATE TABLE auto_run_claims (
    instance_id     INTEGER NOT NULL,
    project_id      INTEGER NOT NULL,
    pipeline_id     INTEGER NOT NULL,
    job_id          INTEGER NOT NULL,
    job_name        TEXT NOT NULL,
    ref_name        TEXT,
    claimed_at      INTEGER NOT NULL,
    last_status     TEXT,
    last_error      TEXT,
    last_attempt_at INTEGER,
    attempts        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (instance_id, project_id, job_id)
);
```

Standalone table (no FK): pipelines and jobs are not persisted locally.
`job_name` and `ref_name` exist so notifications can say
"Started *Deploy production* for *v1.2.3*" without extra API calls.

New DB module `src-tauri/src/db/auto_run.rs` (registered in `db/mod.rs`):

- `upsert_claim(...)`
- `delete_claim(instance_id, project_id, job_id)`
- `list_active_claims()` — all claims, for the processor
- `list_claims_for_pipeline(instance_id, project_id, pipeline_id)` — for UI
- `record_attempt(...)` — bump `attempts`, set `last_status` / `last_error`
- `has_active_claims()` — cheap existence check for the fast ticker

All functions return `Result<T, AppError>` like the other db modules.

## Trigger Logic

The pipeline-level status is the gate (one cheap API call per claim per tick).
Implemented as a **pure function** for unit testing:

```
decide(pipeline_status, job_status) -> Play | Wait | Disarm(reason)
```

| Condition | Action |
|---|---|
| pipeline `success` or `manual`, job `manual` | **Play** the job, delete claim, notify success |
| pipeline `failed` / `canceled` / `skipped` | **Disarm**, delete claim, notify "pipeline failed, job not run" |
| pipeline `running` / `pending` / `created` / `waiting_for_resource` / `preparing` | **Wait** for next tick |
| job no longer `manual` (played in GitLab UI, succeeded, superseded) | **Disarm silently** (no notification) |

Rationale: a `when: manual` job only reaches status `manual` once its stage is
reached, and pipeline `success`/`manual` guarantees no earlier stage failed —
this is exactly the "all prior stages succeeded" condition.

### Error handling

- `play_job()` or status fetch fails transiently (network, 5xx): call
  `record_attempt` with the error, keep the claim, retry next tick.
- After **10 consecutive failed attempts**: disarm and notify.
- Auth expiry: same handling as auto-merge (surfaces `AUTH_EXPIRED_EVENT`).

## Backend Components

### GitLab client (`src-tauri/src/services/gitlab_client.rs`)

- New: `get_pipeline(project_id, pipeline_id)` —
  `GET /projects/{id}/pipelines/{pipeline_id}` (only list endpoints exist today).
- Reused: `play_job(project_id, job_id)`, `get_pipeline_jobs(...)` (to read the
  armed job's current status).

### Sync engine (`src-tauri/src/services/sync_engine.rs`)

`process_auto_run_claims()`, modeled on `process_auto_merge_claims()`:

1. `list_active_claims()`.
2. Group by instance; build one GitLab client per instance.
3. Per claim: fetch pipeline status, fetch the job's status, run `decide()`,
   act (play / wait / disarm), `record_attempt` on errors, emit
   `AUTO_RUN_UPDATED_EVENT`.

Scheduling:

- Runs in the normal sync cycle (after MR sync, alongside auto-merge).
- **Fast ticker:** a 30-second interval in the background loop that runs
  `process_auto_run_claims()` only when `has_active_claims()` is true, so a
  deploy doesn't wait up to 5 minutes after the build finishes. It does not
  trigger a full sync.
- New `SyncCommand::ProcessAutoRun` for on-demand processing; arming a job
  kicks it immediately (covers pipelines that are already ready when armed).

### Tauri commands (`src-tauri/src/commands/auto_run.rs`)

- `claim_auto_run(instance_id, project_id, pipeline_id, job_id, job_name, ref_name)`
  — upsert claim + kick `ProcessAutoRun`.
- `unclaim_auto_run(instance_id, project_id, job_id)`
- `list_auto_run_claims(instance_id, project_id, pipeline_id)` — UI state.

Registered in `commands/mod.rs` and `lib.rs` (`generate_handler!`).

### Events (`src-tauri/src/services/sync_events.rs`)

New `AUTO_RUN_UPDATED_EVENT` = `"auto-run-updated"`, payload (camelCase serde):

```rust
struct AutoRunUpdatedPayload {
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
    job_id: i64,
    job_name: String,
    removed: bool,      // claim deleted (played, disarmed, or unclaimed)
    played: bool,       // job was successfully started
    last_status: Option<String>,
    last_error: Option<String>,
}
```

Played and disarmed-by-failure outcomes also produce desktop notifications via
the existing notification pathway (same shape as pipeline status
notifications) — the notification is the actual fix for "the release never
seems to happen".

## Frontend Components

- **Types** (`src/types/index.ts`): `AutoRunClaim` (camelCase, matching DTO).
- **Services**: invoke wrappers in `src/services/tauri.ts`, high-level ops in
  `src/services/gitlab.ts`, re-exported from `src/services/index.ts`.
- **Hook** `src/hooks/useAutoRun.ts`: mirrors `useAutoMerge` — React Query over
  `list_auto_run_claims` keyed by `(instanceId, projectId, pipelineId)`,
  invalidated by the `auto-run-updated` event; exposes `armedJobIds`,
  `toggleAutoRun(job)`.
- **UI** (`src/pages/PipelineDetailPage/JobRow.tsx`): manual jobs
  (`status === "manual"`) get an **"Auto"** toggle button next to "Run" —
  highlighted when armed, click again to disarm. Because both
  `PipelineDetailView` and the MR-side `PipelineDetailDialog` render `JobRow`,
  the feature is available from the pipelines dashboard and from MR detail
  with no additional UI.

## Out of Scope (YAGNI)

- Standing per-project auto-run rules.
- Arming `scheduled` jobs (delayed jobs already run themselves).
- Arm-chains across multiple manual jobs in one pipeline (each job is armed
  independently; if two are armed, each plays when its condition is met).
- Surviving pipeline retries: failure always disarms.

## Testing & Verification

- Rust unit tests for `decide()` covering every row of the trigger table.
- `cargo check` and `bunx tsc --noEmit` clean.
- Live verification against the real GitLab instance (credentials from
  `credentials.md`): arm a manual job on a real pipeline, observe the play +
  notification; arm one on a pipeline forced to fail, observe disarm + notify.
