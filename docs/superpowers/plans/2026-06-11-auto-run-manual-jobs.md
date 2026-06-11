# Auto-run Manual Pipeline Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-shot "Auto" arm on manual pipeline jobs: the app plays the job automatically once all prior stages succeed, disarms and notifies if the pipeline fails first.

**Architecture:** Mirrors the existing auto-merge feature: a SQLite `auto_run_claims` table, Tauri commands to arm/disarm, a processor in the background sync engine that polls the pipeline (with a 30s fast ticker while claims exist) and calls the existing `play_job()` GitLab API, plus Tauri events for UI refresh and notifications.

**Tech Stack:** Rust (Tauri 2, sqlx/SQLite, tokio), React 19 + TypeScript + React Query, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-11-auto-run-manual-jobs-design.md`

**Conventions (from CLAUDE.md / memory):**
- Package manager is `bun`. Typecheck: `bunx tsc --noEmit`. Rust: `cargo check` / `cargo test` (run inside `src-tauri/`).
- New Tauri commands need 3 registrations: command fn in `src-tauri/src/commands/<feature>.rs`, re-export in `src-tauri/src/commands/mod.rs`, register in `generate_handler!` in `src-tauri/src/lib.rs` (both the `use` import and the macro).
- The pre-commit hook runs eslint and the full Playwright e2e suite — commits take ~1 minute. That's expected; don't bypass it.
- NOTE: the spec says migration `0023` but `0023_add_mr_assigned_to_me` already exists on master. This plan uses **0024**.

---

### Task 1: Migration `0024_auto_run_claims.sql`

**Files:**
- Create: `src-tauri/src/db/migrations/0024_auto_run_claims.sql`
- Modify: `src-tauri/src/db/mod.rs` (MIGRATIONS array, after the `0023_add_mr_assigned_to_me` entry)

- [ ] **Step 1: Create the migration file**

`src-tauri/src/db/migrations/0024_auto_run_claims.sql`:

```sql
-- Migration: 0024_auto_run_claims.sql
-- Tracks manual pipeline jobs the user has "armed" for auto-run. The
-- background sync engine polls each claim and plays the job via the GitLab
-- API once the rest of the pipeline has completed successfully. Standalone
-- table (no FK): pipelines and jobs are not persisted locally.

CREATE TABLE IF NOT EXISTS auto_run_claims (
    instance_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    pipeline_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    job_name TEXT NOT NULL,
    ref_name TEXT,
    claimed_at INTEGER NOT NULL,
    last_status TEXT,
    last_error TEXT,
    last_attempt_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (instance_id, project_id, job_id)
);
```

- [ ] **Step 2: Register it in the MIGRATIONS array**

In `src-tauri/src/db/mod.rs`, append after the `0023_add_mr_assigned_to_me` tuple:

```rust
    (
        "0024_auto_run_claims",
        include_str!("migrations/0024_auto_run_claims.sql"),
    ),
```

- [ ] **Step 3: Run the existing migration tests**

Run: `cd src-tauri && cargo test db::tests`
Expected: PASS — `test_initialize_creates_database` and `test_migrations_are_idempotent` (the idempotency test counts `MIGRATIONS.len()`, so it validates the new entry applies cleanly).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/migrations/0024_auto_run_claims.sql src-tauri/src/db/mod.rs
git commit -m "feat(db): Add auto_run_claims table for auto-run manual jobs"
```

---

### Task 2: DB module `db/auto_run.rs`

**Files:**
- Create: `src-tauri/src/db/auto_run.rs` (helpers + tests in the same file)
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod auto_run;` next to `pub mod auto_merge;`)

Model on `src-tauri/src/db/auto_merge.rs`: free functions over `&DbPool`, returning `Result<_, sqlx::Error>` (auto-converts to `AppError` at the command layer).

- [ ] **Step 1: Write the module with failing-first tests**

Create `src-tauri/src/db/auto_run.rs`:

```rust
//! Auto-run claim DB helpers.
//!
//! Claims live in `auto_run_claims` keyed by (instance_id, project_id,
//! job_id). A row means "play this manual job once its pipeline has finished
//! successfully" — the sync engine reads the table on every tick (plus a
//! fast 30s ticker while any claim exists) and processes each claim.

use crate::db::pool::DbPool;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct AutoRunClaimRow {
    pub instance_id: i64,
    pub project_id: i64,
    pub pipeline_id: i64,
    pub job_id: i64,
    pub job_name: String,
    pub ref_name: Option<String>,
    pub claimed_at: i64,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub attempts: i64,
}

const ALL_COLUMNS: &str = "instance_id, project_id, pipeline_id, job_id, job_name, ref_name, \
                           claimed_at, last_status, last_error, last_attempt_at, attempts";

