# Arm auto-run on `created` manual jobs

**Date:** 2026-06-17
**Status:** Approved (design)
**Related:** [2026-06-11-auto-run-manual-jobs-design.md](2026-06-11-auto-run-manual-jobs-design.md)

## Problem

The auto-run feature lets a user arm a `when: manual` job so it plays automatically
once all prior stages succeed. Today the "Auto" arm button only appears once the job
has reached the `manual` status (`JobRow.tsx`: `canAutoRun = job.status === 'manual'`).

A manual job does not reach `manual` status until its stage is reached — before that it
sits in `created`, exactly like every automatic job. So the user must watch the pipeline
and wait for the job to flip to `manual` before they can arm it, which defeats the point
of a fire-and-forget auto-run.

The backend already supports arming earlier: `services/auto_run.rs::decide()` returns
`Wait` for a `created` job and only `Play`s once it is `manual` and prior stages are green.
A claim is keyed by `job_id` (stable across the `created` → `manual` transition), so a claim
created during `created` persists and is processed correctly. **The only blocker is the UI gate.**

## Why we can't just drop the gate

GitLab's REST jobs API exposes no `when`/`manual` indicator. Verified against the live
`gitlab.redkiwi.nl` instance: a job object's keys are
`allow_failure, archived, artifacts, …, status, stage, tag, …` — nothing identifies a
job as manual. So a `created` manual job is indistinguishable from a `created` automatic
job over REST. Showing "Auto" on *every* `created` job would put a pointless button on all
automatic jobs.

## Solution: GraphQL `CiJob.manualJob`

GitLab's GraphQL `CiJob.manualJob` field identifies manual jobs and is **status-independent**
— derived from the job's static `when: manual` config, not its current state.

Verified against live data: "Deploy production" reported `manualJob: true` while its status
was already `SUCCESS`. Since the flag is config-derived, it reads `true` while the job is
still `created`. This is exactly the signal we need.

The app already has GraphQL plumbing (`gitlab_client.rs::graphql()`, used for MR approval /
pipeline state), so no new infrastructure is required.

## Design

### Backend — additive supplement (REST remains source of truth)

1. **`GitLabJob`** (`src-tauri/src/services/gitlab_client.rs`): add
   `#[serde(default)] pub manual: bool`. Defaults to `false` since the REST jobs endpoint
   never provides it.

2. **`core::pipelines::pipeline_jobs()`** (`src-tauri/src/core/pipelines.rs`): after the
   existing REST jobs + bridges fetch, make **one** GraphQL call fetching `{ id, manualJob }`
   for the pipeline's jobs and merge the flag into the REST jobs by numeric job id.
   - GraphQL returns ids as GIDs (`gid://gitlab/Ci::Build/<n>`); extract the trailing number
     and match against `GitLabJob.id`.
   - **Best-effort:** if the GraphQL call errors, log and continue with `manual = false` for
     all jobs. The jobs list must never fail because the manual-flag enrichment failed — it
     degrades gracefully to today's behavior (button only on `manual`-status jobs).
   - Add a `get_jobs_manual_flags(project_id, pipeline_id) -> Result<HashMap<i64, bool>>`
     (or similar) helper on `GitLabClient` that issues the GraphQL query.

3. **`PipelineJob` DTO** (`src-tauri/src/commands/pipeline.rs`): add `pub manual: bool`
   (the struct already has `#[serde(rename_all = "camelCase")]`), and set `manual: j.manual`
   in `to_job_dto`.

#### Where the GraphQL call does *not* go

The background auto-run processor (`sync_engine.rs`) calls `client.get_pipeline_jobs`
directly and only needs job **status** to drive `decide()`. It does **not** call
`pipeline_jobs()` and must not — so the extra GraphQL round-trip happens only when a user
is actively viewing a pipeline's job list, not on every background sync tick.

### Frontend

4. **`PipelineJob` type** (`src/types/index.ts`): add `manual: boolean`.

5. **`JobRow.tsx`**: change the gate to
   ```ts
   const canAutoRun = job.manual && (job.status === 'manual' || job.status === 'created');
   ```
   No other JobRow changes. The existing armed/disarmed button states, tooltips, and the
   `useAutoRun` toggle flow already work for any job id; arming a `created` job persists into
   `manual` because the claim is keyed by job id.

   Note: the "Run" (play) button stays gated on `manual`/`scheduled` (a `created` job is not
   yet playable), so a `created` manual job shows only "Auto" until it becomes playable.

## Scope decisions (YAGNI)

- **Statuses:** only `created` and `manual` get the button. `scheduled`/delayed (`when: delayed`)
  jobs are out of scope — they run on their own after their delay.
- **Pagination:** the GraphQL query fetches `jobs(first: 100)`. Real pipelines are well under
  that. Any overflow jobs simply default to `manual: false` (button hidden until they reach
  `manual` status — i.e. today's behavior). Not worth paginating now; called out so it's a
  known, intentional limitation rather than a silent gap.
- No changes to claim storage, the sync processor, or `decide()` — they already handle the
  `created` case.

## Testing

- **Rust unit test:** GID parsing / merge logic — given REST jobs and a GraphQL flag map,
  the right jobs get `manual = true` and unmatched jobs stay `false`.
- **Rust:** GraphQL-failure path leaves jobs intact with `manual = false` (best-effort).
- **Live (per CLAUDE.md, real credentials):** fetch a pipeline known to contain a manual job
  via `pipeline_jobs()` and assert that job's `manual` flag is `true` regardless of its status.
- **Frontend:** `JobRow` renders the Auto button for a `{ manual: true, status: 'created' }`
  job and not for `{ manual: false, status: 'created' }`.

## Files touched

- `src-tauri/src/services/gitlab_client.rs` — `GitLabJob.manual` field; GraphQL flags helper
- `src-tauri/src/core/pipelines.rs` — merge manual flags in `pipeline_jobs()`
- `src-tauri/src/commands/pipeline.rs` — `PipelineJob.manual` + `to_job_dto`
- `src/types/index.ts` — `PipelineJob.manual`
- `src/pages/PipelineDetailPage/JobRow.tsx` — `canAutoRun` gate
