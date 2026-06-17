# Arm auto-run on `created` manual jobs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users arm auto-run on a `when: manual` job while it is still in `created` state, instead of having to wait for it to reach `manual`.

**Architecture:** REST stays the source of truth for the jobs list. We enrich each job with a `manual: bool` flag fetched from GitLab GraphQL (`CiJob.manualJob`, which is config-derived and status-independent) in `core::pipelines::pipeline_jobs()` only — the background auto-run sync path is untouched. The frontend then shows the "Auto" button for `manual` jobs whose status is `manual` *or* `created`.

**Tech Stack:** Rust (Tauri 2, sqlx, reqwest, serde_json), React 19 + TypeScript, Playwright e2e, vitest available.

**Spec:** `docs/superpowers/specs/2026-06-17-arm-auto-run-on-created-jobs-design.md`

---

## File Structure

- `src-tauri/src/services/gitlab_client.rs` — add `GitLabJob.manual` field; add `fetch_pipeline_manual_flags()` method + pure helpers `build_manual_flags_query()`, `parse_manual_flags()`, `parse_ci_build_id()`; unit tests in the existing `#[cfg(test)] mod tests`.
- `src-tauri/src/core/pipelines.rs` — in `pipeline_jobs()`, resolve the project full path and merge manual flags into the REST jobs (best-effort).
- `src-tauri/src/commands/pipeline.rs` — add `manual` to the `PipelineJob` DTO and `to_job_dto`.
- `src/types/index.ts` — add `manual: boolean` to the `PipelineJob` interface.
- `src/pages/PipelineDetailPage/JobRow.tsx` — relax the `canAutoRun` gate.
- `e2e/fixtures/seed-data.ts` — add `manual` to all `PipelineJob` fixtures; add a `created` manual job and a `created` non-manual job.
- `e2e/pipeline-auto-run.spec.ts` — assert the Auto button shows on the `created` manual job and not on the `created` non-manual job.

All commands run from the repo root `/Users/jens/Sites/ultra-gitlab`. Rust commands run from `src-tauri/` (or use `cargo ... --manifest-path src-tauri/Cargo.toml`).

---

## Task 1: Add `manual` field to `GitLabJob`

**Files:**
- Modify: `src-tauri/src/services/gitlab_client.rs` (struct `GitLabJob`, around line 300-325)

- [ ] **Step 1: Add the field**

In the `GitLabJob` struct, after the `is_bridge` field (the last field, ~line 324), add:

```rust
    /// True when the job is `when: manual`. Not provided by the REST jobs API;
    /// populated best-effort from GraphQL in `core::pipelines::pipeline_jobs`.
    /// Defaults to false so REST-only deserialization is unaffected.
    #[serde(default)]
    pub manual: bool,
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds (other call sites that construct `GitLabJob` are deserialized from JSON, so `#[serde(default)]` keeps them valid; if any literal construction exists it will error — none is expected).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/services/gitlab_client.rs
git commit -m "feat: add manual flag to GitLabJob (default false)"
```

---

## Task 2: GraphQL query builder + response parser (pure, unit-tested)

**Files:**
- Modify: `src-tauri/src/services/gitlab_client.rs` (free functions near `build_mr_states_query` ~line 1545; tests in `mod tests` ~line 1657)

- [ ] **Step 1: Write the failing tests**

Inside the existing `#[cfg(test)] mod tests { ... }` block (starts ~line 1657), add:

```rust
    #[test]
    fn parse_ci_build_id_extracts_trailing_number() {
        assert_eq!(parse_ci_build_id("gid://gitlab/Ci::Build/808382"), Some(808382));
        assert_eq!(parse_ci_build_id("gid://gitlab/CommitStatus/42"), Some(42));
        assert_eq!(parse_ci_build_id("not-a-gid"), None);
        assert_eq!(parse_ci_build_id("gid://gitlab/Ci::Build/"), None);
    }

    #[test]
    fn build_manual_flags_query_embeds_path_and_pipeline_gid() {
        let q = build_manual_flags_query("customers/normec/website", 324844);
        assert!(q.contains("project(fullPath: \"customers/normec/website\")"));
        assert!(q.contains("pipeline(id: \"gid://gitlab/Ci::Pipeline/324844\")"));
        assert!(q.contains("manualJob"));
    }

    #[test]
    fn parse_manual_flags_maps_job_id_to_manual_flag() {
        let data = serde_json::json!({
            "project": { "pipeline": { "jobs": { "nodes": [
                { "id": "gid://gitlab/Ci::Build/808382", "manualJob": true },
                { "id": "gid://gitlab/Ci::Build/808381", "manualJob": false }
            ]}}}
        });
        let flags = parse_manual_flags(&data);
        assert_eq!(flags.get(&808382), Some(&true));
        assert_eq!(flags.get(&808381), Some(&false));
        assert_eq!(flags.len(), 2);
    }

    #[test]
    fn parse_manual_flags_empty_on_missing_pipeline() {
        let data = serde_json::json!({ "project": { "pipeline": null } });
        assert!(parse_manual_flags(&data).is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_manual_flags parse_ci_build_id build_manual_flags_query`
Expected: FAIL to compile — `cannot find function parse_ci_build_id` / `build_manual_flags_query` / `parse_manual_flags`.

- [ ] **Step 3: Implement the three free functions**

Add these free functions near `build_mr_states_query` (outside the `impl GitLabClient` block, e.g. right after `build_mr_states_query` ends ~line 1582). Note: `parse_ci_build_id` mirrors the existing `parse_graphql_user_id` helper.