/// Arm a job. No-op if a claim already exists for this job.
#[allow(clippy::too_many_arguments)]
pub async fn upsert_claim(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
    job_id: i64,
    job_name: &str,
    ref_name: Option<&str>,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO auto_run_claims \
         (instance_id, project_id, pipeline_id, job_id, job_name, ref_name, claimed_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(instance_id, project_id, job_id) DO NOTHING",
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(pipeline_id)
    .bind(job_id)
    .bind(job_name)
    .bind(ref_name)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Disarm a job.
pub async fn delete_claim(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM auto_run_claims WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// All active claims, for the sync processor.
pub async fn list_active_claims(pool: &DbPool) -> Result<Vec<AutoRunClaimRow>, sqlx::Error> {
    sqlx::query_as::<_, AutoRunClaimRow>(&format!(
        "SELECT {ALL_COLUMNS} FROM auto_run_claims"
    ))
    .fetch_all(pool)
    .await
}

/// Claims for one pipeline, for the UI.
pub async fn list_claims_for_pipeline(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<AutoRunClaimRow>, sqlx::Error> {
    sqlx::query_as::<_, AutoRunClaimRow>(&format!(
        "SELECT {ALL_COLUMNS} FROM auto_run_claims \
         WHERE instance_id = ? AND project_id = ? AND pipeline_id = ?"
    ))
    .bind(instance_id)
    .bind(project_id)
    .bind(pipeline_id)
    .fetch_all(pool)
    .await
}

/// Cheap existence check for the fast ticker.
pub async fn has_active_claims(pool: &DbPool) -> Result<bool, sqlx::Error> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM auto_run_claims")
        .fetch_one(pool)
        .await?;
    Ok(count.0 > 0)
}

/// Record a successful status check: stores the observed pipeline status,
/// clears any previous error, and resets the consecutive-error counter.
pub async fn record_status(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
    now: i64,
    status: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE auto_run_claims \
         SET last_status = ?, last_error = NULL, last_attempt_at = ?, attempts = 0 \
         WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(status)
    .bind(now)
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record a failed attempt (API error). Increments the consecutive-error
/// counter and returns its new value so the caller can give up after a cap.
pub async fn record_error(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
    now: i64,
    error: &str,
) -> Result<i64, sqlx::Error> {
    sqlx::query(
        "UPDATE auto_run_claims \
         SET last_error = ?, last_attempt_at = ?, attempts = attempts + 1 \
         WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(error)
    .bind(now)
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .execute(pool)
    .await?;
    let attempts: (i64,) = sqlx::query_as(
        "SELECT attempts FROM auto_run_claims \
         WHERE instance_id = ? AND project_id = ? AND job_id = ?",
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(job_id)
    .fetch_one(pool)
    .await?;
    Ok(attempts.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    async fn test_pool() -> (tempfile::TempDir, DbPool) {
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        (dir, pool)
    }

    #[tokio::test]
    async fn upsert_list_delete_roundtrip() {
        let (_dir, pool) = test_pool().await;

        upsert_claim(&pool, 1, 10, 3001, 7004, "Deploy production", Some("v1.2.3"), 100)
            .await
            .unwrap();
        // Second upsert for the same job is a no-op.
        upsert_claim(&pool, 1, 10, 3001, 7004, "Deploy production", Some("v1.2.3"), 200)
            .await
            .unwrap();

        let all = list_active_claims(&pool).await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].job_id, 7004);
        assert_eq!(all[0].job_name, "Deploy production");
        assert_eq!(all[0].ref_name.as_deref(), Some("v1.2.3"));
        assert_eq!(all[0].claimed_at, 100, "second upsert must not overwrite");
        assert_eq!(all[0].attempts, 0);

        let for_pipeline = list_claims_for_pipeline(&pool, 1, 10, 3001).await.unwrap();
        assert_eq!(for_pipeline.len(), 1);
        let other_pipeline = list_claims_for_pipeline(&pool, 1, 10, 9999).await.unwrap();
        assert!(other_pipeline.is_empty());

        assert!(has_active_claims(&pool).await.unwrap());
        delete_claim(&pool, 1, 10, 7004).await.unwrap();
        assert!(!has_active_claims(&pool).await.unwrap());
        assert!(list_active_claims(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn record_error_increments_and_record_status_resets() {
        let (_dir, pool) = test_pool().await;
        upsert_claim(&pool, 1, 10, 3001, 7004, "Deploy production", None, 100)
            .await
            .unwrap();

        assert_eq!(record_error(&pool, 1, 10, 7004, 110, "boom").await.unwrap(), 1);
        assert_eq!(record_error(&pool, 1, 10, 7004, 120, "boom").await.unwrap(), 2);

        let claim = &list_active_claims(&pool).await.unwrap()[0];
        assert_eq!(claim.attempts, 2);
        assert_eq!(claim.last_error.as_deref(), Some("boom"));

        record_status(&pool, 1, 10, 7004, 130, "running").await.unwrap();
        let claim = &list_active_claims(&pool).await.unwrap()[0];
        assert_eq!(claim.attempts, 0);
        assert_eq!(claim.last_status.as_deref(), Some("running"));
        assert!(claim.last_error.is_none());
        assert_eq!(claim.last_attempt_at, Some(130));
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/db/mod.rs`, after `pub mod auto_merge;`:

```rust
pub mod auto_run;
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test db::auto_run`
Expected: PASS — 2 tests (`upsert_list_delete_roundtrip`, `record_error_increments_and_record_status_resets`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/auto_run.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): Add auto_run claim helpers"
```

---

### Task 3: Decision function `services/auto_run.rs`

**Files:**
- Create: `src-tauri/src/services/auto_run.rs`
- Modify: `src-tauri/src/services/mod.rs` (add `pub mod auto_run;` to the module list, alphabetically after `pub mod avatar;` — i.e. before `pub mod companion_api;`... actually alphabetically `auto_run` sorts first; put it before `pub mod avatar;`)

This is the pure trigger logic from the spec: `(pipeline_status, job_status) → Play | Wait | Disarm`.

- [ ] **Step 1: Write the module with exhaustive tests**

Create `src-tauri/src/services/auto_run.rs`:

```rust
//! Pure decision logic for the auto-run manual job feature.
//!
//! Separated from the sync engine so the trigger table from the design spec
//! (docs/superpowers/specs/2026-06-11-auto-run-manual-jobs-design.md) can be
//! unit-tested without any I/O.

/// What the processor should do with one armed job on this tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoRunDecision {
    /// All prior stages succeeded and the job is playable: play it now.
    Play,
    /// Pipeline still in progress (or blocked earlier): check again next tick.
    Wait,
    /// Pipeline reached terminal failure; the job will never become playable.
    /// Disarm and notify the user.
    DisarmPipelineFailed,
    /// The job left the `manual` state some other way (played in the GitLab
    /// UI, superseded, ...). Disarm silently.
    DisarmJobGone,
}

/// Decide based on the pipeline-level status and the armed job's status.
///
/// A `when: manual` job only reaches status `manual` once its stage is
/// reached, and pipeline `success`/`manual` guarantees no earlier stage
/// failed — together that is exactly "all prior stages succeeded".
pub fn decide(pipeline_status: &str, job_status: &str) -> AutoRunDecision {
    if matches!(pipeline_status, "failed" | "canceled" | "skipped") {
        return AutoRunDecision::DisarmPipelineFailed;
    }
    match job_status {
        "manual" => match pipeline_status {
            // `success`: pipeline done, the manual job was allow_failure so
            // it didn't block. `manual`: pipeline blocked waiting on it.
            "success" | "manual" => AutoRunDecision::Play,
            _ => AutoRunDecision::Wait,
        },
        // Job's stage not reached yet (earlier stages running, or blocked on
        // an earlier manual job).
        "created" | "scheduled" => AutoRunDecision::Wait,
        // Anything else (running, success, pending, ...) means someone or
        // something already started it.
        _ => AutoRunDecision::DisarmJobGone,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plays_when_pipeline_settled_green_and_job_manual() {
        assert_eq!(decide("success", "manual"), AutoRunDecision::Play);
        assert_eq!(decide("manual", "manual"), AutoRunDecision::Play);
    }

    #[test]
    fn waits_while_pipeline_in_progress() {
        assert_eq!(decide("running", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("pending", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("created", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("waiting_for_resource", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("preparing", "manual"), AutoRunDecision::Wait);
    }

    #[test]
    fn waits_while_job_stage_not_reached() {
        assert_eq!(decide("running", "created"), AutoRunDecision::Wait);
        // Pipeline blocked on an EARLIER manual job; ours not reachable yet.
        assert_eq!(decide("manual", "created"), AutoRunDecision::Wait);
        assert_eq!(decide("running", "scheduled"), AutoRunDecision::Wait);
    }

    #[test]
    fn disarms_with_notification_on_pipeline_failure() {
        assert_eq!(decide("failed", "manual"), AutoRunDecision::DisarmPipelineFailed);
        assert_eq!(decide("canceled", "manual"), AutoRunDecision::DisarmPipelineFailed);
        assert_eq!(decide("skipped", "manual"), AutoRunDecision::DisarmPipelineFailed);
        // Pipeline failure wins regardless of job status.
        assert_eq!(decide("failed", "skipped"), AutoRunDecision::DisarmPipelineFailed);
        assert_eq!(decide("canceled", "created"), AutoRunDecision::DisarmPipelineFailed);
    }

    #[test]
    fn disarms_silently_when_job_already_ran() {
        assert_eq!(decide("running", "running"), AutoRunDecision::DisarmJobGone);
        assert_eq!(decide("success", "success"), AutoRunDecision::DisarmJobGone);
        assert_eq!(decide("running", "pending"), AutoRunDecision::DisarmJobGone);
        assert_eq!(decide("success", "skipped"), AutoRunDecision::DisarmJobGone);
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/services/mod.rs`, add as the first entry of the module list:

```rust
pub mod auto_run;
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test services::auto_run`
Expected: PASS — 5 tests.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/services/auto_run.rs src-tauri/src/services/mod.rs
git commit -m "feat: Add auto-run trigger decision logic"
```

---

### Task 4: GitLab client `get_pipeline()`

**Files:**
- Modify: `src-tauri/src/services/gitlab_client.rs` (insert directly after `get_latest_pipeline`, which ends around line 723)

- [ ] **Step 1: Add the method**

```rust
    /// Get a single pipeline by id.
    pub async fn get_pipeline(
        &self,
        project_id: i64,
        pipeline_id: i64,
    ) -> Result<GitLabPipeline, AppError> {
        let endpoint = format!("/projects/{}/pipelines/{}", project_id, pipeline_id);
        let url = self.api_url(&endpoint);
        let response = self.send_with_retry(self.client.get(&url)).await?;
        self.handle_response(response, &endpoint).await
    }
```

Note: the single-pipeline endpoint returns the same fields as the list endpoint (plus extras serde ignores), so `GitLabPipeline` deserializes as-is.

- [ ] **Step 2: Check it compiles**

Run: `cd src-tauri && cargo check`
Expected: clean (one new method, no callers yet — a `dead_code` warning is acceptable until Task 6).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/services/gitlab_client.rs
git commit -m "feat: Add single-pipeline GET to GitLab client"
```

---

### Task 5: Events in `sync_events.rs`

**Files:**
- Modify: `src-tauri/src/services/sync_events.rs` (append after `AutoMergeUpdatedPayload`, around line 80)

- [ ] **Step 1: Add event constants and payloads**

```rust
/// Event: auto-run-updated
/// Emitted when the sync engine processes an auto-run claim — status
/// observed, job played, or claim removed. The frontend invalidates its
/// claim queries on this event.
pub const AUTO_RUN_UPDATED_EVENT: &str = "auto-run-updated";

/// Payload for auto-run-updated events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRunUpdatedPayload {
    pub instance_id: i64,
    pub project_id: i64,
    pub pipeline_id: i64,
    pub job_id: i64,
    pub job_name: String,
    /// True if the claim was removed (played, disarmed, or job gone).
    pub removed: bool,
    /// True if the job was successfully started.
    pub played: bool,
    /// Last pipeline status observed, if known.
    pub last_status: Option<String>,
    /// Last error string, if any.
    pub last_error: Option<String>,
}

/// Event: notification:auto-run
/// Emitted when an armed job is played (played=true) or the arm is dropped
/// because the pipeline failed / errors exhausted retries (played=false).
/// Drives toasts + native notifications.
pub const AUTO_RUN_NOTIFICATION_EVENT: &str = "notification:auto-run";

/// Payload for notification:auto-run events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRunNotificationPayload {
    /// True: job was started. False: arm dropped without running the job.
    pub played: bool,
    pub job_name: String,
    /// Git ref the pipeline ran on (tag/branch), if recorded at arm time.
    pub ref_name: Option<String>,
    /// Project name with namespace (falls back to "project <id>").
    pub project_name: String,
    /// Job URL when played; pipeline URL when disarmed; None on API errors.
    pub web_url: Option<String>,
    pub instance_id: i64,
    pub project_id: i64,
    pub pipeline_id: i64,
}
```

- [ ] **Step 2: Check it compiles, commit**

Run: `cd src-tauri && cargo check`
Expected: clean (unused-warnings acceptable until Task 6).

```bash
git add src-tauri/src/services/sync_events.rs
git commit -m "feat: Add auto-run event types"
```

---

### Task 6: Sync engine processor + fast ticker

**Files:**
- Modify: `src-tauri/src/services/sync_engine.rs`:
  - `SyncCommand` enum (~line 167)
  - `SyncHandle` impl (~line 229, next to `process_auto_merge_now`)
  - background loop in `start_background` (~lines 415–458)
  - `run_sync` body (~line 585, right after `self.process_auto_merge_claims().await;`)
  - new methods near `process_auto_merge_claims` (~line 2821)

- [ ] **Step 1: Add the command variant**

In `enum SyncCommand`, after `ProcessAutoMerge`:

```rust
    /// Run the auto-run (manual job) processor immediately.
    ProcessAutoRun,
```

- [ ] **Step 2: Add the handle method**

In `impl SyncHandle`, after `process_auto_merge_now`:

```rust
    /// Process auto-run claims immediately. Useful right after the user arms
    /// a job so an already-ready pipeline is played without waiting a tick.
    pub async fn process_auto_run_now(&self) -> Result<(), AppError> {
        self.command_tx
            .send(SyncCommand::ProcessAutoRun)
            .await
            .map_err(|_| AppError::internal("Sync engine not running"))
    }
```

- [ ] **Step 3: Wire the background loop**

In `start_background`, right after the existing `interval.tick().await;` (line ~418), add the fast ticker:

```rust
            // Fast ticker for auto-run claims: a deploy shouldn't wait up to
            // 5 minutes after the build finishes. Each tick is a cheap local
            // COUNT(*) and only hits the network while a claim exists.
            let mut auto_run_interval = time::interval(Duration::from_secs(30));
            auto_run_interval.tick().await;
```

In the `tokio::select!`, add a new arm after the `_ = interval.tick() => { ... }` arm:

```rust
                    _ = auto_run_interval.tick() => {
                        if let Ok(true) = crate::db::auto_run::has_active_claims(&engine.pool).await {
                            engine.process_auto_run_claims().await;
                        }
                    }
```

In the `match cmd` block, after the `SyncCommand::ProcessAutoMerge` arm:

```rust
                            SyncCommand::ProcessAutoRun => {
                                eprintln!("[sync] Processing auto-run claims (on-demand)");
                                engine.process_auto_run_claims().await;
                            }
```

- [ ] **Step 4: Run it in the normal sync cycle**

In `run_sync`, directly after `self.process_auto_merge_claims().await;` (line ~585):

```rust
        // Process auto-run (manual job) claims.
        self.process_auto_run_claims().await;
```

- [ ] **Step 5: Add the processor methods**

Add near `process_auto_merge_claims` (after `process_one_auto_merge_claim` and its helpers). Uses `crate::db::auto_run` and `crate::services::auto_run::{decide, AutoRunDecision}` — add `use crate::db::auto_run;` next to the existing `use crate::db::auto_merge;` at the top of the file, and add `AutoRunNotificationPayload, AutoRunUpdatedPayload, AUTO_RUN_NOTIFICATION_EVENT, AUTO_RUN_UPDATED_EVENT` to the existing `use crate::services::sync_events::{...}` import:

```rust
    /// Process all auto-run claims: play armed manual jobs whose pipeline
    /// finished successfully, drop claims whose pipeline failed.
    pub async fn process_auto_run_claims(&self) {
        let claims = match auto_run::list_active_claims(&self.pool).await {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[auto-run] Failed to list claims: {}", e);
                return;
            }
        };
        if claims.is_empty() {
            return;
        }
        eprintln!("[auto-run] Processor running — {} active claim(s)", claims.len());

        // Build one GitLab client per instance and reuse across claims.
        let instances = match self.get_gitlab_instances().await {
            Ok(v) => v,
            Err(e) => {
                log::warn!("[auto-run] Failed to load instances: {}", e);
                return;
            }
        };
        let mut clients: HashMap<i64, GitLabClient> = HashMap::new();
        for inst in instances {
            let Some(token) = inst.token else { continue };
            if let Ok(client) = GitLabClient::new(GitLabClientConfig {
                base_url: inst.url,
                token,
                timeout_secs: 30,
            }) {
                clients.insert(inst.id, client);
            }
        }

        for claim in claims {
            let Some(client) = clients.get(&claim.instance_id) else {
                log::warn!(
                    "[auto-run] No client for instance {} (job {})",
                    claim.instance_id, claim.job_id
                );
                continue;
            };
            self.process_one_auto_run_claim(&claim, client).await;
        }
    }

    /// Run a single tick of the auto-run state machine for one claim.
    async fn process_one_auto_run_claim(
        &self,
        claim: &auto_run::AutoRunClaimRow,
        client: &GitLabClient,
    ) {
        let pipeline = match client.get_pipeline(claim.project_id, claim.pipeline_id).await {
            Ok(p) => p,
            Err(e) => {
                self.record_auto_run_error(claim, &e.to_string()).await;
                return;
            }
        };

        // Find the armed job's current status. Bridges live on a separate
        // endpoint, so fall back to it when the job isn't in the jobs list.
        let job_status = match client.get_pipeline_jobs(claim.project_id, claim.pipeline_id).await {
            Ok(jobs) => match jobs.into_iter().find(|j| j.id == claim.job_id) {
                Some(j) => Some(j.status),
                None => client
                    .get_pipeline_bridges(claim.project_id, claim.pipeline_id)
                    .await
                    .ok()
                    .and_then(|bridges| bridges.into_iter().find(|j| j.id == claim.job_id))
                    .map(|j| j.status),
            },
            Err(e) => {
                self.record_auto_run_error(claim, &e.to_string()).await;
                return;
            }
        };
        // Job vanished from the pipeline (e.g. pipeline deleted/recreated):
        // treat like "gone" so the claim doesn't poll forever.
        let job_status = job_status.unwrap_or_else(|| "gone".to_string());

        match crate::services::auto_run::decide(&pipeline.status, &job_status) {
            crate::services::auto_run::AutoRunDecision::Wait => {
                eprintln!(
                    "[auto-run] {} (job {}): pipeline {}, waiting",
                    claim.job_name, claim.job_id, pipeline.status
                );
                let _ = auto_run::record_status(
                    &self.pool, claim.instance_id, claim.project_id, claim.job_id,
                    now(), &pipeline.status,
                ).await;
                self.emit_auto_run_updated(claim, false, false, Some(pipeline.status), None);
            }
            crate::services::auto_run::AutoRunDecision::Play => {
                eprintln!(
                    "[auto-run] {} (job {}): pipeline {} — playing",
                    claim.job_name, claim.job_id, pipeline.status
                );
                match client.play_job(claim.project_id, claim.job_id).await {
                    Ok(job) => {
                        let _ = self
                            .log_sync_operation(
                                "auto_run",
                                "success",
                                None,
                                Some(format!(
                                    "Auto-ran job '{}' on {} (pipeline #{})",
                                    claim.job_name,
                                    claim.ref_name.as_deref().unwrap_or("?"),
                                    claim.pipeline_id
                                )),
                                None,
                            )
                            .await;
                        let _ = auto_run::delete_claim(
                            &self.pool, claim.instance_id, claim.project_id, claim.job_id,
                        ).await;
                        self.emit_auto_run_updated(claim, true, true, Some(pipeline.status), None);
                        self.emit_auto_run_notification(claim, true, Some(job.web_url)).await;
                    }
                    Err(e) => self.record_auto_run_error(claim, &e.to_string()).await,
                }
            }
            crate::services::auto_run::AutoRunDecision::DisarmPipelineFailed => {
                eprintln!(
                    "[auto-run] {} (job {}): pipeline {} — disarming",
                    claim.job_name, claim.job_id, pipeline.status
                );
                let _ = self
                    .log_sync_operation(
                        "auto_run",
                        "info",
                        None,
                        Some(format!(
                            "Pipeline #{} {} — auto-run of '{}' cancelled",
                            claim.pipeline_id, pipeline.status, claim.job_name
                        )),
                        None,
                    )
                    .await;
                let _ = auto_run::delete_claim(
                    &self.pool, claim.instance_id, claim.project_id, claim.job_id,
                ).await;
                self.emit_auto_run_updated(claim, true, false, Some(pipeline.status), None);
                self.emit_auto_run_notification(claim, false, Some(pipeline.web_url)).await;
            }
            crate::services::auto_run::AutoRunDecision::DisarmJobGone => {
                eprintln!(
                    "[auto-run] {} (job {}): job status {} — dropping claim silently",
                    claim.job_name, claim.job_id, job_status
                );
                let _ = auto_run::delete_claim(
                    &self.pool, claim.instance_id, claim.project_id, claim.job_id,
                ).await;
                self.emit_auto_run_updated(claim, true, false, Some(pipeline.status), None);
            }
        }
    }

    /// Record an API error for a claim; disarm + notify after 10 consecutive
    /// failures so a dead pipeline doesn't poll forever.
    async fn record_auto_run_error(&self, claim: &auto_run::AutoRunClaimRow, msg: &str) {
        log::warn!("[auto-run] job {} ({}): {}", claim.job_id, claim.job_name, msg);
        let attempts = auto_run::record_error(
            &self.pool, claim.instance_id, claim.project_id, claim.job_id, now(), msg,
        )
        .await
        .unwrap_or(0);
        if attempts >= 10 {
            let _ = auto_run::delete_claim(
                &self.pool, claim.instance_id, claim.project_id, claim.job_id,
            ).await;
            self.emit_auto_run_updated(claim, true, false, None, Some(msg.to_string()));
            self.emit_auto_run_notification(claim, false, None).await;
        } else {
            self.emit_auto_run_updated(claim, false, false, None, Some(msg.to_string()));
        }
    }

    /// Emit the query-invalidation event for one claim.
    fn emit_auto_run_updated(
        &self,
        claim: &auto_run::AutoRunClaimRow,
        removed: bool,
        played: bool,
        last_status: Option<String>,
        last_error: Option<String>,
    ) {
        self.emit_event(
            AUTO_RUN_UPDATED_EVENT,
            &AutoRunUpdatedPayload {
                instance_id: claim.instance_id,
                project_id: claim.project_id,
                pipeline_id: claim.pipeline_id,
                job_id: claim.job_id,
                job_name: claim.job_name.clone(),
                removed,
                played,
                last_status,
                last_error,
            },
        );
    }

    /// Emit the toast/native-notification event for a played or dropped arm.
    async fn emit_auto_run_notification(
        &self,
        claim: &auto_run::AutoRunClaimRow,
        played: bool,
        web_url: Option<String>,
    ) {
        let project_name: Option<(String,)> = sqlx::query_as(
            "SELECT name_with_namespace FROM projects WHERE id = ? AND instance_id = ?",
        )
        .bind(claim.project_id)
        .bind(claim.instance_id)
        .fetch_optional(&self.pool)
        .await
        .ok()
        .flatten();

        self.emit_event(
            AUTO_RUN_NOTIFICATION_EVENT,
            &AutoRunNotificationPayload {
                played,
                job_name: claim.job_name.clone(),
                ref_name: claim.ref_name.clone(),
                project_name: project_name
                    .map(|(n,)| n)
                    .unwrap_or_else(|| format!("project {}", claim.project_id)),
                web_url,
                instance_id: claim.instance_id,
                project_id: claim.project_id,
                pipeline_id: claim.pipeline_id,
            },
        );
    }
```

- [ ] **Step 6: Build and run all Rust tests**

Run: `cd src-tauri && cargo check && cargo test`
Expected: clean compile, all tests pass (existing sync_engine tests + new auto_run tests).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/services/sync_engine.rs
git commit -m "feat: Process auto-run claims in sync engine with 30s fast ticker"
```

---

### Task 7: Tauri commands + registration

**Files:**
- Create: `src-tauri/src/commands/auto_run.rs`
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod auto_run;` at line ~15 next to `pub mod auto_merge;`, and a `pub use auto_run::{...}` next to the auto_merge one at line ~36)
- Modify: `src-tauri/src/lib.rs` (add to the `use` import around line 16 and to `generate_handler!` around line 341)

- [ ] **Step 1: Create the commands module**

`src-tauri/src/commands/auto_run.rs` (modeled on `commands/auto_merge.rs`):

```rust
//! Auto-run claim commands.
//!
//! Users arm a manual pipeline job from the UI; the background sync engine
//! plays it once the rest of the pipeline succeeds. These commands just
//! read/write the `auto_run_claims` table.

use crate::db::auto_run;
use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::services::sync_engine::SyncHandle;
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Frontend-shaped claim payload.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRunClaim {
    pub instance_id: i64,
    pub project_id: i64,
    pub pipeline_id: i64,
    pub job_id: i64,
    pub job_name: String,
    pub ref_name: Option<String>,
    pub claimed_at: i64,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub attempts: i64,
}

impl From<auto_run::AutoRunClaimRow> for AutoRunClaim {
    fn from(row: auto_run::AutoRunClaimRow) -> Self {
        Self {
            instance_id: row.instance_id,
            project_id: row.project_id,
            pipeline_id: row.pipeline_id,
            job_id: row.job_id,
            job_name: row.job_name,
            ref_name: row.ref_name,
            claimed_at: row.claimed_at,
            last_status: row.last_status,
            last_error: row.last_error,
            last_attempt_at: row.last_attempt_at,
            attempts: row.attempts,
        }
    }
}

/// Arm a manual job for auto-run. Idempotent. Kicks the processor so a
/// pipeline that is already ready is played within seconds.
#[tauri::command]
pub async fn claim_auto_run(
    pool: State<'_, DbPool>,
    sync_handle: State<'_, SyncHandle>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
    job_id: i64,
    job_name: String,
    ref_name: Option<String>,
) -> Result<(), AppError> {
    auto_run::upsert_claim(
        pool.inner(),
        instance_id,
        project_id,
        pipeline_id,
        job_id,
        &job_name,
        ref_name.as_deref(),
        now(),
    )
    .await?;
    // Best-effort: schedule an immediate processor run.
    let _ = sync_handle.process_auto_run_now().await;
    Ok(())
}

/// Disarm a job.
#[tauri::command]
pub async fn unclaim_auto_run(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    job_id: i64,
) -> Result<(), AppError> {
    auto_run::delete_claim(pool.inner(), instance_id, project_id, job_id).await?;
    Ok(())
}

/// List the auto-run claims for one pipeline (UI state for the job list).
#[tauri::command]
pub async fn list_auto_run_claims(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<AutoRunClaim>, AppError> {
    let rows =
        auto_run::list_claims_for_pipeline(pool.inner(), instance_id, project_id, pipeline_id)
            .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}
```

- [ ] **Step 2: Register in `commands/mod.rs`**

```rust
pub mod auto_run;
```
and next to the auto_merge re-export:
```rust
pub use auto_run::{claim_auto_run, list_auto_run_claims, unclaim_auto_run};
```

- [ ] **Step 3: Register in `lib.rs`**

Add `claim_auto_run, list_auto_run_claims, unclaim_auto_run` to the `use crate::commands::{...}` import (line ~16) and add three lines to `generate_handler![...]` next to the auto-merge commands (line ~341):

```rust
            claim_auto_run,
            unclaim_auto_run,
            list_auto_run_claims,
```

- [ ] **Step 4: Check + commit**

Run: `cd src-tauri && cargo check`
Expected: clean.

```bash
git add src-tauri/src/commands/auto_run.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: Add auto-run claim Tauri commands"
```

---

### Task 8: Frontend service wrappers + event invalidation

**Files:**
- Modify: `src/services/tauri.ts` (after `processAutoMergeNow`, ~line 378)
- Modify: `src/lib/tauriEvents.ts` (new listener next to the auto-merge one)

Note: the auto-merge precedent keeps the claim type and wrappers in `src/services/tauri.ts` and hooks import from `'../services/tauri'` directly — follow that; no `src/services/index.ts` change needed.

- [ ] **Step 1: Add wrappers to `src/services/tauri.ts`**

```ts
/**
 * Auto-run claim payload from the backend: a manual pipeline job armed to
 * run automatically once the rest of its pipeline succeeds.
 */
export interface AutoRunClaim {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  jobId: number;
  jobName: string;
  refName: string | null;
  claimedAt: number;
  lastStatus: string | null;
  lastError: string | null;
  lastAttemptAt: number | null;
  attempts: number;
}

/**
 * Arm a manual job for auto-run. The sync engine plays it when ready.
 */
export async function claimAutoRun(
  instanceId: number,
  projectId: number,
  pipelineId: number,
  jobId: number,
  jobName: string,
  refName: string | null,
): Promise<void> {
  return invoke<void>('claim_auto_run', { instanceId, projectId, pipelineId, jobId, jobName, refName });
}

/**
 * Disarm a job.
 */
export async function unclaimAutoRun(
  instanceId: number,
  projectId: number,
  jobId: number,
): Promise<void> {
  return invoke<void>('unclaim_auto_run', { instanceId, projectId, jobId });
}

/**
 * List auto-run claims for one pipeline.
 */
export async function listAutoRunClaims(
  instanceId: number,
  projectId: number,
  pipelineId: number,
): Promise<AutoRunClaim[]> {
  return invoke<AutoRunClaim[]>('list_auto_run_claims', { instanceId, projectId, pipelineId });
}
```

- [ ] **Step 2: Add the invalidation listener in `src/lib/tauriEvents.ts`**

Add the payload interface next to `AutoMergeUpdatedPayload`:

```ts
interface AutoRunUpdatedPayload {
  instanceId: number;
  projectId: number;
  pipelineId: number;
  jobId: number;
  jobName: string;
  removed: boolean;
  played: boolean;
  lastStatus: string | null;
  lastError: string | null;
}
```

Add the listener after `unlistenAutoMergeUpdated`'s declaration:

```ts
  const unlistenAutoRunUpdated = await tauriListen<AutoRunUpdatedPayload>(
    'auto-run-updated',
    (event) => {
      const { instanceId, projectId, pipelineId } = event.payload;
      queryClient.invalidateQueries({
        queryKey: ['autoRunClaims', instanceId, projectId, pipelineId],
      });
    },
  );
```

And call `unlistenAutoRunUpdated();` in the returned cleanup function next to `unlistenAutoMergeUpdated();`.

- [ ] **Step 3: Typecheck + commit**

Run: `bunx tsc --noEmit`
Expected: clean.

```bash
git add src/services/tauri.ts src/lib/tauriEvents.ts
git commit -m "feat: Add auto-run service wrappers and event invalidation"
```

---

### Task 9: `useAutoRun` hook

**Files:**
- Create: `src/hooks/useAutoRun.ts` (modeled on `src/hooks/useAutoMerge.ts`)

- [ ] **Step 1: Create the hook**

```ts
import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  claimAutoRun,
  listAutoRunClaims,
  unclaimAutoRun,
  type AutoRunClaim,
} from '../services/tauri';
import type { PipelineJob } from '../types';

const autoRunClaimsKey = (instanceId: number, projectId: number, pipelineId: number) =>
  ['autoRunClaims', instanceId, projectId, pipelineId] as const;

export interface UseAutoRunResult {
  claims: AutoRunClaim[];
  /** Job ids in this pipeline that are armed for auto-run. */
  armedJobIds: Set<number>;
  isLoading: boolean;
  /** Arm or disarm a manual job. */
  toggleAutoRun: (job: PipelineJob) => void;
  /** True while an arm/disarm mutation is in flight. */
  isMutating: boolean;
}

/**
 * Hook for reading and toggling auto-run claims for one pipeline's jobs.
 *
 * Claims persist in SQLite and are processed by the background sync engine
 * — this hook just exposes the rows to the UI and provides toggle mutations.
 * The `auto-run-updated` Tauri event invalidates the query (see tauriEvents).
 */
export function useAutoRun(
  instanceId: number,
  projectId: number,
  pipelineId: number,
  refName: string | null,
): UseAutoRunResult {
  const queryClient = useQueryClient();
  const queryKey = autoRunClaimsKey(instanceId, projectId, pipelineId);

  const query = useQuery({
    queryKey,
    queryFn: () => listAutoRunClaims(instanceId, projectId, pipelineId),
    enabled: instanceId > 0 && projectId > 0 && pipelineId > 0,
    staleTime: 0,
  });

  const claims = useMemo(() => query.data ?? [], [query.data]);
  const armedJobIds = useMemo(() => new Set(claims.map((c) => c.jobId)), [claims]);

  const claimMutation = useMutation({
    mutationFn: (job: PipelineJob) =>
      claimAutoRun(instanceId, projectId, pipelineId, job.id, job.name, refName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const unclaimMutation = useMutation({
    mutationFn: (job: PipelineJob) => unclaimAutoRun(instanceId, projectId, job.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleAutoRun = useCallback(
    (job: PipelineJob) => {
      if (armedJobIds.has(job.id)) {
        unclaimMutation.mutate(job);
      } else {
        claimMutation.mutate(job);
      }
    },
    [armedJobIds, claimMutation, unclaimMutation],
  );

  return {
    claims,
    armedJobIds,
    isLoading: query.isLoading,
    toggleAutoRun,
    isMutating: claimMutation.isPending || unclaimMutation.isPending,
  };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `bunx tsc --noEmit`
Expected: clean.

```bash
git add src/hooks/useAutoRun.ts
git commit -m "feat: Add useAutoRun hook"
```

---

### Task 10: UI — Auto button in the job list

**Files:**
- Modify: `src/pages/PipelineDetailPage/icons.tsx` (add `AutoRunIcon`)
- Modify: `src/pages/PipelineDetailPage/JobRow.tsx` (new props + button)
- Modify: `src/pages/PipelineDetailPage/JobsTab.tsx` (thread props through)
- Modify: `src/pages/PipelineDetailPage/PipelineDetailView.tsx` (use the hook)
- Modify: `src/pages/PipelineDetailPage.css` (armed/auto button styles)

`PipelineDetailView` has `instanceId`, `projectId`, `pipelineId`, and `pipelineRef` props, and is rendered by both the pipelines-dashboard page and the MR-side `PipelineDetailDialog`, so wiring it here covers both surfaces.

- [ ] **Step 1: Add the icon**

In `src/pages/PipelineDetailPage/icons.tsx`, append (same 12×12 / viewBox-16 style as the others — a clock face):

```tsx
export function AutoRunIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
    </svg>
  );
}
```

- [ ] **Step 2: Extend `JobRow`**

In `src/pages/PipelineDetailPage/JobRow.tsx`:

Update the import:
```tsx
import { ExternalLinkIcon, PlayIcon, RetryIcon, CancelIcon, AutoRunIcon } from './icons';
```

Extend the props interface:
```tsx
interface JobRowProps {
  job: PipelineJob;
  loading: boolean;
  /** True when this manual job is armed for auto-run. */
  autoRunArmed: boolean;
  onPlay: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onCancel: (jobId: number) => void;
  onToggleAutoRun: (job: PipelineJob) => void;
  onNavigate: (job: PipelineJob) => void;
}
```

Update the destructuring:
```tsx
export default function JobRow({ job, loading, autoRunArmed, onPlay, onRetry, onCancel, onToggleAutoRun, onNavigate }: JobRowProps) {
```

Add `const canAutoRun = job.status === 'manual';` below the existing `canPlay`/`canRetry`/`canCancel` lines, then insert the button in the actions div, directly after the `{canPlay && (...)}` block:

```tsx
        {canAutoRun && (
          <button
            className={`pipeline-job-action-btn pipeline-job-action-btn--auto${autoRunArmed ? ' pipeline-job-action-btn--auto-armed' : ''}`}
            onClick={() => onToggleAutoRun(job)}
            disabled={loading}
            title={
              autoRunArmed
                ? 'Armed: runs automatically once all prior stages succeed. Click to disarm.'
                : 'Run automatically once all prior stages succeed'
            }
          >
            <AutoRunIcon />
            <span>{autoRunArmed ? 'Armed' : 'Auto'}</span>
          </button>
        )}
```

- [ ] **Step 3: Thread through `JobsTab`**

In `src/pages/PipelineDetailPage/JobsTab.tsx`, add to `JobsTabProps`:

```tsx
  armedJobIds: Set<number>;
  onToggleAutoRun: (job: PipelineJob) => void;
```

add both to the function's destructured params, and pass to `JobRow`:

```tsx
                    <JobRow
                      key={job.id}
                      job={job}
                      loading={actionLoading.has(job.id)}
                      autoRunArmed={armedJobIds.has(job.id)}
                      onPlay={onPlay}
                      onRetry={onRetry}
                      onCancel={onCancel}
                      onToggleAutoRun={onToggleAutoRun}
                      onNavigate={onNavigate}
                    />
```

- [ ] **Step 4: Use the hook in `PipelineDetailView`**

In `src/pages/PipelineDetailPage/PipelineDetailView.tsx`:

```tsx
import { useAutoRun } from '../../hooks/useAutoRun';
```

Inside the component, after the `usePipelineData` call:

```tsx
  const { armedJobIds, toggleAutoRun } = useAutoRun(
    instanceId,
    projectId,
    pipelineId,
    pipelineRef || null,
  );
```

And pass to `JobsTab`:

```tsx
        <JobsTab
          stages={stages}
          jobs={jobs}
          loading={loading}
          error={error}
          actionLoading={actionLoading}
          armedJobIds={armedJobIds}
          onPlay={handlePlayJob}
          onRetry={handleRetryJob}
          onCancel={handleCancelJob}
          onToggleAutoRun={toggleAutoRun}
          onNavigate={onSelectJob}
        />
```

- [ ] **Step 5: Add CSS**

In `src/pages/PipelineDetailPage.css`, after the `.pipeline-job-action-btn--play:hover` rule (~line 575):

```css
.pipeline-job-action-btn--auto {
  color: var(--accent-color);
}

.pipeline-job-action-btn--auto:hover:not(:disabled) {
  background: var(--accent-light);
  border-color: var(--accent-color);
}

.pipeline-job-action-btn--auto-armed {
  background: var(--accent-light);
  border-color: var(--accent-color);
}
```

(`--accent-color` is already used by `.pipeline-job-action-btn--retry`; if `--accent-light` doesn't exist in the theme variables, use the same pattern as `--success-light` — check with `grep -rn "accent-light" src/` and fall back to `color-mix(in srgb, var(--accent-color) 15%, transparent)`.)

- [ ] **Step 6: Typecheck + commit**

Run: `bunx tsc --noEmit && bunx eslint src/pages/PipelineDetailPage src/hooks/useAutoRun.ts`
Expected: clean (warnings at parity with existing).

```bash
git add src/pages/PipelineDetailPage src/pages/PipelineDetailPage.css
git commit -m "feat: Add auto-run arm button to manual pipeline jobs"
```

Note: the pre-commit hook runs the full Playwright suite. If a pipeline-related spec fails on the new button (e.g. button-count assertions), inspect and update that spec as part of this commit — Task 12 covers the deliberate fixture/spec changes, but unexpected breakage belongs here.

---

### Task 11: Toast + native notification on auto-run outcomes

**Files:**
- Modify: `src/hooks/useNotifications.ts`

- [ ] **Step 1: Add the listener**

Add the payload interface next to `PipelineChangedPayload`:

```ts
interface AutoRunPayload {
  played: boolean;
  jobName: string;
  refName: string | null;
  projectName: string;
  webUrl: string | null;
  instanceId: number;
  projectId: number;
  pipelineId: number;
}
```

Inside the `useEffect`, after the `pipelinePromise` block:

```ts
    const autoRunPromise = tauriListen<AutoRunPayload>('notification:auto-run', async (event) => {
      if (cancelled) return;
      try {
        const { played, jobName, refName, projectName, webUrl, instanceId, projectId, pipelineId } = event.payload;
        const title = played ? 'Manual Job Started' : 'Auto-run Cancelled';
        const refSuffix = refName ? ` (${refName})` : '';
        const body = played
          ? `${jobName}${refSuffix} in ${projectName}`
          : `${jobName}${refSuffix} in ${projectName} — pipeline did not succeed`;
        const params = new URLSearchParams({
          instance: String(instanceId),
          project: projectName,
          ref: refName ?? '',
          url: webUrl ?? '',
        });
        const route = `/pipelines/${projectId}/${pipelineId}?${params.toString()}`;

        addToastRef.current({
          type: played ? 'pipeline-running' : 'pipeline-failed',
          title,
          body,
          url: webUrl ?? undefined,
          route,
        });

        // No settings gate beyond the native toggle: the user explicitly
        // armed this job, so the outcome is always worth a toast.
        const settings = await getNotificationSettings();
        if (isTauri && settings.nativeNotificationsEnabled) {
          sendNativeNotification(title, body, route).catch(console.error);
        }
      } catch (err) {
        console.error('Failed to handle auto-run notification:', err);
      }
    });
```

And in the cleanup function add:

```ts
      autoRunPromise.then((unlisten) => unlisten());
```

- [ ] **Step 2: Typecheck + commit**

Run: `bunx tsc --noEmit`
Expected: clean.

```bash
git add src/hooks/useNotifications.ts
git commit -m "feat: Toast and native notification for auto-run outcomes"
```

---

### Task 12: E2E coverage

**Files:**
- Modify: `e2e/fixtures/seed-data.ts` (add a manual deploy job to `pipelineJobs`)
- Modify: `e2e/fixtures/tauri-mock.ts` (mock the three new commands with in-memory state)
- Modify: `e2e/mr-pipeline-dialog.spec.ts:34` (stage list assertion gains `'deploy'`)
- Create: `e2e/pipeline-auto-run.spec.ts`

- [ ] **Step 1: Add a manual job to the fixture**

In `e2e/fixtures/seed-data.ts`, append to the `pipelineJobs` array (after the `Docs` bridge job):

```ts
  {
    id: 7004,
    name: 'Deploy production',
    stage: 'deploy',
    status: 'manual',
    webUrl: 'https://gitlab.example.com/frontend/web-app/-/jobs/7004',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: null,
    finishedAt: null,
    duration: null,
    queuedDuration: null,
    allowFailure: false,
    runnerDescription: null,
    isBridge: false,
    downstreamPipeline: null,
  },
```

- [ ] **Step 2: Mock the commands**

In `e2e/fixtures/tauri-mock.ts`, in the `// -- Pipelines --` section after `cancel_pipeline`, add (the mock handlers live in a closure, so a local mutable array works; follow the file's existing arg-typing style):

```ts
      // -- Auto-run --
      list_auto_run_claims: () => autoRunClaims,
      claim_auto_run: (args) => {
        autoRunClaims.push({
          instanceId: args.instanceId as number,
          projectId: args.projectId as number,
          pipelineId: args.pipelineId as number,
          jobId: args.jobId as number,
          jobName: args.jobName as string,
          refName: (args.refName as string | null) ?? null,
          claimedAt: Math.floor(Date.now() / 1000),
          lastStatus: null,
          lastError: null,
          lastAttemptAt: null,
          attempts: 0,
        });
        return undefined;
      },
      unclaim_auto_run: (args) => {
        const idx = autoRunClaims.findIndex((c) => c.jobId === args.jobId);
        if (idx >= 0) autoRunClaims.splice(idx, 1);
        return undefined;
      },
```

with the backing state declared next to the other mutable mock state (near the top of the handler-map closure — same scope where `data` is available):

```ts
    interface MockAutoRunClaim {
      instanceId: number;
      projectId: number;
      pipelineId: number;
      jobId: number;
      jobName: string;
      refName: string | null;
      claimedAt: number;
      lastStatus: string | null;
      lastError: string | null;
      lastAttemptAt: number | null;
      attempts: number;
    }
    const autoRunClaims: MockAutoRunClaim[] = [];
```

- [ ] **Step 3: Update the stage-list assertion**

In `e2e/mr-pipeline-dialog.spec.ts` line 34, the new fixture job adds a `deploy` stage:

```ts
    await expect(overlay.locator('.pipeline-stage-name')).toHaveText(['test', 'triggers', 'deploy']);
```

- [ ] **Step 4: Write the new spec**

Create `e2e/pipeline-auto-run.spec.ts` (open the pipeline via the dashboard like `e2e/pipeline-downstream.spec.ts` does — copy its navigation helper/beforeEach pattern exactly, including the fixture import from `./fixtures/test-base`):

```ts
import { test, expect } from './fixtures/test-base';

test.describe('Auto-run manual jobs', () => {
  test.beforeEach(async ({ page }) => {
    // Same drill-in as pipeline-downstream.spec.ts: dashboard → project card
    // → pipeline detail. Mirror that file's exact selectors/waits.
    await page.goto('/pipelines');
    await page.locator('.pipeline-project-card').first().click();
    await expect(page.locator('.pipeline-detail-page')).toBeVisible();
  });

  test('manual job shows Auto button; running jobs do not', async ({ page }) => {
    const manualRow = page.locator('.pipeline-job-row', { hasText: 'Deploy production' });
    await expect(manualRow.locator('.pipeline-job-action-btn--auto')).toBeVisible();
    await expect(manualRow.locator('.pipeline-job-action-btn--auto')).toHaveText(/Auto/);

    const successRow = page.locator('.pipeline-job-row', { hasText: 'lint' });
    await expect(successRow.locator('.pipeline-job-action-btn--auto')).toHaveCount(0);
  });

  test('clicking Auto arms the job and clicking again disarms it', async ({ page }) => {
    const manualRow = page.locator('.pipeline-job-row', { hasText: 'Deploy production' });
    const autoBtn = manualRow.locator('.pipeline-job-action-btn--auto');

    await autoBtn.click();
    await expect(autoBtn).toHaveText(/Armed/);
    await expect(autoBtn).toHaveClass(/pipeline-job-action-btn--auto-armed/);

    await autoBtn.click();
    await expect(autoBtn).toHaveText(/Auto/);
    await expect(autoBtn).not.toHaveClass(/pipeline-job-action-btn--auto-armed/);
  });
});
```

If the dashboard card selector differs (check `e2e/pipeline-downstream.spec.ts:10-20` for the real one), use whatever that spec uses.

- [ ] **Step 5: Run the affected specs**

Run: `bunx playwright test pipeline-auto-run mr-pipeline-dialog pipeline-downstream screenshots`
Expected: PASS. If screenshots specs diff because of the new deploy stage, refresh baselines per the repo's existing convention (`git log` shows `test(e2e): Refresh screenshot baselines` commits; the screenshot spec writes to `e2e/screenshots/`).

- [ ] **Step 6: Commit**

```bash
git add e2e/
git commit -m "test(e2e): Cover auto-run arm button on manual jobs"
```

(The pre-commit hook will run the whole suite — that's the real gate.)

---

### Task 13: Fix spec doc + full verification + live test

**Files:**
- Modify: `docs/superpowers/specs/2026-06-11-auto-run-manual-jobs-design.md` (migration `0023` → `0024`, claim/list function names if they drifted)

- [ ] **Step 1: Update the spec's migration number**

Replace `0023_auto_run_claims.sql` with `0024_auto_run_claims.sql` in the spec.

- [ ] **Step 2: Full verification**

```bash
cd src-tauri && cargo check && cargo test && cd ..
bunx tsc --noEmit
bunx playwright test
```
Expected: all clean/green.

- [ ] **Step 3: Live test against real GitLab (per CLAUDE.md)**

Credentials are in `credentials.md` (not in git). Launch the app with `bun run tauri dev`, then:

1. Open Pipelines → a real project → a pipeline that has a manual job (any state).
2. Click **Auto** on the manual job → button flips to **Armed**.
3. If the pipeline is already settled green: within ~30s the job should start (watch GitLab web UI), the arm disappears, and a "Manual Job Started" toast appears.
4. Quit and relaunch the app with a fresh arm in place → the arm survives (query: `sqlite3 ~/Library/Application\ Support/<app-id>/ultra-gitlab.db "SELECT * FROM auto_run_claims"`).
5. Failure path: arm a manual job on a pipeline whose earlier stage will fail (or cancel the pipeline in GitLab) → within ~30s the arm disappears and an "Auto-run Cancelled" toast appears.

Document the observed results (screenshots/log lines) before claiming completion.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-11-auto-run-manual-jobs-design.md
git commit -m "docs: Fix migration number in auto-run spec"
```

---

## Self-Review Notes

- **Spec coverage:** data model → Task 1–2; trigger logic + error handling → Task 3 & 6; `get_pipeline` → Task 4; events → Task 5; processor/scheduling (sync cycle, 30s ticker, on-demand kick) → Task 6; commands + 3 registrations → Task 7; frontend types/services/hook → Tasks 8–9; JobRow UI on both surfaces → Task 10; notifications → Task 11; testing/verification → Tasks 12–13. Out-of-scope items have no tasks, as intended.
- **Known deviation from spec:** migration number 0024 (0023 taken on master); claim upsert returns `()` not the row (the UI lists per-pipeline instead of reading back a single claim).
- **Type consistency:** `AutoRunClaimRow` (db) ↔ `AutoRunClaim` (Rust DTO, camelCase) ↔ `AutoRunClaim` (TS) field sets match; `decide()` consumed in Task 6 with the exact variants defined in Task 3; `armedJobIds`/`onToggleAutoRun` names match across JobRow/JobsTab/PipelineDetailView/useAutoRun.