```rust
/// Build the GraphQL query fetching `{ id, manualJob }` for every job in one
/// pipeline. `pipeline_id` is the REST/database pipeline id; GitLab accepts it
/// as a `CiPipelineID` global id.
fn build_manual_flags_query(project_full_path: &str, pipeline_id: i64) -> String {
    // serde_json::to_string produces a quoted, escaped GraphQL string literal.
    let path_literal = serde_json::to_string(project_full_path)
        .unwrap_or_else(|_| format!("\"{}\"", project_full_path));
    format!(
        "query {{ project(fullPath: {path}) {{ \
           pipeline(id: \"gid://gitlab/Ci::Pipeline/{pid}\") {{ \
             jobs(first: 100) {{ nodes {{ id manualJob }} }} \
           }} }} }}",
        path = path_literal,
        pid = pipeline_id,
    )
}

/// Parse the manual-flags GraphQL `data` payload into a map of job id -> manual.
/// Missing/malformed fields are skipped; result is empty when the pipeline or
/// jobs are absent.
fn parse_manual_flags(data: &serde_json::Value) -> std::collections::HashMap<i64, bool> {
    let mut map = std::collections::HashMap::new();
    let nodes = data
        .get("project")
        .and_then(|p| p.get("pipeline"))
        .and_then(|p| p.get("jobs"))
        .and_then(|j| j.get("nodes"))
        .and_then(|n| n.as_array());
    if let Some(nodes) = nodes {
        for node in nodes {
            if let Some(id) = node.get("id").and_then(|i| i.as_str()).and_then(parse_ci_build_id) {
                let manual = node.get("manualJob").and_then(|m| m.as_bool()).unwrap_or(false);
                map.insert(id, manual);
            }
        }
    }
    map
}

/// Extract the trailing numeric id from a CI job global id
/// (`gid://gitlab/Ci::Build/<n>`). Returns None if the tail isn't a number.
fn parse_ci_build_id(gid: &str) -> Option<i64> {
    gid.rsplit('/').next()?.parse().ok()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml parse_manual_flags parse_ci_build_id build_manual_flags_query`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/gitlab_client.rs
git commit -m "feat: GraphQL manual-flags query builder and parser"
```

---

## Task 3: `fetch_pipeline_manual_flags` client method

**Files:**
- Modify: `src-tauri/src/services/gitlab_client.rs` (inside `impl GitLabClient`, e.g. right after `batch_fetch_mr_states` ~line 1368)

- [ ] **Step 1: Add the method**

```rust
    /// Fetch which jobs in a pipeline are `when: manual`, keyed by REST job id.
    ///
    /// GitLab's REST jobs API does not expose a manual indicator, so this uses
    /// GraphQL `CiJob.manualJob` (config-derived, status-independent). Callers
    /// treat this as best-effort: on error, fall back to an empty map.
    pub async fn fetch_pipeline_manual_flags(
        &self,
        project_full_path: &str,
        pipeline_id: i64,
    ) -> Result<std::collections::HashMap<i64, bool>, AppError> {
        let query = build_manual_flags_query(project_full_path, pipeline_id);
        let data = self.graphql(&query).await?;
        Ok(parse_manual_flags(&data))
    }
```

- [ ] **Step 2: Build to confirm it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/services/gitlab_client.rs
git commit -m "feat: fetch_pipeline_manual_flags GraphQL client method"
```

---

## Task 4: Merge manual flags in `pipeline_jobs()`

**Files:**
- Modify: `src-tauri/src/core/pipelines.rs` (`pipeline_jobs()` ~line 199-216)

- [ ] **Step 1: Update `pipeline_jobs` to enrich with manual flags**

Replace the body of `pipeline_jobs` (lines 199-216) with:

```rust
pub async fn pipeline_jobs(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<GitLabJob>, AppError> {
    let client = create_client(pool, instance_id).await?;
    let mut jobs = client.get_pipeline_jobs(project_id, pipeline_id).await?;
    // Bridges are best-effort: get_pipeline_bridges already maps errors to an
    // empty vec, but guard here too so job display never depends on bridges.
    if let Ok(bridges) = client.get_pipeline_bridges(project_id, pipeline_id).await {
        jobs.extend(bridges.into_iter().map(|mut b| {
            b.is_bridge = true;
            b
        }));
    }

    // Enrich with `when: manual` flags via GraphQL so the UI can offer auto-run
    // on jobs still in `created` (REST exposes no manual indicator). Strictly
    // best-effort: any failure leaves `manual = false` and never fails the list.
    if let Some(path) = project_full_path(pool, instance_id, project_id, &client).await {
        if let Ok(flags) = client.fetch_pipeline_manual_flags(&path, pipeline_id).await {
            for job in jobs.iter_mut() {
                if let Some(&manual) = flags.get(&job.id) {
                    job.manual = manual;
                }
            }
        }
    }

    Ok(jobs)
}

/// Resolve a project's `path_with_namespace` for GraphQL (which keys on full
/// path, not numeric id). Prefers the local cache; falls back to the API.
/// Returns None if neither is available — caller then skips manual enrichment.
async fn project_full_path(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    client: &GitLabClient,
) -> Option<String> {
    if let Ok(Some(p)) = project::get_project(pool, instance_id, project_id).await {
        return Some(p.path_with_namespace);
    }
    client
        .get_project(project_id)
        .await
        .ok()
        .map(|p| p.path_with_namespace)
}
```

- [ ] **Step 2: Add the `GitLabClient` import**

The new helper names the `GitLabClient` type. Update the import at line 13:

```rust
use crate::services::gitlab_client::{GitLabClient, GitLabJob, GitLabPipeline};
```

(`project` is already imported at line 12: `use crate::models::project::{self, Project};`.)

- [ ] **Step 3: Build to confirm it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds cleanly. If `Project` becomes unused elsewhere, leave it — it is used by other functions in this file.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/core/pipelines.rs
git commit -m "feat: merge GraphQL manual flags into pipeline_jobs (best-effort)"
```

---

## Task 5: Expose `manual` on the `PipelineJob` DTO

**Files:**
- Modify: `src-tauri/src/commands/pipeline.rs` (struct `PipelineJob` ~line 41-55; `to_job_dto`)

- [ ] **Step 1: Add the field to the DTO**

In `pub struct PipelineJob` (has `#[serde(rename_all = "camelCase")]`), after `pub downstream_pipeline: Option<DownstreamPipeline>,` add:

```rust
    pub manual: bool,
```

- [ ] **Step 2: Set it in `to_job_dto`**

In `fn to_job_dto`, inside the returned `PipelineJob { ... }`, after the `downstream_pipeline: ...` mapping, add:

```rust
        manual: j.manual,
```

- [ ] **Step 3: Build to confirm it compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds cleanly.

- [ ] **Step 4: Run the full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (including the 4 new tests from Task 2; no regressions).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/pipeline.rs
git commit -m "feat: expose manual flag on PipelineJob DTO"
```

---

## Task 6: Add `manual` to the frontend `PipelineJob` type

**Files:**
- Modify: `src/types/index.ts` (interface `PipelineJob` ~line 533)

- [ ] **Step 1: Add the field**

In `export interface PipelineJob { ... }`, after `downstreamPipeline: DownstreamPipeline | null;` add:

```ts
  /** True when this is a `when: manual` job (from GraphQL CiJob.manualJob). */
  manual: boolean;
```

- [ ] **Step 2: Typecheck — expect failures in fixtures**

Run: `bunx tsc --noEmit`
Expected: FAIL — every `PipelineJob` object literal (in `e2e/fixtures/seed-data.ts`) now misses `manual`. These are fixed in Task 8. (Production code reads `manual` off API responses, so only literals break.)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add manual field to frontend PipelineJob type"
```

---

## Task 7: Relax the `canAutoRun` gate in `JobRow`

**Files:**
- Modify: `src/pages/PipelineDetailPage/JobRow.tsx` (line 22)

- [ ] **Step 1: Change the gate**

Replace line 22:

```ts
  const canAutoRun = job.status === 'manual';
```

with:

```ts
  // Manual jobs can be armed before their stage is reached: while still
  // `created`, the backend waits and plays once prior stages succeed.
  const canAutoRun = job.manual && (job.status === 'manual' || job.status === 'created');
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/PipelineDetailPage/JobRow.tsx
git commit -m "feat: show auto-run button on created manual jobs"
```

---

## Task 8: Update e2e fixtures and the auto-run spec

**Files:**
- Modify: `e2e/fixtures/seed-data.ts` (`pipelineJobs` ~line 607-678, `downstreamPipelineJobs` ~line 681+)
- Modify: `e2e/pipeline-auto-run.spec.ts`

- [ ] **Step 1: Add `manual` to every existing job fixture**

In `e2e/fixtures/seed-data.ts`, add a `manual` field to each `PipelineJob` literal so TypeScript is satisfied:
- `pipelineJobs`: `lint` (7001) → `manual: false`; `test` (7002) → `manual: false`; `Docs` (7003) → `manual: false`; `Deploy production` (7004) → `manual: true`.
- `downstreamPipelineJobs`: every job → `manual: false`.

Add the field next to `isBridge` in each object, e.g. for `Deploy production`:

```ts
    isBridge: false,
    manual: true,
    downstreamPipeline: null,
```

- [ ] **Step 2: Add two `created` jobs to `pipelineJobs`**

Append these two objects to the `pipelineJobs` array (after `Deploy production`, before the closing `];` at ~line 678):

```ts
  {
    id: 7005,
    name: 'Deploy review',
    stage: 'deploy',
    status: 'created',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/jobs/7005',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: null,
    finishedAt: null,
    duration: null,
    queuedDuration: null,
    allowFailure: false,
    runnerDescription: null,
    isBridge: false,
    manual: true,
    downstreamPipeline: null,
  },
  {
    id: 7006,
    name: 'build-extra',
    stage: 'build',
    status: 'created',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/jobs/7006',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: null,
    finishedAt: null,
    duration: null,
    queuedDuration: null,
    allowFailure: false,
    runnerDescription: null,
    isBridge: false,
    manual: false,
    downstreamPipeline: null,
  },
```

- [ ] **Step 3: Typecheck — now clean**

Run: `bunx tsc --noEmit`
Expected: PASS (no missing-`manual` errors).

- [ ] **Step 4: Add e2e assertions for created jobs**

In `e2e/pipeline-auto-run.spec.ts`, add a new test inside the `describe` block (after the existing first test):

```ts
  test('created manual job shows Auto; created automatic job does not', async ({ page }) => {
    const createdManual = page.locator('.pipeline-job-row', { hasText: 'Deploy review' });
    await expect(createdManual.locator('.pipeline-job-action-btn--auto')).toBeVisible();

    const createdAuto = page.locator('.pipeline-job-row', { hasText: 'build-extra' });
    await expect(createdAuto.locator('.pipeline-job-action-btn--auto')).toHaveCount(0);
  });
```

- [ ] **Step 5: Run the auto-run e2e spec**

Run: `bun run test:e2e -- pipeline-auto-run.spec.ts`
Expected: PASS (3 tests). If the dev server needs to be running, follow the existing e2e setup (Playwright config starts it automatically via `webServer`).

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/seed-data.ts e2e/pipeline-auto-run.spec.ts
git commit -m "test: e2e coverage for auto-run on created manual jobs"
```

---

## Task 9: Live verification (per CLAUDE.md — real credentials)

**Files:** none (manual verification)

- [ ] **Step 1: Pull the working token from the app DB**

```bash
sqlite3 "$HOME/Library/Application Support/com.jens.ultra-gitlab/ultra-gitlab.db" \
  "SELECT token FROM gitlab_instances WHERE id=1;"
```

- [ ] **Step 2: Confirm GraphQL returns `manualJob` for a known manual job**

Run (substitute `$TOKEN`), verifying `Deploy production` reports `manualJob: true`:

```bash
TOKEN=$(sqlite3 "$HOME/Library/Application Support/com.jens.ultra-gitlab/ultra-gitlab.db" "SELECT token FROM gitlab_instances WHERE id=1;")
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -X POST "https://gitlab.redkiwi.nl/api/graphql" \
  -d '{"query":"query { project(fullPath: \"customers/normec/website\") { pipeline(id: \"gid://gitlab/Ci::Pipeline/324844\") { jobs(first: 100) { nodes { id name status manualJob } } } } }"}'
```

Expected: JSON with `"name":"Deploy production"` and `"manualJob":true`.

- [ ] **Step 3 (optional, read-only): build the app and spot-check the UI**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && bunx tsc --noEmit`
Expected: both succeed. Do NOT arm/play any real job without explicit user approval (per the token-location memory).

---

## Self-Review

**Spec coverage:**
- REST has no manual indicator → root cause documented; GraphQL chosen → Tasks 2-4. ✓
- `GitLabJob.manual` (default false) → Task 1. ✓
- GraphQL merge in `pipeline_jobs()`, best-effort, not in background sync → Task 4 (sync_engine untouched). ✓
- `PipelineJob` DTO `manual` → Task 5. ✓
- Frontend type `manual` → Task 6. ✓
- `canAutoRun = job.manual && (manual || created)` → Task 7. ✓
- Scope: `created`+`manual` only, `jobs(first: 100)`, overflow defaults false → Task 2 query / Task 7 gate. ✓
- Testing: GID parse/merge unit tests (Task 2), GraphQL-failure path is best-effort (covered by the `if let Ok` guard in Task 4; no test needed since failure → empty map → `manual` stays false), live check (Task 9), frontend created-job rendering (Task 8). ✓

**Placeholder scan:** No TBD/TODO; all steps have concrete code/commands. ✓

**Type consistency:** `fetch_pipeline_manual_flags` / `build_manual_flags_query` / `parse_manual_flags` / `parse_ci_build_id` / `project_full_path` names match across tasks. Field name `manual` consistent in `GitLabJob`, DTO, and TS type. GraphQL `manualJob` field name matches the verified live query. ✓
